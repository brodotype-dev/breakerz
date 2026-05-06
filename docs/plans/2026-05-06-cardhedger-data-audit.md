# CardHedger Data Audit — gaps between what CH offers and what BreakIQ uses

**Status (2026-05-06):** All three P0 items shipped. P0.3 (get90DayPrices shape fix) restored a dead fallback rung. P0.2 (confidence column + chip) captures + surfaces a signal we already paid for. P0.1 (PSA 9/10 alongside Raw in batchPriceEstimate) eliminated the heuristic graded-price multipliers; concurrency bumped 6 → 12 and BATCH_DEADLINE_MS bumped 270s → 280s to absorb the 3× CH call count.

## Context

Brody's hunch: "CH says they have a ton more data than we're actually seeing in our product." This plan audits exactly which CH endpoints we call, which response fields we read vs. drop, and which endpoints we ignore entirely. Goal is a prioritized punch list for closing the gap between CH's surface area and ours.

Source signals: live MCP probes against `mcp__card-hedge__*` tools, plus a full read of `lib/cardhedger.ts`, `lib/pricing-refresh.ts`, `lib/cardhedger-catalog.ts`, the player-comps / player-profile / card-lookup routes, the cron orchestrator, and `pricing_cache` schema.

---

## Inventory — what we currently use

| CH endpoint | Wrapper | Caller(s) | Notes |
|---|---|---|---|
| `/v1/cards/top-movers` | `getTopMovers` | `cron/update-scores` | Global top movers fuels `buzz_score`. Not scoped to a set or product. |
| `/v1/cards/set-search` | `searchSets` | catalog preload, admin set picker | Used. |
| `/v1/cards/card-search` | `searchCards`, `getCardsBySet` | catalog preload, `cardMatch`, `searchAndComputeEV` | Used. |
| `/v1/cards/all-prices-by-card` | `getAllPrices` | slab analysis, `player-comps` drawer, `computeLiveEV` | Used. |
| `/v1/cards/comps` | `getComps` | slab analysis, player-profile, `player-comps`, `computeLiveEV` | Used. We drop `sale_url`, `sale_type`, `title`, `image`. |
| `/v1/cards/prices-by-cert` | `pricesByCert` | slab analysis only | Used. |
| `/v1/cards/90day-prices-by-grade` | `getPlayer90DayStats` (correct shape), `get90DayPrices` (wrong shape) | pre-release snapshots / pricing-refresh fallback | `getPlayer90DayStats` works. `get90DayPrices` has been a silent no-op in `pricing-refresh.ts:371` and `analysis.ts:146` — comment in [lib/cardhedger.ts:306](lib/cardhedger.ts:306) admits it. Two intended fallback rungs are dead. |
| `/v1/cards/batch-price-estimate` | `batchPriceEstimate` | **Primary pricing engine** (`pricing-refresh.ts`) | Called with `grade: 'Raw'` only — see [lib/pricing-refresh.ts:133](lib/pricing-refresh.ts:133). Every cached `ev_low/mid/high` in production is built from a Raw estimate plus 0.35×/2.5× heuristics. |
| `/v1/cards/prices-by-card` | `getPricesByDay` | not called in production | Defined, never imported. |

## Endpoints CH offers that we don't call

| Endpoint | What it gives us | Probe finding (MCP) |
|---|---|---|
| `estimate_price` (single) | Modeled estimate with `confidence`, `method` ("direct" vs "correlated"), `freshness_days`, `support_grades` | We use the batch version but DROP its `confidence` field at the upsert step. |
| `get_price_history` | Daily closes (1–365 days) per grade | Sparse for tail players (1 row in 90d for some prospects); strong for liquid stars. Useful as opportunistic trend chip, not a column. |
| `get_total_sales_by_player` | 30-day volume aggregate per player, 25 players per call | Probe: Ohtani 39,441 / Skenes 7,288 / Anthony 3,620. Huge dynamic range. Replaces inference for B-score. |
| `search_cards_sorted` | Same as search but sortable by `gain` / `gain_30day` / `sales_7day` / `sales_30day` | Per-product hot-list ("what's moving in this set right now") with no new endpoint. |
| `get_details_by_certs` (batch up to 100) | Cert lookup at batch | Not relevant for break pricing; could speed slab tools later. |

