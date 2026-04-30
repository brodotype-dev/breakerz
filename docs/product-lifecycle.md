# Product Lifecycle

**Last updated:** 2026-04-30

Three first-class lifecycle states on `products`: `pre_release`, `live`, `dormant`. Drives admin UX, cron behavior, and consumer rendering. Orthogonal to `is_active` (which remains the publish/Draft gate).

---

## States

| State | Meaning | Cron behavior | Consumer view |
|---|---|---|---|
| `pre_release` | Not out yet — checklist + chase hype, no CH market | Skipped by every cron | Pre-release layout: countdown, chase cards, player historical comps, no live engine |
| `live` | Actively being broken — full pipeline | Daily pricing + CH catalog refresh + score updates | Current break page (pricing engine, EV, BreakIQ Sayz) |
| `dormant` | Wound down — historical reference only | Skipped by daily crons; **biweekly pricing refresh only** (1st + 15th at 7 AM UTC) | Frozen banner, read-only player table, cases counter hidden |

`is_active` (boolean) and `lifecycle_status` (enum) are independent. A product can be:
- Draft + pre_release (admin prepping, not yet visible to consumers)
- Active + pre_release (consumers see the hype layout)
- Active + live (current default — consumers see the live engine)
- Active + dormant (consumers see the frozen reference)

---

## Schema

Migration: `supabase/migrations/20260427120000_product_lifecycle.sql`

```sql
CREATE TYPE product_lifecycle AS ENUM ('pre_release', 'live', 'dormant');
ALTER TABLE products
  ADD COLUMN lifecycle_status product_lifecycle NOT NULL DEFAULT 'live';
CREATE INDEX products_lifecycle_idx ON products (lifecycle_status);
```

All existing products were backfilled to `'live'` so behavior is unchanged on deploy.

Pre-release supplemental table — caches per-player comp snapshots:

Migration: `supabase/migrations/20260427130000_pre_release_player_snapshots.sql`

```sql
CREATE TABLE pre_release_player_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_product_id uuid REFERENCES player_products(id) ON DELETE CASCADE UNIQUE,
  has_history       boolean NOT NULL DEFAULT false,
  raw_avg_90d       numeric(10, 2),
  psa10_avg_90d     numeric(10, 2),
  raw_sales_90d     integer,
  psa10_sales_90d   integer,
  fetched_at        timestamptz NOT NULL DEFAULT now()
);
```

24h TTL. Anon-readable (powers the consumer pre-release layout).

---

## Cron behavior

Every cron that touches products gates on `lifecycle_status = 'live'`:

- `app/api/cron/refresh-pricing/route.ts` — daily, 5 staggered firings (4:00, 4:30, 5:30, 6:00, 6:30 UTC)
- `app/api/cron/refresh-ch-catalogs/route.ts` — daily at 3 AM UTC (via `lib/cardhedger-catalog.ts → listActiveProductsWithCHSet`)
- `app/api/cron/update-scores/route.ts` — daily at 5 AM UTC (joins to `products!inner` and filters by lifecycle on the join)

Plus one cron specifically for dormant:

- `app/api/cron/refresh-dormant-pricing/route.ts` — biweekly at 7 AM UTC on the 1st and 15th of each month. Fans out the dormant set in parallel (typically <10 products, no concurrency cap needed). Reuses the existing `/api/admin/refresh-product-pricing` worker endpoint.

Pre-release products receive **zero** automatic refreshes — there's nothing on CH to refresh against until launch.

---

## Pre-release pricing intel

Endpoint: `app/api/pre-release/player-snapshots/route.ts`

Called by `PreReleaseLayout` on consumer page load. For each non-rookie player on the roster:

1. Check `pre_release_player_snapshots` for a fresh entry (< 24h)
2. If stale or missing → call CardHedger `get90DayPrices(playerName, sport)`
3. Threshold: `raw_sales_90d >= 3` to count as `has_history`. Below that, the player renders as "No data."
4. Persist to cache, return to client

**Rookies are deliberately skipped** (no CH lookup at all). Per product spec: stay data-light for first-year cards because their CH presence is mostly college / pre-rookie noise that misrepresents what their hobby cards will do.

Concurrency: 5 in flight at once. A 100-player cold-cache fetch comfortably fits within the 60s function budget.

---

## Admin UX

### Lifecycle picker

Both the create form (`app/admin/products/NewProductForm.tsx`) and the edit form (`components/admin/ProductForm.tsx`) include a 3-segment lifecycle picker.

On create, lifecycle defaults to `live` but auto-flips to `pre_release` if `release_date` is in the future. Admin can override.

### Lifecycle column on the products table

`/admin/products` (the canonical admin index — note: `/admin` redirects here) shows a Lifecycle column with colored badges and a Lifecycle filter dropdown alongside the existing Sport / Year / Status filters.

### Transition buttons

`app/admin/products/[id]/LifecycleTransitionButton.tsx` — a confirm-dialog button with three variants:

| Variant | Shown when | Validation |
|---|---|---|
| `to_live` | lifecycle = pre_release | Blocks if `ch_set_name` is null |
| `to_dormant` | lifecycle = live | None — confirm dialog only |
| `reactivate_to_live` | lifecycle = dormant | Blocks if `ch_set_name` is null |

Backed by `setProductLifecycle` server action in `app/admin/products/actions.ts`.

**Convert to Live does NOT auto-chain catalog refresh / hydrate / pricing.** After confirming the lifecycle flip, admin clicks the existing Quick Actions buttons (Refresh CH Catalog → Hydrate Variants → Refresh Pricing) deliberately. This keeps failures visible — preferable to a silent half-state where the lifecycle flipped but data is broken.

