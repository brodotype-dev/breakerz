// WaxStat box-pricing scraper.
//
// waxstat.com aggregates per-product wax pricing across retailers (eBay,
// Steel City Collectibles, Blowout, etc.). Each product page surfaces an
// "average price", a 30-day low/high, and a 7-day trend percentage. We use
// these to populate `products.*_am_case_cost` (After-Market case price)
// when the breaker-supplied MSRP is stale.
//
// Cloudflare-protected, so direct fetch from Vercel is unreliable —
// always go through Firecrawl JSON extract with a Zod schema. We never
// fall back to plain fetch; if Firecrawl errors, surface the error and
// write an error snapshot.

import { z } from 'zod';

const BOX_PANEL_SCHEMA = z.object({
  avgPrice: z.number().nullable(),
  low30d: z.number().nullable(),
  high30d: z.number().nullable(),
  trend7d: z
    .number()
    .nullable()
    .describe('7-day trend as a percent. -1.5 means down 1.5%. 0 or null if not stated.'),
});

export type WaxstatBoxPanel = z.infer<typeof BOX_PANEL_SCHEMA>;

let _fcClient: import('@mendable/firecrawl-js').FirecrawlClient | null = null;
async function getFirecrawl() {
  if (_fcClient) return _fcClient;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');
  const { FirecrawlClient } = await import('@mendable/firecrawl-js');
  _fcClient = new FirecrawlClient({ apiKey });
  return _fcClient;
}

export async function fetchBoxPanel(url: string): Promise<WaxstatBoxPanel> {
  const fc = await getFirecrawl();
  const result = await fc.scrape(url, {
    formats: [
      {
        type: 'json',
        schema: BOX_PANEL_SCHEMA,
        prompt:
          'Extract the box-pricing summary from this WaxStat product page. ' +
          '`avgPrice` is the current average sealed-box price across all tracked retailers, ' +
          'in US dollars. `low30d` and `high30d` are the low/high sealed-box prices over the ' +
          'last 30 days. `trend7d` is the 7-day price-change percentage (e.g. "-1.5" for ' +
          '"-1.5%"). Use null for any field that is missing or unreadable. Do NOT confuse ' +
          'wax/box prices with single-card prices.',
      },
    ],
    onlyMainContent: true,
    timeout: 60_000,
  });

  const json = (result as { json?: unknown }).json;
  const parsed = BOX_PANEL_SCHEMA.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Firecrawl JSON did not match schema: ${parsed.error.message}`);
  }
  if (parsed.data.avgPrice == null && parsed.data.low30d == null && parsed.data.high30d == null) {
    throw new Error('Firecrawl returned no pricing fields — URL may not be a WaxStat product page');
  }
  return parsed.data;
}
