// Upper Deck URL parser
//
// upperdeck.com publishes each release's checklist as a single HTML page
// with a per-card table — set name, card number, player, team, rookie flag,
// auto/mem flags, print run, and a `Stated Odds` column that crams 8 pack
// formats into one string like:
//
//   "2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"
//
// Strategy:
//   1. Firecrawl scrape with `formats: ['markdown']` (no JSON extractor —
//      these pages produce 800KB+ of markdown which choked Firecrawl's
//      LLM extractor; the table is perfectly clean `|`-delimited markdown
//      and parses deterministically).
//   2. Parse the table by detecting the header row (`Set Name | Card |
//      Description | Team City | Team Name | Rookie | Auto | #'d | SPs |
//      Stated Odds | Point`) and walking subsequent `|...|` rows.
//   3. Normalize each unique `statedOdds` string with Claude Haiku into the
//      richer OddsByFormat shape. Cache by raw string so identical odds
//      across rows only hit Claude once (~5–20 unique patterns / page).
//   4. Group rows by set name → ParsedSection / ParsedCard, and emit one
//      ParsedOdds row per unique (setName, hobby odds) tuple.
//
// Cloudflare-protected, so direct fetch is unreliable — we always go
// through Firecrawl. Stealth proxy + 8s waitFor cover the JS-rendered
// table + cookie-consent banner.

import type { ParsedCard, ParsedChecklist, ParsedOdds, ParsedSection } from './checklist-parser';
import type { OddsByFormat, UpperDeckPackFormat } from './types';

const PACK_KEYS: UpperDeckPackFormat[] = [
  'hobby',
  'epack',
  'retail',
  'blaster',
  'mega',
  'hanger',
  'tin',
  'dollar',
];

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

// Normalize a raw odds string like
//   "2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"
// into OddsByFormat:
//   { hobby: '1', epack: '1', retail: '1', blaster: '1', mega: '1',
//     hanger: '4', tin: '1', dollar: '0' }
//
// Values are the DENOMINATOR-1 form ("2:1" → "1" because the existing
// apply-odds writer renders as "1:N"). Falls back to leaving the format
// out when no token references it.
async function normalizeOdds(rawList: string[]): Promise<Map<string, OddsByFormat>> {
  const unique = Array.from(new Set(rawList.map(s => s.trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const numbered = unique.map((s, i) => `${i + 1}. "${s}"`).join('\n');

  const prompt = `Normalize Upper Deck "Stated Odds" strings into structured pack-format odds.

Upper Deck's checklists encode odds per pack format using these single-letter (or short) tokens:
  h      → hobby
  e      → epack
  r      → retail
  b      → blaster
  mega   → mega
  hanger → hanger
  tin    → tin
  dollar → dollar

An odds value is written as "X:1", "X:Y" or "1:Y" — we want the value to be the right-hand side
of "1:N" form. So "2:1 h" → hobby="2" (one card per 2 hobby packs). If a format is absent from
the string, omit it from the result.

Input strings:
${numbered}

For each input, return the structured odds with keys from {hobby, epack, retail, blaster, mega, hanger, tin, dollar}.
Respond with ONLY a JSON object of shape: {"results": [{"raw": "...", "odds": {"hobby":"2","epack":"2",...}}, ...]}
No prose, no markdown fences.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  const firstBlock = response.content[0] as { type: string; text?: string } | undefined;
  const text = (firstBlock?.text ?? '').trim();

  // Strip optional markdown fences just in case.
  const jsonText = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let payload: { results: Array<{ raw: string; odds: OddsByFormat }> };
  try {
    payload = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Claude returned non-JSON for odds normalization: ${err instanceof Error ? err.message : err}`);
  }

  const out = new Map<string, OddsByFormat>();
  for (const r of payload.results ?? []) {
    if (!r.raw || !r.odds) continue;
    const clean: OddsByFormat = {};
    for (const key of PACK_KEYS) {
      const v = r.odds[key];
      if (typeof v === 'string' && v.trim()) clean[key] = v.trim();
    }
    out.set(r.raw, clean);
  }
  return out;
}

function cleanPlayerName(s: string): string {
  return s.replace(/[®™]/g, '').replace(/,\s*$/, '').trim();
}

export type UpperDeckParseResult = {
  checklist: ParsedChecklist;
  odds: ParsedOdds;
};

export async function parseUpperDeckUrl(url: string): Promise<UpperDeckParseResult> {
  const rows = await scrapeRows(url);

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
