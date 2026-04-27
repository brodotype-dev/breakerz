# Product Lifecycle: pre_release / live / dormant

**Date:** 2026-04-27
**Status:** Fully shipped — all 5 phases plus a follow-on biweekly dormant cron

> **What actually shipped vs the original plan**
>
> Plan originally scoped Phases 1, 2, 3 in this round and deferred 4 + 5. User opted into 4 + 5 same-day after seeing 1–3 ship cleanly, so all five phases landed. One additional change beyond the plan: a separate `/api/cron/refresh-dormant-pricing` cron that runs on the 1st and 15th of each month, replacing the original "dormant = no refresh ever" design with a biweekly snapshot refresh so the frozen pricing doesn't drift too far from market.
>
> See `docs/product-lifecycle.md` for the live architecture doc.

---

## Context

Today every product is treated as a single "live" thing — admin imports a checklist, finds a CH set, hydrates variants, loads odds, runs pricing. This works for products that exist on the secondary market but breaks down for two real cases:

1. **Pre-release products** have a checklist and chase-card hype but almost nothing on CardHedger yet (no comps, often no canonical set entry until release day). Forcing them through the live pipeline produces empty pricing and a worthless consumer view.
2. **Older products that are no longer being broken** still have data, but burning Vercel/CH budget refreshing them nightly is wasteful — and the consumer view should look more like a summary than a live trading floor.

The pieces are mostly already in place: `release_date` exists, an inlined `isPreRelease` check already drives a consumer banner, and a full `product_chase_cards` table + `ChaseCardsManager` (admin curation with system recommendations) + `ChaseCardsPanel` (consumer render) already shipped on 2026-04-23. What's missing is making "lifecycle" a real first-class concept that drives admin UX, cron behavior, and consumer rendering — instead of inferring it from a date string in three different places.

## Lifecycle Model

Three states on `products`:

| State | Meaning | CH activity | Consumer view |
|---|---|---|---|
| `pre_release` | Not out yet, no live market | None — crons skip | Hype layout: countdown, chase cards, player historical comps |
| `live` | Currently being broken — full pipeline | All crons run | Current break page (pricing engine, EV, BreakIQ Sayz) |
| `dormant` | Wound down — historical record only | Crons skip; pricing frozen at last refresh | Summary view: last priced snapshot, chase card outcomes, no live engine |

`is_active` stays as the publish gate (Draft → Published) and is **orthogonal** to lifecycle. A product can be a published pre-release, a draft live product, or a published dormant product. Lifecycle answers "what kind of product"; `is_active` answers "is the consumer-facing page on."

Transitions are admin-driven with sensible defaults:
- `pre_release → live` — manual button on the product dashboard, or auto on `release_date <= today` if `ch_set_name` is set (Phase 4)
- `live → dormant` — manual only ("Wind down")
- `dormant → live` — manual reactivation, rare

## Scope of this round

Decisions locked with the user:
- Third state name: `dormant`
- Lifecycle is **orthogonal** to `is_active` (publish gate stays separate)
- Ship **Phases 1, 2, and 3** in this round. Phases 4 and 5 are designed below for context but land in a later session.

## Phased plan

### Phase 1 — Foundation (no consumer-visible change)

Schema: add `lifecycle_status` enum to `products`, default `'live'`, backfill all existing rows to `live`.

```sql
-- supabase/migrations/<ts>_product_lifecycle.sql
CREATE TYPE product_lifecycle AS ENUM ('pre_release', 'live', 'dormant');
ALTER TABLE products
  ADD COLUMN lifecycle_status product_lifecycle NOT NULL DEFAULT 'live';
CREATE INDEX products_lifecycle_idx ON products(lifecycle_status);
```

Code touches:
- `lib/types.ts` — add `lifecycle_status` to `Product` type
- `app/admin/products/actions.ts` — accept `lifecycle_status` in `createProduct`/`updateProduct`
- `app/admin/products/page.tsx` + `ProductsTableView.tsx` — add a lifecycle column + filter (Pre-release / Live / Dormant tabs alongside the existing All/Active/Draft)
- `app/admin/products/NewProductForm.tsx` and `components/admin/ProductForm.tsx` — lifecycle picker (defaulting based on `release_date`: future → pre_release, past/today → live)

Crons: gate by `lifecycle_status = 'live'` (in addition to current `is_active`):
- `app/api/cron/refresh-pricing/route.ts:41`
- `app/api/cron/refresh-ch-catalogs/route.ts` (the existing `is_active` filter on the products select)
- `app/api/cron/update-scores/route.ts:71-72`
- `lib/cardhedger-catalog.ts:283`

After this phase, behavior is identical to today — but the foundation is in place.

### Phase 2 — Pre-release admin + consumer (mostly already built)

Most of this exists. The remaining work is connecting it.

Admin (`app/admin/products/[id]/page.tsx`):
- Show the existing `ChaseCardsManager` panel prominently when `lifecycle_status === 'pre_release'`
- Hide the Refresh Pricing / Refresh CH Catalog / Hydrate Variants quick actions when pre-release (replace with "Pre-release — these will activate at launch")
- Display a "Convert to Live" button that flips `lifecycle_status` and (if ready) kicks off catalog refresh + hydrate

