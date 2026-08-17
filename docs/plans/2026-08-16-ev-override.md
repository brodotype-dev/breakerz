# Per-player-per-product EV override

**Status:** ✅ Shipped 2026-08-16. Scope as built matches the plan.

## Problem

The pricing engine sometimes gets a player's base EV wrong — a prospect we
expect to explode (thin comps, no market yet), or a base the model mis-prices
against what Brody/Kyle know from the field. There was no lever to correct a
single player's EV short of re-configuring anchors or waiting for CH data.

## Decision

A manual **base-EV override** per `player_product`, set by an admin. The
override is the base EV — it flows through the same render pipeline as any
modeled EV (pool weighting → display breaker markup → compression), so the
slot price ends up **higher** than the entered number. It does **not** pin the
final slot price (confirmed with Brody 2026-08-16).

## Architecture — read-time precedence

The override is applied at **read time**, in every place a `PlayerWithPricing`
row is assembled, via one shared helper `evOverrideFor()`
([lib/ev-override.ts](../../lib/ev-override.ts)). This — not a `pricing_cache`
write — is the true single chokepoint, because live and pre-release products
use different EV read paths:

| Read path | File | Sources EV from |
|---|---|---|
| Consumer break page (live/dormant) | `loadCached` in [lib/pricing-read.ts](../../lib/pricing-read.ts) | `pricing_cache` |
| Consumer break page (pre-release) | `loadPreReleaseBaseline` in [lib/pricing-read.ts](../../lib/pricing-read.ts) | `player_products.pre_release_base_ev` |
| Deal checker (`/analysis`, inline break block) | `runBreakAnalysis` in [lib/analysis.ts](../../lib/analysis.ts) | `pricing_cache` + live CH fallback |
| Admin Market Delta Watch (Δ vs model) | `getTeamFairValuesForProduct` in [lib/team-fair-value.ts](../../lib/team-fair-value.ts) | `pricing_cache` |

All four already `select('*')` on `player_products`, so `ev_override` is in the
row with **zero extra queries**. Each substitutes the override triple when
present and stamps `pricingSource: 'override'`.

Consequences of read-time (vs. writing into `pricing_cache`):

- **Authoritative** regardless of cache / refresh state — an override is live
  the instant it's saved, no pricing refresh needed.
- **Durable** across every refresh — the refresh keeps writing modeled CH
  numbers to `pricing_cache`; the read layer just prefers the override.
- **Works identically for live and pre-release.** A cache write would be
  invisible to pre-release (it reads the column, not the cache).
- The engine, refresh pipeline, and `pricing_cache` are **untouched**.

### Derivation

Override sets `evMid`. `evLow = round(mid × 0.35)`, `evHigh = round(mid × 2.5)`
— same spread the fallback rungs use, so the player drawer + "Why this price?"
render a sensible band. The override is treated as the **post-lifecycle** base
EV: the read layer does not re-apply the math-layer lifecycle multiplier
(RELEASE_PREMIUM / freshness decay). Display markup + compression + pool
weighting still apply at render.

## Schema

Migration [20260816120000_player_products_ev_override.sql](../../supabase/migrations/20260816120000_player_products_ev_override.sql)
(applied to prod via Supabase MCP). Additive nullable columns on the existing
`player_products` table — no new grants (gotcha #12), no RLS change (service-role
access only), no functions (no NOTIFY):

- `ev_override numeric` — base EV; NULL = use modeled EV
- `ev_override_note text` — why
- `ev_override_set_by text` — who (Brody / Kyle)
- `ev_override_set_at timestamptz` — when

## Admin UX

An **EV Override column** on the **Roster Sentiment** grid
([RosterSentimentEditor.tsx](../../app/admin/products/%5Bid%5D/players/RosterSentimentEditor.tsx),
`/admin/products/[id]/players`) — the per-player surface that already carries the
sentiment ± lever, has search / team-filter / slot-eligible controls, and states
"feeds the pricing engine directly." A per-row `$` input sits next to Sentiment;
the modeled EV shows as the placeholder (`model 121`) for context, and blanking
the field clears the override. The grid's single **Save all** persists both
levers: `saveBreakerzBets` for changed sentiment rows and the new
`saveEvOverrides` for changed override rows ([actions.ts](../../app/admin/products/actions.ts),
`checkRole('admin','contributor')`), run in parallel. Overrides apply
immediately (read-time); sentiment reflects on the next refresh.

> **Design note (2026-08-16):** the first cut shipped a standalone "EV Overrides"
> section with its own player-search picker on the product **dashboard**
> (`EvOverridesManager.tsx` + `/api/admin/ev-overrides`). Brody flagged the
> Roster Sentiment grid as the natural home — one per-player surface, no second
> search UI. Moved onto the grid; the dashboard section + its component + route
> were deleted.

CSV Template / Export / Import on that grid stay **sentiment-only** for now —
the override is set inline. Adding it to the CSV round-trip is a possible
follow-up (needs a column added to the positional import parser).

## Consumer transparency

[WhyThisPriceCard](../../components/breakiq/WhyThisPriceCard.tsx) shows
"Manual override — base EV set by BreakIQ" as the baseline source (blue) and
suppresses the lifecycle-math line (override isn't lifecycle-derived).

## Not built / deferred

- Bulk import of overrides (CSV) — single-player entry is enough for now.
- An expiry / auto-clear on overrides — they persist until cleared by hand.
- Applying the override to the raw player drawer variant table (it stays
  CH-sourced; the override moves the slot EV, not per-variant prices).