## Fields we already get back but throw away

These show up on responses we are already paying for. Capturing them is not "another API call" — it's catching what we currently `delete`.

1. **`confidence` from `batch-price-estimate`** — every priced variant has a confidence score. We map `r.confidence ?? 0` in [lib/cardhedger.ts:409](lib/cardhedger.ts:409) but drop it at the cache upsert in [lib/pricing-refresh.ts:310](lib/pricing-refresh.ts:310) onward. `pricing_cache` has no confidence column.
2. **`price_low` / `price_high` from `batch-price-estimate`** — captured, but only if `r.price_low > 0`; otherwise we synthesize `price * 0.35` and `price * 2.5`. So when CH supplies a real range we use it; when it's missing we hide the gap behind a hard-coded multiplier. Probably the single biggest accuracy lever.
3. **`gain` and `gain_30day` from search responses** — every `card-search` response returns these for free. We ignore them. Could populate per-variant trend chips with zero new calls.
4. **`7 Day Sales` / `30 Day Sales` from search + top-movers** — same: free signal, ignored on search responses.
5. **`sale_url`, `sale_type`, `title`, `image` from `/v1/cards/comps`** — every comp row carries these; [lib/cardhedger.ts:295-300](lib/cardhedger.ts:295) maps only `price`, `sale_date`, `grade`, `platform`. Best Offer vs Auction is a soft-market leading indicator we are completely blind to today.

## Structural issues this audit surfaced

These are not "missing endpoints" — they're things the audit caught about how we're shaping CH data once we have it.

**A. Batch pricing is Raw-only across the entire production engine.** [lib/pricing-refresh.ts:133](lib/pricing-refresh.ts:133) sends `grade: 'Raw'` for every variant, then derives PSA 9 and PSA 10 from heuristic multipliers. For graded-heavy parallels (Refractors, Gold /50, autos) the real PSA 10 is rarely 2.5× Raw. This is likely the biggest source of "pricing feels off."

**B. `get90DayPrices` is dead code in two callers.** Comment in [lib/cardhedger.ts:306](lib/cardhedger.ts:306) admits the response shape mismatch swallows itself in `try/catch`. The intended search-based fallback in `pricing-refresh.ts` (search-priced rung) and `analysis.ts` is never reached. This means we fall through to "default $8 / $15 rookie" more often than the dashboard suggests.

**C. No confidence/freshness on consumer surfaces.** Even when CH confidence is low (correlated method, stale comps, thin support_grades), the consumer break page presents a single hard number. No "we're not sure" badge. This compounds perception of bad pricing — the user can't distinguish "CH is confident this is $40" from "CH guessed $40 from one sale 41 days ago."

**D. Match-quality observability is thin.** `match_tier` is persisted on variants, but there's no admin "this product is X% matched at high confidence" rollup. We only know per-product match rate by spot-checking. No alarm if a refresh writes 60% defaults.

---

## Recommended punch list — priority order

I am NOT proposing to ship all of this at once. This is a menu sorted by accuracy impact ÷ implementation cost.

### P0 — accuracy
1. **Pull PSA 9 + PSA 10 alongside Raw in `batchPriceEstimate`.** Three batches per chunk, or one batch with three grade rows per card. Stop synthesizing graded prices from Raw × multiplier. — *Touches:* [lib/pricing-refresh.ts:121-184](lib/pricing-refresh.ts:121).
2. **Persist `confidence` on `pricing_cache`.** New column `confidence numeric`, write per-variant aggregate (min or weighted avg). Surface a "Pricing confidence" chip on `/break/[slug]` for low-confidence rows. — *Touches:* migration + `pricing-refresh.ts` + consumer break page.
3. **Fix `get90DayPrices` shape.** Either rename to match `getPlayer90DayStats`'s response handling or update both callers to consume the `cards: [...]` shape correctly. Restores the search-priced fallback rung. — *Touches:* [lib/cardhedger.ts:315](lib/cardhedger.ts:315), [lib/pricing-refresh.ts:371](lib/pricing-refresh.ts:371), [lib/analysis.ts:146](lib/analysis.ts:146).

