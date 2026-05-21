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
//   1. Firecrawl scrape with a JSON-schema extract to pull the table to a
//      clean row[] (Cloudflare-protected, so direct fetch is unreliable —
//      we always go through Firecrawl).
//   2. Normalize each unique `statedOdds` string with Claude Haiku into the
//      richer OddsByFormat shape. Cache by raw string so identical odds
//      across rows only hit Claude once (~10–20 unique patterns / page).
//   3. Group rows by set name → ParsedSection / ParsedCard, and emit one
//      ParsedOdds row per unique (setName, hobby odds) tuple. The richer
//      oddsByFormat lives alongside as an optional payload.
//
// Result is shape-compatible with the existing checklist-apply + apply-odds
// flows; downstream code that doesn't know about UD keeps working.

import { z } from 'zod';
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

const ROW_SCHEMA = z.object({
  setName: z.string().describe('Section / parallel name, e.g. "Young Guns", "Canvas", "UD Portraits"'),
  cardNumber: z.string().nullable().describe('Card number as printed, e.g. "201", "YG-1", "UDP-50"'),
  playerName: z.string().describe('Full player name, no trailing punctuation'),
  teamCity: z.string().nullable(),
  teamName: z.string().nullable(),
  isRookie: z.boolean().default(false),
  hasAuto: z.boolean().default(false),
  hasMem: z.boolean().default(false),
  printRun: z.number().nullable().describe('Numeric print run (SP/SSP). Use null if not stated.'),
  sps: z.number().nullable().describe('Stated print run from the SP column when present, else null'),
  statedOdds: z.string().nullable().describe('Raw odds string from the Stated Odds column. Preserve exactly as printed.'),
  point: z.string().nullable().describe('Point value if listed'),
});

const PAGE_SCHEMA = z.object({
  rows: z.array(ROW_SCHEMA),
});

type RawRow = z.infer<typeof ROW_SCHEMA>;

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

async function scrapeRows(url: string): Promise<RawRow[]> {
  const cached = PAGE_CACHE.get(url);
  if (cached && Date.now() - cached.ts < PAGE_TTL_MS) return cached.rows;

  const fc = await getFirecrawl();
  const result = await fc.scrape(url, {
    formats: [
      {
        type: 'json',
        schema: PAGE_SCHEMA,
        prompt:
          'Extract every checklist row from this Upper Deck checklist page. ' +
          'Each row maps to ONE card (one parallel × one player). Preserve ' +
          'the `Stated Odds` column EXACTLY as written, including all per-format ' +
          'tokens (h/e/r/b/mega/hanger/tin/dollar). If a column is empty, return null.',
      },
    ],
    onlyMainContent: true,
    timeout: 90_000,
  });

  const json = (result as { json?: unknown }).json;
  const parsed = PAGE_SCHEMA.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Firecrawl JSON did not match schema: ${parsed.error.message}`);
  }
  if (parsed.data.rows.length === 0) {
    throw new Error('Firecrawl returned 0 rows — the URL may not be an Upper Deck checklist');
  }

  PAGE_CACHE.set(url, { ts: Date.now(), rows: parsed.data.rows });
  return parsed.data.rows;
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
