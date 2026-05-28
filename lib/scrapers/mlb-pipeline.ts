// MLB Pipeline Top 100 prospect scraper.
//
// mlb.com/prospects publishes MLB Pipeline's Top 100 prospect rankings,
// revised roughly every 4 weeks. This is the canonical objective prospect-
// rank source for baseball (Track A). We scrape the ranked table and write
// matched players to prospect_rankings (see lib/prospect-rankings-import.ts).
//
// JS-heavy SPA, so direct fetch from Vercel is unreliable — always go
// through Firecrawl JSON extract with a Zod schema. We never fall back to
// plain fetch; if Firecrawl errors, surface the error (the caller writes
// an error into the import summary). Pattern copied verbatim from
// lib/waxstat.ts.

import { z } from 'zod';

// The /prospects hub page only renders a small "featured" widget (~5
// prospects) — our first scrape returned exactly 5. The ranked Top 100
// table lives at /prospects/stats/top-prospects ("Top Baseball Prospects").
export const MLB_PIPELINE_TOP100_URL = 'https://www.mlb.com/prospects/stats/top-prospects';

const RANKING_ROW_SCHEMA = z.object({
  rank: z.number().describe('Overall rank, 1 = top prospect'),
  player_name: z.string().describe('Full player name, e.g. "Jackson Holliday"'),
  position: z.string().nullable().describe('Position abbreviation, e.g. "SS", "RHP". null if not shown.'),
  team_or_school: z
    .string()
    .nullable()
    .describe('MLB org or amateur school the prospect is in, e.g. "Orioles". null if not shown.'),
});

const RANKINGS_SCHEMA = z.object({
  rankings: z.array(RANKING_ROW_SCHEMA),
});

export type MlbPipelineRow = z.infer<typeof RANKING_ROW_SCHEMA>;

let _fcClient: import('@mendable/firecrawl-js').FirecrawlClient | null = null;
async function getFirecrawl() {
  if (_fcClient) return _fcClient;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');
  const { FirecrawlClient } = await import('@mendable/firecrawl-js');
  _fcClient = new FirecrawlClient({ apiKey });
  return _fcClient;
}

/**
 * Scrape the MLB Pipeline Top 100. Returns the ranked rows sorted by rank
 * ascending. Throws if Firecrawl returns no JSON or the list is empty —
 * the caller decides how to surface that.
 *
 * @param url override for testing / future MLB Pipeline URL changes.
 *            Defaults to the public Top 100 page.
 */
export async function scrapeMlbPipelineTop100(url: string = MLB_PIPELINE_TOP100_URL): Promise<MlbPipelineRow[]> {
  const fc = await getFirecrawl();

  // Pre-convert Zod → JSON Schema (SDK auto-conversion is unreliable on
  // Zod v4 — see lib/upper-deck-parser.ts).
  const jsonSchema = z.toJSONSchema(RANKINGS_SCHEMA);

  const result = await fc.scrape(url, {
    formats: [
      {
        type: 'json',
        schema: jsonSchema as Record<string, unknown>,
        prompt:
          'This is the MLB Pipeline "Top Baseball Prospects" ranked table. Extract the ' +
          'FULL ranked list — all rows present on the page, ideally the complete Top 100. ' +
          'Return one entry per ranked prospect with their overall `rank` (1 = top), ' +
          'full `player_name`, `position` abbreviation, and `team_or_school` (the MLB ' +
          'organization or amateur school they belong to). Go in rank order and do not ' +
          'stop early — include every ranked row you can see, not just the first few or a ' +
          'featured subset. Use null for position or team_or_school when not shown. ' +
          'Do NOT invent prospects or ranks — only extract what is on the page.',
      },
      'markdown',
    ],
    onlyMainContent: true,
    // The ranked table is a JS-rendered SPA; give it generous time to
    // hydrate the full list before extraction. Bumped 3s → 8s after the
    // /prospects hub page only yielded 5 rows.
    waitFor: 8000,
    timeout: 90_000,
  });

  const json = (result as { json?: unknown }).json;
  if (json == null) {
    const md = (result as { markdown?: string }).markdown ?? '';
    const excerpt = md.slice(0, 400).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Firecrawl returned no JSON extraction for MLB Pipeline. Page preview: "${excerpt || '(empty)'}"`,
    );
  }

  const parsed = RANKINGS_SCHEMA.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Firecrawl JSON did not match the MLB Pipeline schema: ${parsed.error.message} — got: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  const rows = parsed.data.rankings.filter(r => Number.isFinite(r.rank) && r.player_name.trim().length > 0);
  if (rows.length === 0) {
    throw new Error('MLB Pipeline scrape returned zero ranked prospects — URL may be wrong or the page failed to render');
  }

  // Sort by rank ascending so downstream consumers get a stable order.
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}
