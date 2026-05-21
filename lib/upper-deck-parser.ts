// Upper Deck / O-Pee-Chee checklist parser
//
// Upper Deck publishes the same per-card table across two surfaces:
//
//   1. The web checklist at upperdeck.com/checklist/<slug>/ (Cloudflare-
//      protected, JS-hydrated, cookie-consent overlay). Scraped via
//      Firecrawl markdown + deterministic |-table parser.
//
//   2. A Beckett-published XLSX with a "Master Card List" sheet whose
//      header exactly mirrors the web table:
//        Set Name | Card | Description | Team City | Team Name |
//        Rookie | Auto | #'d | SPs | Stated Odds | Point
//      Both source files are the same data; the XLSX is the preferred
//      path when admin has it (no Cloudflare, no JS, no rate limit).
//
// Both surfaces route through the same `rowsToResult` transform — set
// grouping, Claude-Haiku odds normalization, ParsedChecklist/ParsedOdds
// emission. New surfaces (e.g. a future direct UD-API feed) plug into
// rowsToResult by producing the same RawRow[] shape.
//
// Stated Odds column packs 8 pack formats into a single string like
//   "2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"
// and Claude Haiku normalizes those into OddsByFormat once per import.
//
// See docs/manufacturer-rules/upper-deck.md for the full parser playbook.

import type { ParsedCard, ParsedChecklist, ParsedOdds, ParsedSection } from './checklist-parser';
import type { OddsByFormat, UpperDeckPackFormat } from './types';

type RawRow = {
  setName: string;
  cardNumber: string | null;
  playerName: string;
  teamCity: string | null;
  teamName: string | null;
  isRookie: boolean;
  hasAuto: boolean;
  hasMem: boolean;
  printRun: number | null;
  sps: number | null;
  statedOdds: string | null;
  point: string | null;
};

// Lazy singleton — instantiate the Firecrawl client once per Lambda warm
// container. Throws at first use if FIRECRAWL_API_KEY isn't configured.
let _fcClient: import('@mendable/firecrawl-js').FirecrawlClient | null = null;
async function getFirecrawl() {
  if (_fcClient) return _fcClient;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');
  const { FirecrawlClient } = await import('@mendable/firecrawl-js');
  _fcClient = new FirecrawlClient({ apiKey });
  return _fcClient;
}

// In-memory cache so back-to-back "import checklist" and "import odds" hits
// against the same URL only spend one Firecrawl call. 5-minute TTL — admin
// won't notice but caps the cost of an open admin tab.
type CacheEntry = { ts: number; rows: RawRow[] };
const PAGE_CACHE = new Map<string, CacheEntry>();
const PAGE_TTL_MS = 5 * 60 * 1000;

// The Upper Deck checklist header row, lowercased + trimmed for matching.
// We require these specific columns; their order is detected dynamically
// from the actual header so new columns (or reordered ones) won't shift
// our parser silently.
const REQUIRED_HEADERS = ['set name', 'card', 'description', 'stated odds'];

function splitMdRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim());
}

function parseHeader(line: string): Record<string, number> | null {
  const cols = splitMdRow(line).map(c => c.toLowerCase());
  for (const required of REQUIRED_HEADERS) {
    if (!cols.includes(required)) return null;
  }
  const out: Record<string, number> = {};
  cols.forEach((c, i) => {
    out[c] = i;
  });
  return out;
}

