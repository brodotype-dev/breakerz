---
status: planned (not started)
created: 2026-05-10
target: ship before active product count crosses 25
---

# Streaming pricing refresh

Rearchitect pricing refresh from "process one product end-to-end inside a single Vercel invocation" to "stream variants through a stateless cache, aggregate cheaply on a separate cron." Resolves the throughput ceiling that makes the current system unworkable past ~15-20 active products.

## Why the current architecture can't scale

The pipeline today does product-by-product end-to-end work inside a single Vercel function:

1. Cron orchestrator picks N stalest products
2. Fans out HTTP POSTs to `/api/admin/refresh-product-pricing` (concurrency=3)
3. Each worker fetches every CH card for that product, builds aggregated `pricing_cache` rows, writes them at the end (or via incremental flush since 2026-05-09)
4. Each worker has a 300s Vercel ceiling

**The throughput math:**
- 5 cron firings/night × 3 concurrent workers × 1 product per worker invocation ≈ **15 products refreshed per night, on a healthy day**
- Big products (10k+ variants) eat an entire 300s worker invocation each
- TCP-disconnect-related kill behavior on this runtime means partial work is fragile (which is what `ch_price_cache` was designed to mitigate, but it's a band-aid)

**At scale this falls apart:**
- 25 active products: cycle time ~2 days. Most products show >24h-stale data most of the time.
- 50 products: ~3-4 days cycle. The 22h staleness threshold becomes meaningless — everything is always stale.
- 100 products: 7+ days. Effectively no fresh pricing.

There is no realistic Vercel-Pro-bound knob that buys us a 5x throughput improvement on the current shape. Concurrency was already tried at 16 → starved bandwidth and broke timeouts. 300s is a hard ceiling.

## Target architecture

Two stateless crons. Neither knows about "products" as units of work.

### Cron 1: variant-priced refresh (every 5 min)

```
For up to N (= 500-ish) CH cards where ch_price_cache is null OR fetched_at < now() - 24h:
  - Batch them in chunks of 100
  - Fire 3-grade batchPriceEstimate per chunk (Raw + PSA 9 + PSA 10)
  - Upsert each chunk's results to ch_price_cache immediately
  - Exit when budget hit OR queue drained
```

Properties:
- **No "product" awareness.** Picks the staleest CH cards globally.
- **Naturally fair.** A 10k-variant product gets its cards refreshed at the same per-card cadence as a 100-variant product. No starvation.
- **Bounded per-invocation work.** N=500 cards × 3 grades / 12-way concurrency ≈ ~30s of CH work. Comfortably fits in 300s with massive headroom.
- **Adding products doesn't change cron timing.** It just means the next-stalest card might wait an extra firing or two. Linear degradation, not cliff.
- **Already 80% built.** `ch_price_cache` schema and the per-chunk write logic already exist from the 2026-05-09 PR. The new cron is a thin wrapper around what's in `runChunk` today.

### Cron 2: pricing_cache aggregation (every 15 min)

```
For each active live product:
  - Read all variants joined with ch_price_cache (single SQL)
  - Aggregate per-PP EV from cached prices using existing engine math (1/1 filter, sets-weighting, etc.)
  - Apply the existing fallback ladder for PPs with no priced variants (sibling, search, default)
  - Upsert pricing_cache rows
```

Properties:
- **No CH calls in this path.** Pure read+aggregate. ~5s per product.
- **Fan-out friendly.** All ~25-100 products process inside one cron invocation easily (5s × 50 = 250s).
- **Always fresh relative to ch_price_cache.** Whatever's in the cache today shows up in pricing_cache within 15 min.
- **Same EV math.** No engine changes; the aggregation logic moves out of `lib/pricing-refresh.ts` into a smaller `lib/aggregate-pricing.ts` and the existing fallback ladder follows.

### What goes away

- `/api/admin/refresh-product-pricing` end-to-end semantics (admin manual button needs a new path — see Migration)
- `/api/cron/refresh-pricing` orchestrator (replaced by the variant-priced cron)
- The orchestrator/worker abort dance + checkpoint logging (no longer relevant)
- The 22h staleness threshold (variants get refreshed on a continuous cadence)

## Phasing

**Phase 1 — variant cron (~½ day)**
- New `/api/cron/refresh-variants` reading stale CH cards, calling existing `runChunk`-style logic, writing `ch_price_cache`
- Add to `vercel.json` at every 5 min
- Old `/api/cron/refresh-pricing` left running in parallel as a safety net

**Phase 2 — aggregation cron (~½ day)**
- Extract the per-PP aggregation logic from `lib/pricing-refresh.ts` into a focused module
- New `/api/cron/aggregate-pricing` runs that for every active product
- Add to `vercel.json` at every 15 min
- Verify `pricing_cache` continues being populated correctly while old cron also runs

**Phase 3 — cutover (~½ day)**
- Remove `/api/cron/refresh-pricing` from `vercel.json`
- Rewrite `/api/admin/refresh-product-pricing` (admin manual button) to: (a) force-stale this product's variants by bumping their `fetched_at` to NULL, (b) trigger an immediate variant cron run via internal HTTP. Or simpler: change the button to "Mark for refresh" + show a wait estimate.
- Delete the worker checkpoint logging from `cron_run_log` (no longer needed for diagnosis)
- Update CLAUDE.md, BACKLOG, CHANGELOG

Total effort: ~1.5 days end-to-end.

## Open questions

- **Admin manual refresh UX.** Today the button is "Refresh Pricing" → wait ~60s → see results. Under the new architecture, manual refresh becomes "force this product's variants stale → wait for the next variant cron firing (max 5 min)." Need to decide if that's acceptable or if we want a synchronous escape hatch.
- **Cron 1 budget tuning.** 500 cards/firing is a starting estimate. Need to measure actual CH latency under sustained load to size correctly.
- **Cron 2 redundancy.** Should the aggregation cron also opportunistically run at the END of a Cron 1 firing? Adds liveness, costs little.
- **Rate limit pressure.** Higher cadence = more total CH calls per hour. Currently 5 firings × ~2-3k cards = ~15k CH cards refreshed per night. New design at 12 firings/hour × 500 cards × 3 grades = ~430k CH calls per day. Need to validate that's within CH's tolerance before committing — possibly negotiate or back off the cadence.

## Out of scope

- Per-variant cache eviction (LRU, etc.) — not needed at our scale
- Batched UPDATEs to player_product_variants for any new derived fields — current schema unchanged
- Webhook-driven refresh (CH push notifications) — not on CH's roadmap

## Cross-references

- `docs/pricing-architecture.md` — current design (will need a rewrite at Phase 3)
- BACKLOG item D was a partial precursor; the per-CH-card cache it described shipped 2026-05-09 and is the foundation this plan builds on
- 2026-05-09 PR (#68) and 2026-05-10 PR (#71) were the band-aids that bought time for this plan
