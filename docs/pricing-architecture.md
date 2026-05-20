# Pricing Architecture

How pricing flows from CardHedger into the consumer break page. Written after
the Bowman Chrome firefight (PRs #16–#25) that pivoted us from synchronous
on-demand refresh to a cache-read consumer path with admin/cron-driven writes.
Updated 2026-04-27 after the cron silently no-op'd for ~5 days and the rebuild
that followed.

## Design principles

1. **Consumers never wait on CardHedger.** `/api/pricing` is a pure cache read
   from `pricing_cache`. If the cache is empty for a product, the break page
   shows a passive "pricing not yet available" banner. No fallback fetch, no
   spinner, no 504.
2. **Heavy work runs where it has time.** Admin endpoints and cron get
   Vercel's 300s budget (Pro plan). Consumer API stays fast.
3. **Fan-out > long-running.** One big function with a 300s budget can't
   service 16 products that each take 200s. Instead, the cron orchestrator
   dispatches HTTP calls — each lands as its own Vercel invocation with its
   own 300s budget.
4. **Throttle the fan-out.** Unbounded parallelism starves CardHedger
   bandwidth and pushes individual workers past their own 300s cap. The
   orchestrator caps concurrency at 3.
5. **Stale-first, idempotent.** The orchestrator only touches products whose
   latest `pricing_cache.fetched_at` is null or > 22h old. Re-runs (manual or
   from staggered cron firings) are free; already-fresh products are skipped.
6. **Write failures must be loud.** Bulk upserts that catch-and-console.error
   are how we spent a day reporting "278 priced" while 0 rows actually landed.
   Upserts throw.

## Data flow

```
┌────────────────────────────────────────────────────────────────────┐
│  OVERNIGHT (5 staggered firings, 4–6:30 AM UTC, via vercel.json)    │
│  4:00, 4:30, 5:30, 6:00, 6:30  (5:00 reserved for update-scores)    │
│                                                                      │
│  /api/cron/refresh-pricing   ───►  pick stale products (>22h old,   │
│  (orchestrator, 300s)               oldest first)                   │
│                                                                      │
│                              ───►  process queue with               │
│                                    CONCURRENCY=3 workers in         │
│                                    parallel; per-fetch abort 240s,  │
│                                    orchestrator budget 270s         │
│                                            │                        │
│                                            ▼                        │
│                                    ┌─────────────────────┐          │
│                                    │ /api/admin/         │          │
│                                    │   refresh-product-  │          │
│                                    │   pricing           │          │
│                                    │ (worker, 300s each) │          │
│                                    └──────────┬──────────┘          │
│                                               │                     │
│                                               ▼                     │
│                                    lib/pricing-refresh.ts           │
│                                    • CH batch-price-estimate        │
│                                    • chunks of 100                  │
│                                    • graceful partial completion    │
│                                      at deadline                    │
│                                               │                     │
│                                               ▼                     │
│                                    UPSERT pricing_cache             │
│                                      (throws on error)              │
│                                                                      │
│  Workers the orchestrator can't dispatch (budget exhausted, queue    │
│  > capacity) get picked up by the next firing in the staggered set.  │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  ADMIN ON-DEMAND                                                    │
│                                                                      │
│  "Refresh Pricing" button   ──►   same /api/admin/refresh-product-  │
│  (per-product, Quick Actions)     pricing endpoint (300s)           │
│                                                                      │
│  Used when: product was just hydrated, or investigating an anomaly. │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  CONSUMER READ PATH                                                 │
│                                                                      │
│  /break/[slug]  ──►  /api/pricing (GET or POST)  ──►  pricing_cache │
│                      pure cache read. no CH. no writes.             │
└────────────────────────────────────────────────────────────────────┘
```

## Key files

- `app/api/cron/refresh-pricing/route.ts` — orchestrator. Reads all active
  products + their latest `pricing_cache.fetched_at`, builds a stale-first
  queue (>22h old or never), processes with CONCURRENCY=3 bounded workers.
  Per-fetch abort at 240s, orchestrator budget exhausts at 270s. Builds the
  fan-out URL from `req.url` (not `NEXT_PUBLIC_APP_URL`) to avoid the
  apex→www 301.
- `app/api/admin/refresh-product-pricing/route.ts` — per-product worker.
  `maxDuration = 300`. Admin-auth'd for manual runs; cron hits it with
  `Authorization: Bearer CRON_SECRET`.
- `middleware.ts` — short-circuits when `Authorization: Bearer ${CRON_SECRET}`
  is present, before the Supabase cookie check. Without this bypass the
  orchestrator's fan-out POSTs get 307'd to `/admin/login` and the worker's
  Bearer check never runs.
- `lib/pricing-refresh.ts` — the actual batch pipeline. Fetches CH
  variant-level prices in chunks of 100, aggregates EV per player_product,
  upserts `pricing_cache`. Exposes `RefreshSummary` with `partial`,
  `cacheRowsWritten`, `variantsFetched`, etc.
- `app/api/pricing/route.ts` — consumer read. ~100 LOC. Joins
  `player_products` ← `pricing_cache` by `player_product_id`. Zero external
  calls, zero writes.
- `app/admin/products/[id]/RefreshPricingButton.tsx` — UI for the on-demand
  admin flow. Parses response text before JSON to survive Vercel timeout
  pages.
- `vercel.json` — five staggered cron entries pointing at
  `/api/cron/refresh-pricing` (4:00, 4:30, 5:30, 6:00, 6:30 UTC).

## Scaling properties

- **Products:** Tested at 16 active. Concurrency=3 means ~3–5 products per
  orchestrator invocation, ~15–25 per overnight window across 5 firings.
  To grow past ~25, add more cron firings or bump concurrency cautiously
  (CH rate limits start biting around 4-way parallel for large products).
- **Variants per product:** The per-product worker chunks CH calls at 100
  items with graceful partial completion before the 300s deadline. Bowman
  Chrome (~6,481 variants) completes in ~220s solo, longer under contention.
  If a single product needs more headroom than 300s, split it across
  multiple cron runs or queue it (not bump `maxDuration` further).
- **Failure isolation:** Each worker fetch is wrapped — one product's 504
  doesn't poison the orchestrator's report. A worker that runs longer than
  240s gets aborted on the orchestrator side but keeps running on its own
  Vercel invocation; if it completes within its 300s cap it still writes to
  `pricing_cache`. The next cron firing sees the fresh row and skips it.
- **Re-entry safety:** Two orchestrator firings 30 min apart can't conflict
  because workers complete in <5 min and the stale-first filter excludes any
  product refreshed in the last 22h.

## Vercel configuration requirements

- **Plan: Pro.** The worker needs 300s. Hobby's 60s cap cannot service
  large products (Bowman Chrome, Topps Finest). Reverting to Hobby means
  reverting to a queue-based design.
- **Env vars:** `CRON_SECRET` (shared auth between orchestrator and worker
  AND used by middleware to skip cookie auth on `/api/admin/*`).
  `NEXT_PUBLIC_APP_URL` is read by other parts of the app (email links,
  etc.) but **not** by the cron orchestrator — it derives the fan-out base
  URL from `req.url` to stay on whatever canonical host invoked it.
- **`vercel.json`:** Five staggered cron entries (4:00, 4:30, 5:30, 6:00,
  6:30 UTC). Don't tighten the schedule until we've added observability
  (cron runs log `processed/ok/err/skipped`; scale past that when we
  actually need intra-day freshness).

## Schema notes

- `pricing_cache.cardhedger_card_id` is **NULLABLE** (migration
  `20260422170000_pricing_cache_nullable_card_id.sql`). The refresh pipeline
  writes aggregated per-player rows where the CH card_id doesn't apply; an
  earlier `NOT NULL` constraint silently rejected every upsert.
- 24h TTL is informational — we overwrite on every refresh rather than
  expire. A row with `updated_at` older than a day is a signal that the
  nightly cron didn't touch it (product inactive, zero CH matches, or
  orchestrator errored).