Consumer break page (`app/(consumer)/break/[slug]/page.tsx`):
- Replace the inlined `isPreRelease` date check with `lifecycle_status === 'pre_release'` (admin-overridable instead of date-only)
- When pre-release: render a different layout — countdown hero, ChaseCardsPanel front-and-center, hide pricing/EV blocks, hide BreakIQ Sayz CTA
- Risk flags + chase cards still work as today

### Phase 3 — Pre-release pricing intel (the value-prop bit)

User decision locked in: **show comps for veterans, stay data-light for rookies/prospects.**

For each player on the pre-release checklist:
1. Determine if they have a CH presence: search CH by name (`searchCards` from `lib/cardhedger.ts`)
2. If found and they have meaningful sales history → pull a snapshot: top recent comp by raw + by PSA 10, 90-day median (`get90DayPrices`)
3. If not found OR `is_rookie` with insufficient data → render a "First-year card / no historical data" tile

New endpoint: `app/api/pre-release/player-snapshots/route.ts` — returns `{ playerProductId, comps: { raw, psa10, sales30d } | null, isVeteran }` for all players in a product. Cache hits aggressively (24h TTL via a new `pre_release_comp_cache` table or piggyback on `pricing_cache`).

Render in pre-release consumer view as a dedicated "What these players' cards do today" section, with explicit framing: *"These are comps from existing cards, not from this product."*

### Phase 4 — Conversion mechanic

Admin: "Mark as Live" button on the product dashboard. Validates `ch_set_name` is set; if yes, flips `lifecycle_status = 'live'` and dispatches:
1. CH catalog refresh (`/api/admin/refresh-ch-catalog`)
2. Variant hydration (`/api/admin/hydrate-variants`)
3. Pricing refresh (`/api/admin/refresh-product-pricing`)

Same readiness logic as today on the live product dashboard takes over from there (admin still needs to upload odds).

Optional: nightly cron that auto-flips pre-release products whose `release_date <= today` AND `ch_set_name IS NOT NULL`. Gated behind a feature flag for now; manual flip is fine until we've seen it work.

### Phase 5 — Dormant state

Admin: "Wind down to dormant" button on a live product's dashboard. Flips `lifecycle_status = 'dormant'`. No data destruction — pricing cache stays at last refresh.

Consumer: when `lifecycle_status === 'dormant'`, render a "summary" layout:
- Banner: "This product is no longer being actively tracked. Pricing snapshot from <last_priced>."
- Read-only roster + last-known pricing
- Chase card hits visible (the `is_hit` boolean on `product_chase_cards`)
- BreakIQ Sayz CTA removed
- Optional: "Reactivate" CTA for admins

Crons already skip via Phase 1's filter.

## Critical files

- `supabase/migrations/<ts>_product_lifecycle.sql` *(new)*
- `lib/types.ts` — `Product` type
- `app/admin/products/actions.ts` — `createProduct` / `updateProduct` payloads (already accepts `ch_set_name`; add `lifecycle_status`)
- `app/admin/products/page.tsx` + `ProductsTableView.tsx` — lifecycle filter + column
- `app/admin/products/NewProductForm.tsx` — lifecycle picker on create
- `components/admin/ProductForm.tsx` — lifecycle picker on edit
- `app/admin/products/[id]/page.tsx` — quick actions gated by lifecycle, "Mark as Live" / "Wind down" buttons
- `app/admin/products/[id]/ChaseCardsManager.tsx` — already built, no changes
- `app/(consumer)/break/[slug]/page.tsx` — replace inlined `isPreRelease` with `lifecycle_status` check; conditional layout
- `components/breakiq/ChaseCardsPanel.tsx` — already built, no changes
- All four cron files listed in Phase 1 — add `lifecycle_status = 'live'` filter
- `app/api/pre-release/player-snapshots/route.ts` *(new, Phase 3)*

## Verification

- Phase 1: run migration, confirm all existing products show `lifecycle: live` in the admin table, and the existing crons still pick up the same product set.
- Phase 2: create a pre-release product, confirm consumer page renders the chase-card-forward layout and pricing engine is hidden. Convert to live, confirm normal pipeline kicks in.
- Phase 3: pre-release with at least one veteran + one rookie player, confirm veteran shows comps and rookie shows the "no historical data" tile.
- Phase 4: hit "Mark as Live" with a valid CH set, confirm catalog/hydrate/pricing all chain through and the product appears in the live cron the next night.
- Phase 5: wind down a live product, confirm it disappears from the next cron run, and the consumer page shows the summary layout.

## Implementation order within this round

1. Migration + `lib/types.ts` + `Product` type updates (Phase 1 schema)
2. Cron filters added — verify each cron skips non-`live` products in a dev run
3. Admin form + table updates (lifecycle picker on create/edit, lifecycle column + tabs on the products table)
4. Consumer break page conditional layout (Phase 2): replace inlined `isPreRelease` with `lifecycle_status`, hide pricing engine when pre-release, show ChaseCardsPanel prominently
5. Admin product dashboard (Phase 2): gate quick actions by lifecycle, show ChaseCardsManager prominently for pre-release
6. Player snapshots API + cache table (Phase 3)
7. Render veteran-comps and rookie-data-light tiles in pre-release consumer view (Phase 3)

Phase 4 (Convert to Live mechanic) and Phase 5 (Wind down to dormant + summary view) deferred.
