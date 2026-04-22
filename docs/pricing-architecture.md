# Pricing Architecture

How pricing flows from CardHedger into the consumer break page. Written after
the Bowman Chrome firefight (PRs #16–#25) that pivoted us from synchronous
on-demand refresh to a cache-read consumer path with admin/cron-driven writes.

## Design principles

1. **Consumers never wait on CardHedger.** `/api/pricing` is a pure cache read
   from `pricing_cache`. If the cache is empty for a product, the break page
   shows a passive "pricing not yet available" banner. No fallback fetch, no
   spinner, no 504.
2. **Heavy work runs where it has time.** Admin endpoints and cron get
   Vercel's 300s budget (Pro plan). Consumer API stays fast.
3. **Fan-out > long-running.** One big function with a 300s budget can't
   service 50 products that each take 200s. Instead, the cron orchestrator
   dispatches HTTP calls — each lands as its own Vercel invocation with its
   own 300s budget.
4. **Write failures must be loud.** Bulk upserts that catch-and-console.error
   are how we spent a day reporting "278 priced" while 0 rows actually landed.
   Upserts throw.

## Data flow

```
┌────────────────────────────────────────────────────────────────────┐
│  NIGHTLY (4 AM UTC, via vercel.json)                                │
│                                                                      │
│  /api/cron/refresh-pricing   ──────────►   fan out, one per product │
│  (orchestrator, 300s)                      ┌─────────────────────┐  │
│                                            │ /api/admin/         │  │
│                                            │   refresh-product-  │  │
│                                            │   pricing           │  │
│                                            │ (worker, 300s each) │  │
│                                            └──────────┬──────────┘  │
│                                                       │             │
│                                                       ▼             │
│                                            lib/pricing-refresh.ts   │
│                                            • CH batch-price-estimate│
│                                            • chunks of 100          │
│                                            • graceful partial       │
│                                              completion at deadline │
│                                                       │             │
│                                                       ▼             │
│                                            UPSERT pricing_cache     │
│                                              (throws on error)      │
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

- `app/api/cron/refresh-pricing/route.ts` — orchestrator. Lists active
  products with ≥1 CH-matched `player_product`, fans out via `Promise.all`
  (no throttle). Each fan-out is its own Vercel invocation.
- `app/api/admin/refresh-product-pricing/route.ts` — per-product worker.
  `maxDuration = 300`. Admin-auth'd for manual runs; cron hits it with
  `Authorization: Bearer CRON_SECRET`.
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

## Scaling properties

- **Products:** Tested to ~10 active; fan-out unbounded. Comfortable to ~50
  with no code changes. Past that, CH per-IP rate limits are the likely
  bottleneck — reintroduce a small concurrency cap in the orchestrator at
  that point (the previous `FAN_OUT_CONCURRENCY = 3` shape is a fine
  starting point).
- **Variants per product:** The per-product worker chunks CH calls at 100
  items with graceful partial completion before the 300s deadline. Bowman
  Chrome (~6,481 variants) completes in ~220s. If a single product needs
  more headroom than 300s can provide, the answer is to split it across
  multiple cron runs or queue it (not to bump `maxDuration` further).
- **Failure isolation:** Each worker fetch is wrapped — one product's 504
  doesn't poison the orchestrator's report.

## Vercel configuration requirements

- **Plan: Pro.** The worker needs 300s. Hobby's 60s cap cannot service
  large products (Bowman Chrome, Topps Finest). Reverting to Hobby means
  reverting to a queue-based design.
- **Env vars:** `CRON_SECRET` (shared auth between orchestrator and worker),
  `NEXT_PUBLIC_APP_URL` (for the fan-out base URL).
- **`vercel.json`:** Cron registered at `0 4 * * *` UTC. Don't tighten the
  schedule until we've added observability (cron runs log a summary; scale
  past that when we actually need intra-day freshness).

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
- Total cron wall time exceeds ~20 minutes (indicates CH latency
  regression or too many products for the fan-out pattern)

…add a PostHog event `cron_refresh_pricing_complete` with
`{ total, ok, errors, durationMs }` and a Slack webhook on `errors > 0`.

## What we tried and threw away

- **Consumer POST /api/pricing doing the heavy fetch** — worked on small
  products, 504'd on Bowman Chrome. Consumer latency was unacceptable even
  when it succeeded. (PRs #16–#20.)
- **`FAN_OUT_CONCURRENCY = 3` in the orchestrator** — made sense on Hobby
  when the orchestrator itself did work. On Pro with independent worker
  invocations, the throttle only serialized dispatch artificially. Removed.
- **Silent upsert error handling** (catch + `console.error`) — caused the
  "278 priced, 0 cached" bug in PR #25. The pattern is banned in this
  pipeline; upserts throw.

## Related docs

- [cardhedger-matching.md](./cardhedger-matching.md) — how `player_products`
  get their `cardhedger_card_id` in the first place (input to this pipeline)
- [catalog-preload-architecture.md](./catalog-preload-architecture.md) — the
  sibling `ch_set_cache` refresh pipeline (3 AM UTC)
- [cost-analysis.md](./cost-analysis.md) — CH API cost per refresh
