# WaxStat box-pricing scraper

[WaxStat](https://waxstat.com) aggregates sealed-box pricing across retailers (eBay, Steel City Collectibles, Blowout, etc.). We pull their `avg_price` per format into our `products.*_am_case_cost` columns weekly so the break page always reflects the current sealed-box market without manual admin upkeep.

## Why we need it

`hobby_am_case_cost` (and the BD/jumbo equivalents) represents what a sealed box ACTUALLY trades at in the after-market, which is usually different from MSRP — sometimes by hundreds of dollars. The break page prefers AM cost over MSRP when both are set; before this scraper, the AM number was a manual admin input that aged out quickly.

One sealed box = one case for our case-mix math, so WaxStat's per-box average maps 1:1 to our `*_am_case_cost` columns.

## Schema

Three nullable URL columns on `products`:

```sql
products.waxstat_hobby_url  text
products.waxstat_bd_url     text
products.waxstat_jumbo_url  text
```

Per-fetch time series in `waxstat_pricing_snapshots`:

| Column        | Type        | Notes                                                  |
|---            |---          |---                                                     |
| id            | uuid PK     |                                                        |
| product_id    | uuid FK     | ON DELETE CASCADE                                      |
| format        | text        | CHECK in ('hobby', 'bd', 'jumbo')                      |
| source_url    | text        | The URL that was fetched (for forensics)               |
| avg_price     | numeric     | WaxStat's aggregated avg sealed-box price              |
| low_30d       | numeric     | 30-day low                                             |
| high_30d      | numeric     | 30-day high                                            |
| trend_7d      | numeric     | 7-day percent change (e.g. -1.5 = -1.5%)               |
| error_message | text        | Set on fetch failure; all numeric cols null            |
| fetched_at    | timestamptz | Default now()                                          |

Index: `(product_id, format, fetched_at DESC)` for "latest snapshot per format".

Errors are first-class snapshot rows so "we haven't refreshed this in a while" is distinguishable from "WaxStat changed the page and we can't parse it".

## Pipeline

1. **Admin pastes a URL** per format on `/admin/products/[id]` (the WaxStat Box Pricing section). Save persists to `products.waxstat_*_url`.
2. **Weekly cron** [/api/cron/refresh-waxstat-pricing](../app/api/cron/refresh-waxstat-pricing/route.ts) fires Sundays 04:00 UTC via [vercel.json](../vercel.json). Iterates active products with at least one URL set, serial per product. `recordCronStart` marker first so the admin panel sees the run even if `maxDuration=300s` kills the function mid-loop.
3. **Per-product refresh** ([lib/waxstat-importer.ts](../lib/waxstat-importer.ts) `refreshProductWaxstat(productId)`) reads the three URL columns and fetches in parallel via [lib/waxstat.ts](../lib/waxstat.ts) `fetchBoxPanel(url)`. Per-format errors are isolated — a 404 on hobby doesn't tank BD + jumbo.
4. **Write snapshot** per format (success or error). On success, also overwrite `products.*_am_case_cost` with the fresh `avg_price`.
5. **Admin Refresh Now** at `POST /api/admin/products/[id]/waxstat-refresh` runs the same importer on demand. URL save via `PUT` to the same route.

## Firecrawl

WaxStat is Cloudflare-protected — direct fetch from a Vercel function is unreliable. We use Firecrawl's JSON-format scrape with a Zod schema (see [lib/waxstat.ts](../lib/waxstat.ts) `BOX_PANEL_SCHEMA`) and prompt that instructs the model to return numeric fields (`avgPrice`, `low30d`, `high30d`, `trend7d`) or null.

No plain-fetch fallback — if Firecrawl errors, we surface the error and write an error snapshot rather than fabricating a number.

Firecrawl client is a lazy singleton (one instantiation per Lambda warm container), same pattern as `lib/upper-deck-parser.ts`. Throws at first use if `FIRECRAWL_API_KEY` is unset.

## Admin UX

[WaxstatPanel.tsx](../app/admin/products/%5Bid%5D/WaxstatPanel.tsx) drops a new Section on `/admin/products/[id]` between Pricing Anchor Strategy and Pricing Audit:

- Three URL inputs (Hobby / BD / Jumbo)
- Per-row "last refresh" summary: `avg $X (30d $low–$high · 7d +X%)`. Errors render in red.
- "Save URLs" button — writes the three columns.
- "Refresh Now" button — runs `refreshProductWaxstat` for the product and updates the on-screen summary without a full page reload.

## Out of scope (queued)

- Backfilling historical snapshots — first weekly run starts the time series.
- Per-retailer breakdown — we take WaxStat's already-aggregated `avg_price`.
- Discord notifications on material case-price moves (e.g. ≥10% trend week-over-week).
- Auto-discovery of WaxStat URLs by fuzzy-matching product names.