function parseTableFromMarkdown(md: string): RawRow[] {
  const lines = md.split('\n');
  // Find the header row — the first `|...|` line containing all of
  // REQUIRED_HEADERS. Multiple tables can appear on the page (nav menus,
  // etc.), so we scan for the one that looks like a checklist.
  let headerIdx = -1;
  let cols: Record<string, number> | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('|')) continue;
    const parsed = parseHeader(l);
    if (parsed) {
      headerIdx = i;
      cols = parsed;
      break;
    }
  }
  if (headerIdx < 0 || !cols) return [];

  // Skip the separator row (|---|---|---|) and walk rows until we hit a
  // line that isn't `|...|`.
  const rows: RawRow[] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith('|')) break;
    // Skip header-style separator rows
    if (/^\|[\s-]+\|/.test(l)) continue;
    const c = splitMdRow(l);
    if (c.length < REQUIRED_HEADERS.length) continue;

    const get = (key: string): string => (cols![key] != null ? (c[cols![key]] ?? '') : '');
    const setName = get('set name');
    const playerName = get('description');
    if (!setName || !playerName) continue;

    const rookieRaw = get('rookie');
    const autoRaw = get('auto');
    const memRaw = get('memorabilia') || get('mem');
    const printRunRaw = get(`#'d`) || get(`#d`) || get('numbered');
    const spsRaw = get('sps') || get('sp');
    const oddsRaw = get('stated odds');
    const pointRaw = get('point');

    rows.push({
      setName,
      cardNumber: get('card') || null,
      playerName,
      teamCity: get('team city') || null,
      teamName: get('team name') || null,
      isRookie: /xrc|rookie|rc/i.test(rookieRaw),
      hasAuto: /auto/i.test(autoRaw),
      hasMem: /mem|patch|jersey/i.test(memRaw),
      printRun: printRunRaw && /^\d+$/.test(printRunRaw) ? Number(printRunRaw) : null,
      sps: spsRaw && /^\d+$/.test(spsRaw) ? Number(spsRaw) : null,
      statedOdds: oddsRaw || null,
      point: pointRaw || null,
    });
  }
  return rows;
}