### Lifecycle banners on the product dashboard

When `lifecycle_status` is `pre_release` or `dormant`, a context banner appears above Quick Actions explaining cron behavior and surfacing the next-state transition button.

---

## Consumer rendering

Driven by `lifecycle_status` in `app/(consumer)/break/[slug]/page.tsx`:

```ts
const lifecycle = (product?.lifecycle_status ?? 'live');
const isPreRelease = lifecycle === 'pre_release';
const isDormant = lifecycle === 'dormant';
```

### Pre-release

Component: `components/breakiq/PreReleaseLayout.tsx` (refreshed 2026-04-30 — see `docs/plans/2026-04-30-pre-release-polish.md`)

- **Countdown hero**: D · HH · MM when ≥1 day out; ticks to HH:MM:SS on launch day; pulses "🔴 Live now" if `release_date` has passed but admin hasn't flipped to `live` yet. Sport gradient passed in from the parent break page.
- **Sub-hero ribbon**: launch date + hobby case price + BD case price; rows drop out when data isn't set. Asking-price chip rides here when product-scope `asking_price` observations exist.
- **Product-scope hype banner**: rendered above chase cards when product-scope `hype_tag` observations are active. Shows tag label, source narrative excerpt, relative time.
- `<ChaseCardsPanel>` reused — primary signal during pre-release
- **Watching widget**: top 3 players by `raw_avg_90d` from snapshots. Hidden if no roster has history.
- **Player checklist** with live-fetched 90-day comps:
  - Player name + RC tag (if rookie) + active risk flags + player-scope hype chips
  - Raw avg 90d, **PSA 9 avg 90d**, PSA 10 avg 90d, sales 90d count, team
  - Sort selector (`Raw avg` / `PSA 10` / `A→Z` / `Rookies`), filter chips (`All / Rookies / Has history / Risk flag`), group-by-team toggle
  - Risk-flag pills more prominent (10px filled background, pulse on `injury` / `suspension`); tooltip shows the full note
  - Top-3 by current value-based sort get `▲1 / ▲2 / ▲3` rank flair
  - Rookies show "No data" (data-light per spec)
- Live engine completely hidden: cases counter, tab bar, slot tables, BreakIQ Sayz CTA all gone

### Pre-release data sources

- `pre_release_player_snapshots` (24h cache) for raw / PSA 9 / PSA 10 90-day comps. PSA 9 columns added 2026-04-30 via `20260430210000_pre_release_psa9.sql`.
- `market_observations` filtered to `observation_type IN ('hype_tag', 'asking_price')` and `product_id = <this product>`. The `asking_price` query runs **only when** `lifecycle_status = 'pre_release'` so the live-page fetch path is unchanged. Engine reads stay deferred (Phase 3c).

### Live (default)

Unchanged from prior behavior. Pricing engine, EV, slot tables, cases counter, all the existing consumer affordances.

### Dormant

Existing live engine renders, with two modifications:
- Banner: "Pricing refreshes biweekly instead of nightly — values may lag the live market. Treat as historical reference, not a real-time read."
- Cases counter + break-cost summary hidden (no active break to configure)
- Player table + chase cards remain visible as historical reference

---

## State transitions

```
                    ┌─────────────────────┐
                    │                     │
                    ▼                     │
         ┌──────────────────┐             │
         │   pre_release    │             │
         └────────┬─────────┘             │
                  │ admin: Mark as Live   │
                  │ (requires ch_set_name)│
                  ▼                       │
         ┌──────────────────┐             │
         │       live       │             │
         └────────┬─────────┘             │
                  │ admin: Wind Down      │
                  ▼                       │
         ┌──────────────────┐             │
         │     dormant      │─────────────┘
         └──────────────────┘  admin: Reactivate to Live
                                (requires ch_set_name)
```

There's no automatic transition today. A future enhancement could auto-flip `pre_release → live` on `release_date` reaching today (gated behind a feature flag), but the manual flip is fine until we've validated the readiness signal.

---

## Files

```
supabase/migrations/
  20260427120000_product_lifecycle.sql           — enum + column + index
  20260427130000_pre_release_player_snapshots.sql — comp cache table

lib/types.ts                                     — Product type, ProductLifecycle enum
lib/cardhedger-catalog.ts                        — listActiveProductsWithCHSet filter
app/admin/products/actions.ts                    — setProductLifecycle action

app/admin/products/page.tsx                      — server-side data fetch
app/admin/products/ProductsTableView.tsx         — lifecycle column + filter
app/admin/products/NewProductForm.tsx            — lifecycle picker on create
components/admin/ProductForm.tsx                 — lifecycle picker on edit

app/admin/products/[id]/page.tsx                 — banners + transition buttons + lifecycle badge
app/admin/products/[id]/LifecycleTransitionButton.tsx — confirm-dialog button (3 variants)

app/api/cron/refresh-pricing/route.ts            — gates on lifecycle = live
app/api/cron/refresh-ch-catalogs/route.ts        — (via lib helper)
app/api/cron/update-scores/route.ts              — gates on lifecycle = live
app/api/cron/refresh-dormant-pricing/route.ts    — biweekly dormant refresh
vercel.json                                      — biweekly cron schedule

app/api/pre-release/player-snapshots/route.ts    — 90d comp fetcher

app/(consumer)/break/[slug]/page.tsx             — lifecycle-driven rendering
components/breakiq/PreReleaseLayout.tsx          — pre-release consumer view
```