### P1 — free signal capture
4. **Capture `gain` / `gain_30day` / `30 Day Sales` on variant rows.** New columns on `player_product_variants` populated whenever `card-search` runs (matching, catalog refresh). Drives per-variant momentum chips with zero new CH calls. — *Touches:* migration + `cardhedger-catalog.ts` + `cardhedger.ts` normalize step.
5. **Enrich Recent Sales with `sale_url` + `sale_type`.** Already in the comps response. `sale_type === 'Best Offer'` rows get a "soft sale" indicator. Click-through to the listing for buyer trust. — *Touches:* [lib/cardhedger.ts:282-301](lib/cardhedger.ts:282), `app/api/player-profile/route.ts`, `app/api/player-comps/route.ts`, recent-sales table component.

### P2 — net-new signal
6. **Adopt `get_total_sales_by_player` in `cron/update-scores`.** Per-player 30-day volume is a far better B-score input than global `top-movers`. 25 players per call, batches well. — *Touches:* [app/api/cron/update-scores/route.ts](app/api/cron/update-scores/route.ts), `lib/cardhedger.ts` (new wrapper).
7. **Add `search_cards_sorted` for product-scoped movers.** Powers a "What's moving in this product" widget on the break page (or admin first as proof). — *Touches:* new wrapper, new admin/consumer surface.
8. **Match-quality rollup on admin Products page.** Per-product %-matched-at-each-tier, alarm when defaults exceed N%. — *Touches:* admin/products page query.

### P3 — opportunistic
9. **Trend slope from `get_price_history`.** Only worthwhile for liquid players. Use as a chip, not a column.
10. **Catalog gap report.** After every catalog refresh, log variants that hit `claude` or `no-match` tier — turns into the "send River the gap list" workflow we've already discussed.

---

## Critical files to read before implementing any of P0

- [lib/cardhedger.ts](lib/cardhedger.ts) — full client
- [lib/pricing-refresh.ts](lib/pricing-refresh.ts) — engine (Raw-only batch lives here)
- [supabase/migrations/20260101000000_initial_schema.sql:69-82](supabase/migrations/20260101000000_initial_schema.sql) — `pricing_cache` shape
- [lib/analysis.ts:120-160](lib/analysis.ts) — sibling caller of `computeLiveEV` + dead `get90DayPrices`
- [app/api/pricing/route.ts](app/api/pricing/route.ts) — consumer read shape (would need to project new columns)
- [docs/pricing-architecture.md](docs/pricing-architecture.md) — pipeline contract

## Verification (per item, not for the audit itself)

- **P0.1 (PSA 9/10 batch):** before/after delta on a known graded-heavy product (Topps Chrome Basketball). Diff `ev_high` for top-tier variants pre/post. Spot-check 5 cards against `mcp__card-hedge__get_all_prices` to confirm the new ev_high lines up with CH's actual PSA 10 average.
- **P0.2 (confidence column):** seed a test product, confirm new column populates, render the chip on `/break/[slug]` for both a high-confidence (e.g. Ohtani base) and low-confidence (a thin-comp prospect parallel) row.
- **P0.3 (`get90DayPrices` fix):** force a product into the search-priced rung by zeroing its variant CH IDs, verify `searchPriced` count > 0 in the refresh summary instead of the current silent fallthrough to `defaultPriced`.
- **P1.5 (sale_url/sale_type):** hit `/api/player-profile`, confirm each comp row has the link and Best Offer rows render with the soft-sale chip.
- **All:** existing Pricing Audit Panel + the Cron Status panel will surface regressions.

## What this plan does NOT do

- It doesn't pick which items we ship. That's Brody's call after reading.
- It doesn't redesign `pricing_cache` end-to-end. New columns are additive, no breaking schema change.
- It doesn't touch the matching pipeline — match quality is a separate audit if we want it.
