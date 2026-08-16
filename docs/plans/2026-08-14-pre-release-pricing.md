# PRD — Pre-Release Pricing (previous-cycle baseline + sentiment)

**Status:** Approved 2026-08-14 (Brody). Phase 1 building. **This is the definitive path for every pre-release product — no feature flag.** Owner: Brody. Source: 2026-08-14 Kyle calls.

**Decisions (2026-08-14):** (1) baseline = previous-product cached EV when `previous_product_id` is linked, else `raw_avg_90d`; (2) **trend deferred** — v1 skips it (see icebox); (3) pre-release renders **both** the chase layout *and* the priced board; (4) **no flag** — every pre-release product uses this once shipped.

## Problem
Pre-release products have **no EVs** — the product hasn't shipped, so there are no CardHedger sales or odds for it. Today `/break/[slug]` renders the hype/chase layout (chase cards + 90-day historical comps) — it does **not** produce a priced slot board. So everything we shipped this session (per-player sentiment editor, compression markup) is really **live-only**: sentiment has no EV to modulate, and compression never runs (pre-release skips the slot tables).

But users want the same answer pre-release: **who's the value spot, who has the highest upside.** We can't derive that from the unreleased product — we synthesize it from **last cycle + our read.**

## The model (Brody's framing)
Give every player a **baseline EV going into the new product**, then **adjust from there**:

```
pre_release_base_ev(player)  =  baseline(from previous cycle + trend)  [non-rookie]
                              |  rank-tiered floor / manual            [rookie]

pre_release_slot_ev(player)  =  pre_release_base_ev × (1 + effectiveScore)   ← sentiment adjusts
                                (effectiveScore already folds in breakerz_score = the Roster editor)
```

That synthetic EV then feeds the **same slot-pricing pipeline** as live — so pool allocation, the per-product markup, and compression (per-product γ) all apply for free. Pre-release becomes "EV = synthesized baseline," and the rest of the machinery is unchanged.

### Baseline sources (non-rookie)
Product character matters — a player's Chrome value ≠ their Pristine value. So prefer the **same product line's prior cycle**, in priority order:
1. **Previous-cycle product** (new `products.previous_product_id`, admin-linked — 2026 Bowman ← 2025 Bowman, Chrome Update ← Chrome, Update Sapphire ← Chrome Sapphire): the player's value there (its `pricing_cache` EV, or its base-card comp). Product-specific — the ideal.
2. **Fallback: `pre_release_player_snapshots.raw_avg_90d`** — the player's existing-cards 90-day comp we *already capture* for pre-release. Generic (cross-product) but real.
3. **× trend adjustment** — recent sale-amount trend (rising/falling) from CardHedger, so a hot player's baseline leans up.

### Baseline (rookie — the ~5 that matter)
No prior cycle (they're new). Use the **rank-tiered floor** ([lib/pre-release-base-ev.ts](../../lib/pre-release-base-ev.ts), already built for Bowman prospects) or a manual value. Kyle: "there's like five of them" — manual assessment is fine and expected.

## Data model
- `products.previous_product_id uuid null` (FK → products) — links the prior-cycle product. Admin sets it on the product form.
- `player_products.pre_release_base_ev numeric null` — the synthesized baseline per player, per product. Computed by an admin action, then **admin-adjustable** (nudge a specific player).

## Build phases
**Phase 1 — baseline synthesis (no consumer change).**
- Schema above.
- Admin action **"Build pre-release baseline"** on the pre-release product page: for each roster player → rookie ? floor : (previous-cycle value ?? `raw_avg_90d`) × trend → write `pre_release_base_ev`. Idempotent, re-runnable. Shows a preview table (player · baseline · source) before writing.

**Phase 2 — priced pre-release board (the payoff). ✅ SHIPPED 2026-08-14.**
- `loadPreReleaseBaseline` ([lib/pricing-read.ts](../../lib/pricing-read.ts)) builds the same `PlayerWithPricing` rows as `loadCached` but with EV from `pre_release_base_ev` (`pricingSource: 'pre_release_baseline'`); the break-page loader picks it for pre-release products. `BreakPageClient` renders a **"Projected Slot Pricing"** board (`TeamSlotsTable` / `PlayerTable`, teams/players toggle) **below the chase layout** — self-gating on "any baseline present," so a product with no baseline is byte-for-byte unchanged.
- Sentiment (`breakerz_score` via the Roster editor) modulates it; compression + per-product γ reshape the display. **All existing machinery, no new pricing code.**
- **No feature flag** (decision #4) — this is the standard pre-release surface. It only renders when a baseline exists, so it's self-gating: no baseline built → no board, exactly as today.

**Phase 3 — refinement.**
- Better trend model; auto-suggest sentiment from `/url-source` / editorial intel; per-line default γ.

## How it connects to what's already built
- **Roster Sentiment editor** = the "adjust from there" step. ✅ built — becomes load-bearing pre-release once a baseline exists to modulate.
- **`pre-release-base-ev.ts`** = the rookie floor. ✅ partially built (Bowman prospects).
- **Compression + per-product γ** = applies to the synthetic-EV board unchanged. ✅ built.
- **`pre_release_player_snapshots`** = the fallback comp input. ✅ already captured + displayed.
- **New:** `previous_product_id` link, `pre_release_base_ev` column, the baseline-build action, and pointing the pre-release render at the synthetic EV.

## Lifecycle handoff
When the product flips `pre_release → live`, real CardHedger EVs take over — `pre_release_base_ev` is superseded by `pricing_cache` (ignored once live). Clean cutover; the synthetic baseline was only ever the stand-in until real sales exist.

## Known hard case (Kyle flagged it)
The **first cycle of a re-based checklist** (all-new rookies; last year's rookies became second-years) is the hardest — non-rookies still map to their prior-cycle value, but genuinely-new entrants need manual. "A problem for a different day" — Phase 1 handles the common case (non-rookies auto, rookies manual); the fully-new-checklist edge stays manual.

## Resolved decisions (2026-08-14)
1. ✅ Baseline = previous product's `pricing_cache` EV when `previous_product_id` is linked, else `raw_avg_90d`.
2. ✅ Trend **deferred to v2** — v1 baseline is the flat previous-cycle value, no trend multiplier. Tracked in [docs/icebox.md](../icebox.md).
3. ✅ Render **both** — the priced board sits alongside the chase/hype layout.
4. ✅ **No flag** — definitive path for every pre-release; self-gates on "baseline exists."