## When to add observability

Once we hit any of:
- More than one cron failure per week in Vercel logs
- A product reports `partial: true` for 3+ consecutive nights
- The 6:30 UTC cron firing still has products in the queue (means we're
  consistently not finishing within the overnight window)
- Total cron wall time across the 5 firings exceeds ~30 minutes

…add a PostHog event `cron_refresh_pricing_complete` with
`{ stale, processed, ok, errors, skipped, durationMs }` and a Slack webhook
on `errors > 0` or `skipped > 0` after the last firing.

**Easier first signal:** the admin Products table already shows "Last
Priced" per product. If anything is > 24h old after morning, something is
wrong. A nightly summary email or Slack post that runs at 7 AM UTC and
reports any stale products is much cheaper than full PostHog wiring.

## Future enhancements (not yet warranted)

- **Lock files / advisory locks** to prevent two firings from picking the
  same product. Currently relies on the 22h staleness filter + 30 min
  spacing; in practice no overlap because workers finish in <5 min. Add a
  Supabase advisory lock on `product_id` if the staleness filter alone
  starts feeling thin (e.g., manual + cron racing during business hours).
- **Per-product worker budgets** — bigger products (Topps Chrome
  Basketball, 1,569 players) sometimes flirt with 300s. Could add an
  internal budget field to `RefreshSummary.partial` and have a follow-up
  cron pick up partial completions, but the chunked CH fetch in
  `lib/pricing-refresh.ts` already does graceful partials on each chunk.
