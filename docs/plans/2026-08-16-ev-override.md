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

"EV Overrides" section on `/admin/products/[id]`
([EvOverridesManager.tsx](../../app/admin/products/%5Bid%5D/EvOverridesManager.tsx)),
placed right after Pricing Anchor Strategy. Debounced player search (scoped to
the product's roster) → enter base EV + optional note + who set it → Save.
Active overrides list shows the override next to the current modeled EV
(`$350` vs `model $121`) with a Clear button. API:
[app/api/admin/ev-overrides/route.ts](../../app/api/admin/ev-overrides/route.ts)
(GET list+search / POST set / DELETE clear; `checkRole('admin','contributor')`).

## Consumer transparency

[WhyThisPriceCard](../../components/breakiq/WhyThisPriceCard.tsx) shows
"Manual override — base EV set by BreakIQ" as the baseline source (blue) and
suppresses the lifecycle-math line (override isn't lifecycle-derived).

## Not built / deferred

- Bulk import of overrides (CSV) — single-player entry is enough for now.
- An expiry / auto-clear on overrides — they persist until cleared by hand.
- Applying the override to the raw player drawer variant table (it stays
  CH-sourced; the override moves the slot EV, not per-variant prices).
