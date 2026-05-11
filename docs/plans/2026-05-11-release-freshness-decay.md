# Release freshness decay — lifecycle-aware pricing (Plan C of the 2026-05-11 pricing trilogy)

**Status (2026-05-11):** Shipped — `lib/market-markup.ts` extended with `RELEASE_PREMIUM = 1.15`, `FRESHNESS_PREMIUM = 0.20`, halflife 10d, settled past day 30; `lifecycleEvMultiplier()` applied at all 7 cache-row push sites in `lib/pricing-refresh.ts` via the `applyMultiplier()` helper. Migration `20260512170000_products_live_since.sql` applied to prod via Supabase MCP — backfilled `live_since = created_at` on 15/15 live products (all past 30d floor, multiplier = 1.0, no behavior change). `setProductLifecycle` stamps `live_since = now()` only on `pre_release → live` transitions (dormant → live reactivations don't reset the clock). `RefreshSummary` exposes `lifecycleStatus` + `lifecycleMultiplier`; cron log shows `lifecycle=live mult=1.200`.

Sibling plans:
- [docs/plans/2026-05-11-per-product-anchor-configurator.md](2026-05-11-per-product-anchor-configurator.md) — Plan A (shipped)
- [docs/plans/2026-05-11-slot-price-market-markup.md](2026-05-11-slot-price-market-markup.md) — Plan B (planned)

---

## Context

`products.lifecycle_status` (`pre_release` / `live` / `dormant`) was introduced 2026-04-27 to drive admin UX, cron behavior, and the pre-release hype layout. The engine math itself doesn't read it. That's fine when pricing pure EV, but combined with Plan A (anchor strategies) and Plan B (market markup), the lifecycle is the right place to switch between distinct *pricing regimes*.

Kyle's release-week intuition from the 2026-05-11 call: "even when Bowman basketball came out, Cooper Flagg crystallized insert had a $9,500 sale within 48 hours. A week and a half later it was down to $2,500." Pure-EV models that read live sales data over a 90-day window can't capture that decay — they average yesterday's spike with last month's settled price. Pre-release products have no sales of *their* cards, only of the player's *other* products.

This plan adds three lifecycle-specific behaviors:

1. **Pre-release**: discount comp prices from prior-year / sibling products to account for release-week fade.
2. **Live (release window)**: weight the most-recent 14 days higher than older sales to track week-1 decay.
3. **Dormant**: use today's settled math. No change.

## Approach — Path 1 (locked)

CH's `batch-price-estimate` returns a single averaged price per card. We don't get per-sale time-series in the bulk endpoints. So the math-layer fix uses multipliers on top of what CH already gives us, rather than rolling our own time-weighting. Cheap, no new CH calls, one schema change (`products.live_since`).

- Pre-release products don't hit CH at all today (`products` cron skips them per CLAUDE.md). They render from `pre_release_player_snapshots` (90-day comps on the player's *other* products).
- For pre-release: introduce a `RELEASE_PREMIUM` multiplier applied to the snapshot-derived EV. Default 1.15 (modest — Plan B already adds 1.40 on the display side, so the math layer shouldn't double-stack). Lives in `lib/market-markup.ts` alongside Plan B constants.
- For first-2-weeks-live: introduce a `freshnessMultiplier` — when a product transitions `pre_release → live`, stamp `products.live_since`. EV gets multiplied by `1 + (FRESHNESS_PREMIUM × decay(daysSinceLive, FRESHNESS_HALFLIFE))`. Default `FRESHNESS_PREMIUM = 0.20`, `FRESHNESS_HALFLIFE_DAYS = 10`. Decays exponentially. Settles to 1.0 past day 30.
- For dormant: no change. The 1.05 in Plan B handles "still a market but it's settled."

Path 2 (rolling our own time-weighted sales analysis) is deferred to [docs/icebox.md](../icebox.md).

## Approach detail

1. **Migration:** add `products.live_since timestamptz` (nullable). Backfilled to `created_at` on existing live products.
2. **Admin lifecycle transition** (`pre_release → live`) in the existing confirm dialog: stamps `live_since = now()`.
3. **New helper** in `lib/market-markup.ts` (alongside Plan B's constants):
   ```ts
   export const RELEASE_PREMIUM = 1.15;        // pre-release math layer
   export const FRESHNESS_PREMIUM = 0.20;      // peak markup right after live
   export const FRESHNESS_HALFLIFE_DAYS = 10;  // exponential decay
   export function freshnessMultiplier(liveSince: string | null): number {
     if (!liveSince) return 1.0;
     const days = (Date.now() - new Date(liveSince).getTime()) / 86_400_000;
     if (days > 30) return 1.0; // cleanly settle past the 30d mark
     return 1 + FRESHNESS_PREMIUM * Math.pow(0.5, days / FRESHNESS_HALFLIFE_DAYS);
   }
   ```
4. **Apply in `lib/pricing-refresh.ts`** AFTER aggregating per-player EV (post Plan A's `aggregatePlayerEV` call, before pushing to `cacheRows`):
   - Look up `lifecycle_status` + `live_since` (already loaded into the `product` variable).
   - Pre-release: `evMid *= RELEASE_PREMIUM`, same for evLow/evHigh.
   - Live: `evMid *= freshnessMultiplier(product.live_since)`.
   - Dormant: no change.
5. **`pricing_cache` gets the lifecycle-adjusted value.** Plan B's market-markup then layers on top at display time. This separation matters: math-layer premium reflects *real expected sale prices in this window*; Plan B's display markup reflects *the breaker's margin*. They compound legitimately.
6. **Telemetry:** add `lifecycle_status`, `live_since`, `freshness_multiplier` to refresh log line.

## Critical files

- `lib/pricing-refresh.ts:495–502` — apply multiplier after `aggregatePlayerEV`.
- `lib/market-markup.ts` — created in Plan B, extended here.
- `app/admin/products/[id]/LifecycleTransitionButton.tsx` — stamp `live_since` on `pre_release → live`.
- New migration: `supabase/migrations/20260512yyyyyy_products_live_since.sql`.

## Verification

1. Pick a pre-release product. Refresh pricing. Confirm `evMid` is ~15% higher than what `pre_release_player_snapshots.raw_avg_90d` would yield.
2. Flip a product `pre_release → live`. Refresh. `live_since` should stamp; freshness multiplier should be ~1.20 (peak).
3. Wait 10 days (or hand-edit `live_since` for testing). Re-refresh. Multiplier should be ~1.10.
4. 30+ days. Multiplier = 1.00.
5. Verify against a real release: Bowman Chrome basketball release week — confirm Cooper Flagg slot pricing tracks observed eBay decay.