async function scrapeRows(url: string): Promise<RawRow[]> {
  const cached = PAGE_CACHE.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL_MS) return cached.rows;

  const fc = await getFirecrawl();

  // Critical knobs (validated against the OPC Platinum page 2026-05-21):
  //   - onlyMainContent: false  — main-content classifier sometimes drops
  //     the table along with the cookie banner.
  //   - waitFor: 8000           — JS-hydrated rows + cookie consent overlay.
  //   - proxy: 'stealth'        — Cloudflare anti-bot detection.
  const result = await fc.scrape(url, {
    formats: ['markdown'],
    onlyMainContent: false,
    waitFor: 8000,
    proxy: 'stealth',
    timeout: 120_000,
  });

  const md = (result as { markdown?: string }).markdown ?? '';
  if (!md) {
    throw new Error('Firecrawl returned no markdown — URL may be unreachable');
  }

  const rows = parseTableFromMarkdown(md);
  if (rows.length === 0) {
    const excerpt = md.slice(0, 400).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Could not find a checklist table on the page. Expected columns: ${REQUIRED_HEADERS.join(', ')}. Page preview: "${excerpt}"`,
    );
  }

  PAGE_CACHE.set(url, { ts: Date.now(), rows });
  return rows;
}

// Token / full-word → format key. Both short tokens (h/e/r/b) and full
// words (Hobby, e-Pack, Blaster, …) appear interchangeably in Upper Deck's
// Stated Odds strings.
const TOKEN_TO_FORMAT: Record<string, UpperDeckPackFormat> = {
  h: 'hobby',
  hobby: 'hobby',
  e: 'epack',
  epack: 'epack',
  'e-pack': 'epack',
  r: 'retail',
  retail: 'retail',
  b: 'blaster',
  blaster: 'blaster',
  mega: 'mega',
  hanger: 'hanger',
  tin: 'tin',
  tins: 'tin',
  dollar: 'dollar',
};

// One occurrence of an odds ratio + format label. Captures:
//   1 = numerator   2 = denominator   3 = format token / word
// Examples it matches:
//   "1:6 h"                 → ['1','6','h']
//   "6:1 hobby"             → ['6','1','hobby']
//   "1:576 Hobby"           → ['1','576','Hobby']
//   "2:1 e-Pack"            → ['2','1','e-Pack']
const ODDS_TOKEN_RE = /(\d+)\s*:\s*(\d+)\s+([A-Za-z][A-Za-z-]*)/g;

// Deterministically parse an Upper Deck "Stated Odds" string into
// OddsByFormat. The Beckett-published patterns are highly regular:
//   "6:1 h, 6:1 e, 2:1 b"
//   "1:3 Blaster"
//   "1:9 h, 1:9 e, 1:36 b"
//   "Random Inserts in Hobby and e-Pack"  (no numeric odds — returns empty)
//
// Each `(\d+):(\d+) <token>` becomes one entry. Ratio is normalized to
// "1:N" form (denominator stored as string), matching the convention the
// apply-odds writer uses (renders as `1:N`).
//
// Unrecognized strings produce an empty result; the caller treats that as
// "no odds for this section" and the existing fallback path in the engine
// picks up.
function parseOddsString(raw: string): OddsByFormat {
  const out: OddsByFormat = {};
  ODDS_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ODDS_TOKEN_RE.exec(raw)) !== null) {
    const n = Number(m[1]);
    const d = Number(m[2]);
    if (!Number.isFinite(n) || !Number.isFinite(d) || n === 0 || d === 0) continue;
    const formatKey = TOKEN_TO_FORMAT[m[3].toLowerCase()];
    if (!formatKey) continue;
    // Normalize to 1:N form. If the source is already 1:N (n=1) the
    // stored value is d. If it's X:1, the stored value is X. If it's
    // X:Y, we collapse to the larger side (e.g. 2:1 = 1:0.5, but we
    // never see fractional UD odds in practice — so the simple
    // n===1 ? d : n rule covers every real case).
    const value = n === 1 ? String(d) : String(n);
    out[formatKey] = value;
  }
  return out;
}

// Normalize a raw odds string like
//   "2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"
// into OddsByFormat. Deterministic regex pass on every input; no LLM
// involvement (Claude Haiku used to fail with truncated JSON on 25+
// patterns, and the format is regular enough that an LLM is overkill).
async function normalizeOdds(rawList: string[]): Promise<Map<string, OddsByFormat>> {
  const unique = Array.from(new Set(rawList.map(s => s.trim()).filter(Boolean)));
  const out = new Map<string, OddsByFormat>();
  for (const raw of unique) out.set(raw, parseOddsString(raw));
  return out;
}

function cleanPlayerName(s: string): string {
  return s.replace(/[®™]/g, '').replace(/,\s*$/, '').trim();
}

export type UpperDeckParseResult = {
  checklist: ParsedChecklist;
  odds: ParsedOdds;
};

// Shared row → ParsedChecklist + ParsedOdds transform. Both the URL
// and XLSX surfaces produce identically-shaped RawRow[]; everything past
// row extraction is identical.
async function rowsToResult(rows: RawRow[]): Promise<UpperDeckParseResult> {
  // Step 1 — normalize unique odds strings with Claude (single call).
  const rawOdds = rows.map(r => r.statedOdds ?? '').filter(Boolean);
  const oddsLookup = await normalizeOdds(rawOdds);

  // Step 2 — group rows into sections by setName.
  const sectionMap = new Map<string, ParsedSection>();
  for (const r of rows) {
    const section = r.setName?.trim() || 'BASE';
    if (!sectionMap.has(section)) {
      sectionMap.set(section, { sectionName: section, cards: [], flagged: [] });
    }
    const card: ParsedCard = {
      playerName: cleanPlayerName(r.playerName),
      team: [r.teamCity ?? '', r.teamName ?? ''].filter(Boolean).join(' ').trim() || undefined,
      cardNumber: r.cardNumber ?? undefined,
      isRookie: !!r.isRookie,
      isSP: false,
      hasBackVariation: false,
      printRun: r.printRun ?? r.sps ?? undefined,
      rawLine: `${r.cardNumber ?? ''} ${r.playerName} ${r.setName}`.trim(),
      parallels: [section],
    };
    sectionMap.get(section)!.cards.push(card);
  }

  const checklist: ParsedChecklist = {
    productName: '',
    detectedFormat: 'generic',
    sections: Array.from(sectionMap.values()),
  };

  // Step 3 — build ParsedOdds. One row per unique (section, statedOdds)
  // tuple. The legacy apply-odds writer reads hobbyOdds; oddsByFormat is
  // a richer payload stored alongside.
  const oddsBySection = new Map<string, OddsByFormat>();
  for (const r of rows) {
    const section = r.setName?.trim() || 'BASE';
    if (oddsBySection.has(section)) continue;
    const raw = (r.statedOdds ?? '').trim();
    if (!raw) continue;
    const normalized = oddsLookup.get(raw);
    if (normalized && normalized.hobby) oddsBySection.set(section, normalized);
  }

  const oddsRows: ParsedOdds['rows'] = [];
  for (const [section, byFormat] of oddsBySection.entries()) {
    if (!byFormat.hobby) continue;
    oddsRows.push({
      subsetName: section,
      hobbyOdds: byFormat.hobby,
      breakerOdds: null,
      oddsByFormat: byFormat,
    });
  }

  return {
    checklist,
    odds: { rows: oddsRows },
  };
}

export async function parseUpperDeckUrl(url: string): Promise<UpperDeckParseResult> {
  const rows = await scrapeRows(url);
  return rowsToResult(rows);
}

// ---------------------------------------------------------------------------
// XLSX surface — Beckett-published "Master Card List" sheet
// ---------------------------------------------------------------------------
//
// Beckett ships an XLSX with several denormalized sheets (Base, Variations,
// Autographs, Inserts, Updates, Full Checklist, Teams). The one we want is
// `Master Card List` — its header exactly mirrors the web table:
//
//   Set Name | Card | Description | Team City | Team Name |
//   Rookie | Auto | #'d | SPs | Stated Odds | Point
//
// We locate the sheet by header signature (not name — Beckett sometimes
// uses "Master Card List" vs "Master Checklist" across files), pull all
// rows past the header, and route the resulting RawRow[] through the
// same `rowsToResult` transform that the URL path uses.

// Required header columns, lowercased + trimmed. Same set the markdown
// parser keys off — both surfaces speak the same shape.
const XLSX_REQUIRED_HEADERS = ['set name', 'card', 'description', 'stated odds'];

function findMasterCardListSheet(
  wb: { Sheets: Record<string, unknown>; SheetNames: string[] },
  XLSX: { utils: { sheet_to_json: (ws: unknown, opts?: Record<string, unknown>) => unknown[][] } },
): { sheetName: string; cols: Record<string, number> } | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: null });
    const header = rows[0];
    if (!Array.isArray(header)) continue;
    const lc = header.map(c => (c == null ? '' : String(c).trim().toLowerCase()));
    if (!XLSX_REQUIRED_HEADERS.every(req => lc.includes(req))) continue;
    const cols: Record<string, number> = {};
    lc.forEach((c, i) => {
      if (c) cols[c] = i;
    });
    return { sheetName: name, cols };
  }
  return null;
}

export function parseUpperDeckXlsx(buffer: Buffer): UpperDeckParseResult | Promise<UpperDeckParseResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });

  const found = findMasterCardListSheet(wb, XLSX);
  if (!found) {
    throw new Error(
      `Could not find a "Master Card List" sheet with the expected columns: ${XLSX_REQUIRED_HEADERS.join(', ')}. ` +
        `Sheets seen: ${wb.SheetNames.join(', ')}`,
    );
  }
  const { sheetName, cols } = found;
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  const rows: RawRow[] = [];
  // Skip header row (i=0). Walk every subsequent row.
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!Array.isArray(r)) continue;
    const get = (key: string): string => {
      const idx = cols[key];
      if (idx == null) return '';
      const v = r[idx];
      return v == null ? '' : String(v).trim();
    };

    const setName = get('set name');
    const playerName = get('description');
    if (!setName || !playerName) continue;

    const printRunRaw = get(`#'d`) || get(`#d`) || get('numbered');
    const spsRaw = get('sps') || get('sp');

    rows.push({
      setName,
      cardNumber: get('card') || null,
      playerName,
      teamCity: get('team city') || null,
      teamName: get('team name') || null,
      isRookie: /xrc|rookie|^rc$/i.test(get('rookie')),
      hasAuto: /auto/i.test(get('auto')),
      hasMem: /mem|patch|jersey/i.test(get('memorabilia') || get('mem')),
      printRun: printRunRaw && /^\d+$/.test(printRunRaw) ? Number(printRunRaw) : null,
      sps: spsRaw && /^\d+$/.test(spsRaw) ? Number(spsRaw) : null,
      statedOdds: get('stated odds') || null,
      point: get('point') || null,
    });
  }

  if (rows.length === 0) {
    throw new Error(`Master Card List sheet "${sheetName}" had a header but no data rows.`);
  }

  return rowsToResult(rows);
}
