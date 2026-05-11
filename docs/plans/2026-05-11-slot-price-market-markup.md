# Slot price market markup (Plan B of the 2026-05-11 pricing trilogy)

**Status (2026-05-11):** Planned — not yet implemented. Plan A (per-product anchor configurator) shipped same day and unblocks this work. Dependency note: this multiplies the fair-value number, so it should run on a fair-value that already represents Kyle's intended anchoring.

Sibling plans:
- [docs/plans/2026-05-11-per-product-anchor-configurator.md](2026-05-11-per-product-anchor-configurator.md) — Plan A (shipped)
- [docs/plans/2026-05-11-release-freshness-decay.md](2026-05-11-release-freshness-decay.md) — Plan C (planned)

---

## Context

Kyle's thesis from the 2026-05-11 call: "this pricing will never match up to the price of a hobby box or a hobby case. You're paying a premium to not have to spend $12,000 on an entire case." He's right that real break asks consistently sit 15–40% above pure EV. Today's model produces *pure EV slot prices*, and `runBreakAnalysis` then judges asks against that pure-EV fair value — so we systematically signal BUY on what the market considers fair, and only signal WATCH on actual deals.

That's a structural mismatch between our model and how breakers actually price.

**Decision (locked in plan review):** ship the dual-number display. Keep pure-EV in `pricing_cache`, layer market markup at display time so the user sees both numbers and the BUY/WATCH/PASS signal is computed against market-adjusted fair value.

## Approach

Keep the engine's pure-EV math intact. Add a second number — `marketFairValue` — for display and for the signal.

1. **New constants file** `lib/market-markup.ts`:
   ```ts
   export const MARKET_MARKUP_BY_LIFECYCLE = {
     pre_release: 1.40,
     live:        1.20,
     dormant:     1.05,
   };
   export const MARKET_MARKUP_RANGE = 0.10;  // ± around the midpoint for the displayed range
   ```
   Tuning constants. No migration, no admin UI.

2. **Engine change** in `lib/analysis.ts:301`:
   - Compute `markup` from product `lifecycle_status` (already on row).
   - `marketFairLow = fairValue × (markup - range)`, `marketFairHigh = fairValue × (markup + range)`.
   - Pass `marketFairValue = fairValue × markup` to `computeSignal()` *instead of* `fairValue`.
   - Return both `fairValue` (pure EV) and `marketFairValue` from the analysis result.

3. **Display:**
   - `components/breakiq/PlayerTable.tsx` and team rows: market-adjusted slot cost as the primary number, fair value as a small grey "model: $X" beneath.
   - Break analysis result card: both `fairValue` and `marketFairValue` ranges.
   - `/analysis` (BreakIQ Sayz) deal checker: same dual display. Same `marketFairValue` everywhere.

4. **No DB migration.** All multipliers computed at render time from constants + `products.lifecycle_status`.

5. **No effect on `pricing_cache`.** Pure EV stays in the cache; markup applies on read. Tuning markup = code change + deploy, no recompute.

## Critical files

- `lib/analysis.ts:301–303` — fairValue computation + signal.
- `lib/engine.ts:91–98` — `computeSignal`. Unchanged; gets called with the market-adjusted value.
- New: `lib/market-markup.ts`.
- `components/breakiq/PlayerTable.tsx`, team rows, analysis result components.
- `app/(consumer)/break/[slug]/page.tsx` — pull `lifecycle_status` into the page so child components can compute markup.

## Open product questions

- Display label for the markup line? "Market Ask Range" / "Typical Ask" / "Street Price" / "Breaker Markup" — Kyle/Brody to name. Default suggestion: **"Market Ask Range"** for the range, **"Model Value"** for the pure-EV anchor underneath.

## Verification

1. Pick a live product with healthy CH data. Confirm slot prices visibly rise ~20% on the product page after the change.
2. Take a known break that's currently signaling BUY in the deal checker. Verify the signal shifts to WATCH or PASS appropriately.
3. Toggle the product to `pre_release` (lifecycle action). Confirm markup climbs to 1.40 in the display.
4. PostHog event `pricing_feedback_submitted`: pull the last 30 days of 👎 with category "pricing too low" — verify the share drops after deploy (longer-term test, not gating).