- **Adaptive concurrency** — track CH response times in the orchestrator
  and dial concurrency down when latency spikes. Probably premature.
- **Backpressure-aware queue** — replace the staggered cron schedule with
  a single firing that re-invokes itself via HTTP until the queue drains.
  Less brittle than 5 cron entries but more code; revisit if we need
  >5 firings to cover the active product set.

## What we tried and threw away

- **Consumer POST /api/pricing doing the heavy fetch** — worked on small
  products, 504'd on Bowman Chrome. Consumer latency was unacceptable even
  when it succeeded. (PRs #16–#20.)
- **Unbounded fan-out** (cfdb397, 2026-04-22) — kicked off a parallel POST
  per active product. Worked fine in theory; in practice with 16 products
  the simultaneous CH load starved every worker so badly that 7 of them
  blew past their own 300s caps. Replaced with CONCURRENCY=3 (2026-04-27).
- **`priceable` filter on `player_products.cardhedger_card_id`** — meant
  to skip products with no CH matches. Wrong table: matches live on
  `player_product_variants.cardhedger_card_id` since the v2 matcher
  rewrite. Filter silently excluded every recently-matched product.
  Removed; the worker short-circuits cleanly on empty input anyway.
- **Building fan-out URL from `NEXT_PUBLIC_APP_URL`** — value was the
  apex (`https://getbreakiq.com`), Vercel's apex→www redirect is a 301,
  301 follow downgrades POST to GET, worker returned 405 for everything.
  Now derived from `req.url`.
- **Silent upsert error handling** (catch + `console.error`) — caused the
  "278 priced, 0 cached" bug in PR #25. The pattern is banned in this
  pipeline; upserts throw.

## The 2026-04-27 silent-failure incident

Worth documenting as a post-mortem because four bugs stacked in a way that
produced *no* error signal — the cron logged "16/16 ok" every night for
five days while writing zero rows.

The cron orchestrator dispatched fan-out POSTs to
`/api/admin/refresh-product-pricing` with `Authorization: Bearer
${CRON_SECRET}`. The worker route handler accepted that. But middleware
matches `/api/admin/*`, only checks Supabase cookie sessions, and 307'd
the request to `/admin/login`. Node's `fetch` follows redirects by default,
the login HTML returned 200, the orchestrator's
`await res.json().catch(() => null)` swallowed the parse error, and every
product reported `ok: true, summary: null`.

Surfaced visually when the admin Products table's "Last Priced" column
showed timestamps stuck at 17–35 days old.

Fixes (in order, all 2026-04-27):
1. Middleware: Bearer CRON_SECRET bypass before cookie check.
2. Orchestrator: derive fan-out URL from `req.url` (apex→www redirect).
3. Orchestrator: drop the wrong-table priceable filter.
4. Orchestrator: throttle to CONCURRENCY=3 + stale-first selection +
   5 staggered cron firings (CH bandwidth contention under fan-out).

Lesson: when an HTTP-fan-out orchestrator awaits responses from its own
workers, the middleware between them is part of the call graph and needs
to be tested. A worker route that "accepts Bearer auth" isn't tested
end-to-end until you've verified middleware lets it through.

## The 2026-05-20 cache-write null-overwrite incident

A second silent-failure shape surfaced during the FMV experiment work. A
catalog audit found **60,150 rows in `ch_price_cache` (97% of the table)
had all three price columns null**. Spot-probing 5 random cards from that
bucket against CH directly via `batch-price-estimate` showed 1 of 5 (20%)
had genuine current prices. The other 80% really are CH-empty (the long
tail of low-trade parallels), but the 20% was a real correctness bug:
we were silently nulling good prices, not just observing data sparsity.

Root cause: `lib/pricing-refresh.ts` `runChunk` did three parallel
`batchPriceEstimate` calls (Raw / PSA 9 / PSA 10) and then ran a blind
`.upsert()` per chunk. When **any** of those calls rejected at the
chunk level — timeout under the 240s internal deadline, rate limit,
transient CH outage — its `*Map` was empty for the entire chunk, every
card's `valid*` field collapsed to null, and the upsert wrote
`*_price: null` for that grade. Pre-existing good cached values got
overwritten on the way out.

Cron logs confirmed the magnitude: per-product workers were routinely
running 282–296s, right up against Vercel's 300s kill, so chunk aborts
were frequent. Each abort wiped good data for ~100 cards in the chunk.

Fix: new Postgres function `upsert_ch_price_cache_preserving_nulls`
(migration `20260520220000`) does per-grade `COALESCE(EXCLUDED.*,
ch_price_cache.*)`. Null new values preserve existing cached values;
non-null new values overwrite. `fetched_at` always bumps so the TTL
still skips this card on the next firing (preserving the
"no re-fetch storm on transient outage" property the original blind
upsert was reaching for). Single SQL statement, atomic — no TOCTOU
race when concurrent staggered firings overlap on the same card_id.

App code: one-line change in `runChunk` — `.from('ch_price_cache')
.upsert(...)` → `.rpc('upsert_ch_price_cache_preserving_nulls', { rows })`.

Backfill is automatic: next cron firings' successful chunks repopulate
prices for previously-nulled cards via the COALESCE-on-overwrite path.

Lesson: an upsert that includes a column in the payload, blanks it
out for "no data this run" reasons, and relies on `ON CONFLICT
DO UPDATE` semantics will silently overwrite earlier good values.
When the per-write source-of-truth might be incomplete (partial-success
or all-failed fan-out), prefer COALESCE-on-update over blind replace
— or use multiple narrower upserts that only touch columns the run
actually has data for.

## Related docs

- [cardhedger-matching.md](./cardhedger-matching.md) — how `player_products`
  get their `cardhedger_card_id` in the first place (input to this pipeline)
- [catalog-preload-architecture.md](./catalog-preload-architecture.md) — the
  sibling `ch_set_cache` refresh pipeline (3 AM UTC)
- [cost-analysis.md](./cost-analysis.md) — CH API cost per refresh
