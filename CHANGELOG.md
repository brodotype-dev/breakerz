# Changelog

All notable changes to BreakIQ are documented here.
Format: newest first. Each entry covers what changed, why, and any important technical notes.

---

## 2026-04-27 — Pricing cron: throttled, stale-aware, staggered

Follow-up to the morning's middleware fix. Three more bugs surfaced once the cron actually started running:

1. **Apex → www redirect downgraded POST to GET → 405.** The orchestrator built fan-out URLs from `NEXT_PUBLIC_APP_URL` (`https://getbreakiq.com`, the apex). Vercel's apex-to-www redirect is a 301, which converts POST to GET on follow, and the worker route only accepts POST. Fix: derive base URL from `req.url` so the fan-out always hits the same canonical host the orchestrator was invoked on.

2. **"Priceable" filter checked the wrong table.** Filter queried `player_products.cardhedger_card_id`, but the matcher writes matches to `player_product_variants.cardhedger_card_id`. Recently-matched products got skipped entirely. Fix: dropped the filter — the per-product worker already short-circuits cleanly on empty input.

3. **16-way parallel fan-out starved CH bandwidth, blowing per-worker 300s caps.** Pushed 9/16 products through but the 7 heaviest (Topps Chrome Basketball family, Topps Pristine, etc.) timed out. Rebuilt the orchestrator with:
   - **Concurrency cap of 3** — keeps CH happy.
   - **Stale-first selection** — only picks products whose latest `pricing_cache.fetched_at` is null or > 22h old, oldest first. Re-runs skip already-fresh products.
   - **5 staggered cron firings** — 4:00, 4:30, 5:30, 6:00, 6:30 UTC (5 AM slot reserved for `update-scores`). Each invocation processes ~3–5 products in 270s; whatever doesn't fit gets picked up by the next firing. Across the hour-long window, all 16 products cycle through with comfortable margin.
   - Per-fetch abort at 240s, orchestrator-budget abort at 270s — the function always returns within Vercel's 300s cap, and aborted workers keep running on their own invocations.

## 2026-04-27 — Fix nightly pricing cron (silent failure since fan-out switch)

The pricing refresh cron has been silently no-op'ing every night since 2026-04-22 (commit cfdb397, "unbounded cron fan-out"). Discovered while looking at the admin Products table — most "Last Priced" timestamps were stuck at 17–35 days old.

**Root cause:** `/api/cron/refresh-pricing` fans out HTTP POSTs to `/api/admin/refresh-product-pricing` with `Authorization: Bearer ${CRON_SECRET}`. The route handler accepted that, but `middleware.ts` matches `/api/admin/*` and only checks Supabase cookie sessions — so the inner request was 307'd to `/admin/login`. Node's `fetch` follows redirects, the login HTML returned 200, the orchestrator's `await res.json().catch(() => null)` swallowed the JSON parse error, and every product reported "ok" with `summary: null`. No errors in logs, no rows written.

**Fix:** middleware now lets requests with a matching `Authorization: Bearer ${CRON_SECRET}` header pass through before the cookie check. Route handlers still validate the secret themselves.

Only `refresh-pricing` was affected — `update-scores` and `refresh-ch-catalogs` do their work inline, so they never crossed the middleware boundary.

---

## 2026-04-23 — Chase Board + Player Detail Drawer

Two new consumer-facing features: a chase card board on the break page and a per-player detail drawer with CardHedger comps.

**Chase Board:**
- New `product_chase_cards` table (migration `20260423120000`). Stores chase cards and chase players per product — type, display name, odds text, hit state, self-reported hit timestamp.
- Admin product page: new "Chase Cards" section with `ChaseCardsManager` component. Auto-recommends candidates from checklist data (lowest-odds variants → Chase Cards, highest buzz_score players → Chase Players). Admin can add from recommendations, manually add by player_product_id, and mark cards as hit.
- Hits are explicitly self-reported — no automatic pricing update. Hit cards show a "Self-Reported Hit" banner and a disclaimer note.
- Consumer break page: `DashboardConfig` replaced by `ChaseCardsPanel` — a responsive tile grid (2–5 cols) showing up to 10 chase cards and players per product. Hit cards show a prominent red "HIT — Self-Reported" banner.
- Cases count / total cost moved to a compact inline row above the tab bar (replaces the full DashboardConfig card).

**Player Detail Drawer:**
- Clicking a player name in the Player Slots table opens a `PlayerDetailDrawer` slide-over panel.
- Fires live CardHedger API call on open (not pre-cached) — shows a loader while fetching.
- Shows: all variants for that player in this product with PSA 8/9/10 prices from CH `all-prices-by-card`; recent comps (PSA 8/9/10, last 180 days) from CH `comps` endpoint.
- New API route `/api/player-comps` (GET `?playerProductId=`): fetches variants from DB, deduplicates CH card IDs, calls `getAllPrices` in parallel (capped at 15 cards), fetches comps for the base card across grades 8–10.
- Drawer is mobile-aware (full-width on small screens), closes on backdrop click or Escape key.
- `PlayerTable` gains an optional `onPlayerClick` prop — names render as blue clickable links when provided.

**Backlogged (noted in session):**
- Community "Report a Hit" form → feedback feed
- Automatic pricing recalculation when a chase card is hit (needs real-time data feed)
- PWA/mobile drawer pattern (post-beta)

---

## 2026-04-23 — After-market case pricing

Products have two distinct case prices now: MSRP (what the manufacturer sells at) and an after-market price (what cases trade for on the secondary market after launch). The two can diverge sharply — some products move 5-10x above MSRP within days of release.

**What changed:**

- New columns on `products`: `hobby_am_case_cost` and `bd_am_case_cost` (nullable NUMERIC). Admin sets these manually when the market has moved. Migration: `20260422190000_add_am_case_cost.sql`.
- Admin product form (create + edit): new "Hobby AM / Case" and "BD AM / Case" inputs in the Pricing section, labeled "(after-market)". Existing MSRP fields now labeled "(MSRP)".
- Admin product details page: AM prices appear in the Product Details grid alongside MSRP when set.
- Consumer break page: `hobbyCaseCost` / `bdCaseCost` now default to the AM price when available, falling back to MSRP. Fallback chain: `hobby_am_case_cost → hobby_case_cost → 0`.
- `DashboardConfig`: "Hobby / Case" label renamed to "Your Cost / Case". A reference row appears below the cost input showing `MSRP $X · Market $Y` (market in orange when set) — gives the user context while adjusting to their actual paid price.

No changes to `lib/engine.ts`. The slot cost equation already handles variable case costs correctly — the AM price just gives the consumer a more accurate default to start from.

**Also added:** `docs/breaker-identity-prd.md` — PRD for Phase 2, a full Breaker role with crowdsourced case pricing. Breakers enter what they actually paid per case; we aggregate across breakers (30-day median) to compute a live market rate that replaces the admin AM field automatically. Backlogged until public beta when there's enough volume to make aggregation meaningful. See backlog for phasing.

---

## 2026-04-22 — Pricing pipeline: rip out consumer refresh UI, unbounded cron fan-out, docs

With the pricing-refresh fire out and Bowman Chrome priced end-to-end, cleanup + documentation pass to lock in the architecture and make sure it scales beyond today's ~10 active products.

**Consumer break page:**
- Removed the "Refresh" / "Fetch Pricing" button at the top of `/break/[slug]`. With `/api/pricing` now a pure cache read, the button's only effect was a confusing no-op re-fetch of data the server already had. No more user-facing lever on pricing.
- Replaced the action-banner ("Live pricing not loaded — hit Fetch") with a passive informational banner ("Pricing not yet available — refreshes nightly at 4 AM UTC"). If the cache is empty, the user can't do anything about it anyway; don't pretend otherwise.
- Removed `fetching` state and `fetchLivePricing()` from `app/(consumer)/break/[slug]/page.tsx`.

**Cron fan-out:**
- Removed `FAN_OUT_CONCURRENCY = 3` throttle in `app/api/cron/refresh-pricing/route.ts`. Made sense when the orchestrator did heavy work on Hobby's 60s cap; on Pro with per-product invocations each spawning their own 300s budget, the throttle only serialized dispatch artificially. Now: `Promise.all(priceable.map(...))` — one HTTP call per product, all in flight simultaneously.
- Scales comfortably to ~50 active products. Past that, CH per-IP rate limits become the bottleneck — reintroduce a small cap at that point. Noted inline.

**Docs:**
- New `docs/pricing-architecture.md` — full pipeline diagram, design principles, scaling notes, what-we-tried-and-threw-away. Written as the canonical reference for any future "why does pricing work this way" question.
- `CLAUDE.md` Current State: "Pricing Cache Cron" entry rewritten as "Pricing Pipeline" covering the full consumer-cache-read + admin/cron writer split. Key Files section updated with `/api/pricing`, `lib/pricing-refresh.ts`, the admin worker route, and the admin button.

No schema changes. No behavior change for the cron on small products; the change only matters once there are more products than the old throttle allowed in parallel.

---

## 2026-04-22 — Hot-fix: pricing_cache upsert silently wrote 0 rows (NOT NULL on cardhedger_card_id)

After clearing the timeout + iterable bugs, the Bowman Chrome refresh ran to completion (218.5s, 278 players priced in the summary) — but the consumer break page still showed "Live pricing not loaded" with every EV column dashed. The cache was empty.

**Root cause:** `pricing_cache.cardhedger_card_id` was `text NOT NULL` from the initial schema. For CH-hydrated products, the card_id lives on variants, not on the player_product row — `pp.cardhedger_card_id` is `null`. Every row in our bulk upsert violated the constraint. The upsert error was caught and logged to `console.error` but didn't throw, so the function returned a success-looking summary based on in-memory counts of rows *we intended to write*.

**Fixes:**
- Migration `20260422170000_pricing_cache_nullable_card_id.sql`: drops NOT NULL on the column. The field is never read meaningfully anywhere in the codebase — aggregate pricing across variants has no single card_id to attribute to. Safe to nullify.
- `lib/pricing-refresh.ts`: upsert now throws on error instead of logging. If the DB ever rejects again we'll see it immediately in the UI.
- Added `cacheRowsWritten` to `RefreshSummary` + displayed it in the admin button status pill (`… · 278 cached · 218.5s`). Future schema drift can't silently zero out the write count anymore.

Deploy requires both the migration (`supabase db push` from main repo) *and* the code change. Run the migration first; the code without the migration would error loudly but not progress.

---

## 2026-04-22 — Hot-fix: `e.pricing_cache is not iterable` in cross-product fallback

With Vercel Pro's 300s budget, the per-player fallback phase in `lib/pricing-refresh.ts` finally ran to completion on Bowman Chrome — and exposed a latent bug we'd never reached before: when a player's variants all priced at 0, we fall back to `loadSiblingPricing()`, which joins `player_products` → `pricing_cache` and iterates each row's `pricing_cache` as an array. Supabase-js returns that join as a *single object* (not a one-element array) when the FK resolves to one row, so `for (const pc of row.pricing_cache)` threw `pricing_cache is not iterable`.

**Fix:** normalize the join to an array (`Array.isArray(pc) ? pc : pc ? [pc] : []`) before iterating. Added a comment calling out that Supabase's FK join shape varies by cardinality.

This bug has almost certainly been in the codebase since the original cross-product fallback was introduced — it just never fired in production because we always timed out before reaching it. Classic "the feature was broken all along, the timeout was hiding it."

---

## 2026-04-22 — Vercel Pro upgrade: `maxDuration = 300` on pricing routes

Upgraded to Vercel Pro ($20/mo) and bumped `maxDuration` from 60 → 300s on:
- `app/api/admin/refresh-product-pricing/route.ts` (admin "Refresh Pricing ↻" button)
- `app/api/cron/refresh-pricing/route.ts` (nightly orchestrator)

Graceful-deadline constants in `lib/pricing-refresh.ts` also scaled up (`BATCH_DEADLINE_MS = 270_000`, `HARD_DEADLINE_MS = 290_000`). They remain as a safety net for unusually slow CH responses — under typical latency, jumbo products (Bowman Chrome, Topps Finest) now finish in one invocation (~160s observed) without ever tripping them.

Net: the 9-PR firefight ends. No more `FUNCTION_INVOCATION_TIMEOUT` on any product we've tested. Backlog D (per-variant price cache) stays on the list — it's a "nice to have" for staggered refreshes, not a firefight response anymore.

---

## 2026-04-22 — Hot-fix: refresh-product-pricing — graceful partial completion + useful client errors

First production run of the new "Refresh Pricing ↻" admin button on 2025 Bowman Chrome (278 players, 6,481 variants) hit Vercel Hobby's 60s cap. The button surfaced the failure as `Unexpected token 'A', "An error o"... is not valid JSON` — meaningless to the user. Underlying: Vercel returns a plain-text `An error occurred...` page on function timeouts, and the client was `res.json()`-ing it. Exactly the jumbo-product case we'd called out as a known limit, but the UX was worse than "partial data" — it was "cryptic crash."

**Fixes:**
- **Server: soft + hard deadlines in `lib/pricing-refresh.ts`.** New `BATCH_DEADLINE_MS = 45s` stops enqueueing new CH chunks before we run out of runway. `HARD_DEADLINE_MS = 55s` bails out of the per-player fallback phase. Cache rows accumulated up to that point still get upserted — partial progress survives.
- **Server: `partial: true` + `batchChunksCompleted` in the summary.** Lets callers see how far we got (`45/65 chunks`, `N partial variants priced`) without inspecting logs.
- **Client: read text before JSON.** The refresh button now parses `res.text()` first, then attempts `JSON.parse()`. On 504/non-JSON, it shows the first ~140 chars of the body + a hint: *"— likely 60s cap on this jumbo product; nightly cron will complete it, or upgrade to Vercel Pro (backlog C)"*.
- **Client: partial banner.** Successful-but-partial runs render an orange `⚠ partial` prefix in the status line so admins know the data is still incomplete even though the call returned 200.

Net: on Bowman Chrome, expect ~45s of batch fetch → ~20 chunks complete → ~2,000 variants priced → ~85 players get live pricing → rest fall to cross-product / default. Re-clicking the button picks up remaining work next time (cache rows already written persist). The nightly cron still has the full 60s budget per-product and will close the gap at 4 AM UTC.

Permanent fix remains backlog items **C** (Vercel Pro → 300s, covers everything) and **D** (per-variant price cache → skip already-priced variants for incremental refresh).

---

## 2026-04-22 — Architectural pivot: `/api/pricing` is now cache-read only; heavy fetch moved off the consumer path

After eight rounds of firefighting (PRs #13–#20), we confirmed the problem was not solvable by tuning concurrency, timeouts, or retries. CH's `batch-price-estimate` legitimately takes 5–30s per 100-item chunk under our load. At 6,481 variants on 2025 Bowman Chrome, that's 65 chunks. With Vercel Hobby's 60s `maxDuration`, completing a full live refresh inside a single consumer request is mathematically impossible. So we stopped trying.

**New architecture:**
- **`POST /api/pricing` is now a cache-read.** Both GET and POST return whatever's in `pricing_cache`. The "Refresh" button on the break page no longer triggers a live CH fetch. If the cache is empty, the response is empty — users see an explicit "no prices loaded" state instead of a 504.
- **New admin endpoint: `POST /api/admin/refresh-product-pricing`.** This is where the heavy batch fetch now lives. `maxDuration = 60`. Admin cookie auth *or* `Authorization: Bearer ${CRON_SECRET}` (used by the cron).
- **`/api/cron/refresh-pricing` now fans out.** Nightly at 4 AM UTC, it queries active products with matched card IDs and HTTP-calls `/api/admin/refresh-product-pricing` once per product at concurrency 3. Each product gets its own 60s Vercel invocation instead of all of them sharing one. One slow product can't starve the others.
- **New admin button: "Refresh Pricing ↻"** on the product dashboard (`app/admin/products/[id]/page.tsx`, new WorkflowStep 6). Click to refresh a single product on demand without waiting for 4 AM. Shows a structured summary when it completes: `N players · live=X cross=Y search=Z default=W · A/B variants · Ns`.
- **Extracted logic: `lib/pricing-refresh.ts`.** Single source of truth for the refresh pipeline (batch fetch → variant-aware fallback ladder → bulk upsert). Called from both the admin endpoint and — in the future — anywhere else we need to trigger a refresh.

**What consumers see:** The break page loads instantly from cache. No more 504s, no more "no prices at all." The Refresh button still works — it just reads cache now (kept for frontend compatibility; will be renamed/removed in a follow-up).

**Known limit:** On jumbo products (6,000+ variants), the on-demand admin button can still hit 60s. Partial cache rows that were written before the cutoff survive, and the next run picks up where it left off when combined with backlog item D. See `docs/BACKLOG.md` items **C** (Vercel Pro upgrade → 300s) and **D** (per-variant price cache with `last_priced_at`) for the permanent fix.

---

## 2026-04-22 — Hot-fix: CH batch-price-estimate — 30s timeout + one retry

PR #19 moved the bottleneck. New failure mode observed in Vercel logs on 2025 Bowman Chrome: the batch phase itself was failing with `The operation was aborted due to timeout` across 5+ chunks, leaving `pricesOnly` partially empty and the function running past 60s → `FUNCTION_INVOCATION_TIMEOUT`. Root cause: `lib/cardhedger.ts`'s `post()` helper hardcodes `AbortSignal.timeout(10_000)`, and CH's `batch-price-estimate` endpoint legitimately takes 5-20s per 100-item request under our 6-way concurrent load. A 10s cap aborts valid slow requests and zeroes out 100 variant prices per abort.

**Changes:**
- `post()` now accepts an optional `{ timeoutMs }`; other callers keep 10s.
- `batchPriceEstimate` defaults its own timeout to 30s.
- `route.ts` wraps each batch chunk in a `runChunk(idx, chunk, attempt=0)` helper that retries once on any failure before giving up. One hiccup shouldn't cost us 100 variants.
- Enhanced batch-phase log now reports wall-clock time + chunk count + concurrency so latency regressions show up in Vercel observability without guessing.

---

## 2026-04-22 — Hot-fix: /api/pricing skip per-player search fallback + bulk upsert cache

PR #18 hit 60s `maxDuration` and 504'd ~26% of Refresh requests on 2025 Bowman Chrome. Vercel observability showed ~230 CardHedger calls per invocation vs. the ~60 that batch pricing alone should produce. The extra ~170 were every player whose variants all priced at 0 in the batch falling through to Level 2 `get90DayPrices(name)` — a slow per-player search call, 8 at a time. On a set where most /5, /10, /25 parallels have no recent Raw sales, that's 170+ wasted searches per refresh. Piled on top of batch fetches and 278 inline `pricing_cache` upserts, it blew the 60s budget.

**Changes:**
- **Split the worker into two paths.** If the player has variants (hydrated product), we already know CH's canonical card IDs — the batch call is authoritative. When it returns 0 for every variant, skip Level 2 entirely. Jump to Level 3 (cross-product) → Level 4 (default). Level 2 now only runs for non-hydrated products where we don't have a batch to lean on.
- **Level 3 is now a single pre-fetched map, not a per-player query.** Previously each fallback player did its own `siblings + in() + order + limit 1` Supabase query. Now we lazy-load one `player_id → latest pricing` map on first demand and look up from memory. One request total instead of N.
- **Bulk `pricing_cache` upsert at the end of the request.** Workers collect cache rows into an array; we upsert in 500-row chunks after `mapLimit` returns. Saves ~5-10s of sequential Supabase round-trips.
- **Structured log per refresh**: `live=X cross=Y search=Z default=W cache=N` so future regressions are obvious from the observability tab.

Net: Bowman Chrome goes from ~60s (timeout) to ~10-15s. CH call count drops from ~230/invocation to ~60-80.

---

## 2026-04-22 — Hot-fix: /api/pricing maxDuration + parallel batch fetches

`POST /api/pricing` had no `maxDuration` export — Vercel defaulted to 10 seconds. Batch-fetching 6,481 variant prices at 65 sequential chunks × ~240ms ≈ 15s meant every Refresh request 504'd silently. PR #17 was sound; the reason "still not doing anything" after deploy was that the function timed out before writing anything to `pricing_cache`.

**Changes:**
- `export const maxDuration = 60` at the top of `app/api/pricing/route.ts`.
- Parallelize the 100-item batch chunks with a 6-worker semaphore (same `mapLimit` shape used elsewhere). 65 chunks at concurrency 6 ≈ 2.7s wall clock instead of 15s.
- Added a single `console.log` reporting `pricesOnly.size / allVariantCardIds.length` after the batch phase so the next debug pass has an observable signal.

---

## 2026-04-22 — Hot-fix: POST /api/pricing now always refreshes live (no cache early-return)

After PR #16 shipped, clicking **Refresh** on the break page silently returned the same wrong prices the broken runs had written to `pricing_cache` — because `POST` had an early-return that replied `pricingSource: 'cached'` whenever a valid cache row existed. Worse: `'cached'` isn't counted as estimated in the UI, so the "N players using estimated pricing" banner disappeared along with the `est` badges. Users saw $8 everywhere with no indication anything was wrong.

**Fix:** `POST` no longer reads `pricing_cache`. It always runs the batch-price path and writes fresh rows. `GET` still reads cache (the fast consumer path is unchanged). The Refresh button now does what its name says.

Side effect: the nightly cron at 4 AM UTC also always does full refreshes now — previously it was a partial refresh (only unpriced pps). Cost is small — ~65 batch calls per hydrated product.

---

## 2026-04-22 — Hot-fix: CH batch-price-estimate caps at 100 items

PR #15 sent 500-item chunks to `batch-price-estimate`. CH's endpoint rejects anything over 100 items with HTTP 400 (`"List should have at most 100 items after validation"`). The try/catch around the batch call swallowed the error, logged to console, and moved on — so `pricesOnly` stayed empty, every variant hit `evMid=0`, and every player landed in the fallback chain. Net effect: the batch migration silently produced the exact same "all estimated" result that PR #15 was supposed to fix.

**Fix:** `PRICE_CHUNK = 100`. Verified directly by curling the endpoint — 500 returns 400, 100 works. For Topps Finest (6,481 variants) that's 65 sequential batch calls at ~240ms each = ~15s of batch-fetch time before the per-pp loop, well within Vercel's 60s function budget.

Lesson learned: next time, probe the endpoint's actual limits before picking a chunk size.

---

## 2026-04-22 — Pricing refresh: switch to CH `batchPriceEstimate` (Raw grade)

Per-variant `computeLiveEV` was still rate-limit-bound even after PRs #13 and #14: 8 outer workers × ~25 inner `Promise.all` calls = ~200 concurrent CH requests. Most variants came back zero → filtered out → weighted avg computed on a tiny sample → unreliable prices.

**Change:** single pre-fetch via `batchPriceEstimate({ card_id, grade: 'Raw' }, ...)` chunked at 500 items. On a hydrated product with 6,481 variants, that's ~13 HTTP calls total, done before any per-player_product work begins. The per-pp loop now just looks prices up from the pre-built `pricesOnly` map — no CH calls in the hot path for hydrated products.

**Tradeoffs:**
- EV Mid is now based on CH's "Raw" grade estimate, not the PSA 9 ladder that `computeLiveEV` preferred. Numbers will be visibly lower on cards that were previously priced off graded comps (e.g. Judge autos showing raw price instead of PSA 9). More honest — raw is what comes out of the box.
- PSA 9 / PSA 10 breakdown is no longer computed in the aggregate refresh. Deferred to a future per-player graded-comp drilldown (click row → side panel calls `getAllPrices` on demand). Added to `docs/BACKLOG.md` as "Per-player graded comp drilldown".
- Non-hydrated products (where `pp.cardhedger_card_id` is set and there are no variant rows) still use `computeLiveEV` on the `else` branch. That path is one call per pp and works fine as-is.

**UX:** added a subtle info banner on `/break/<slug>` when pricing loaded: *"EV values reflect raw card sale prices. Graded (PSA 9 / PSA 10) comps are not included — per-player graded drilldown coming soon."*

---

## 2026-04-22 — Hot-fix: zero-priced variants drag weighted EV to $0

After PR #13 shipped, the break page showed `278/278 priced` but every row still wore an "est" badge (Judge at $400, most others at the $8/$15 Level-4 defaults). The refresh was running successfully, but **every** player_product was landing in the fallback chain because `ev.evMid === 0 → throw`.

**Root cause.** Hydrated products create a row per CH card, including /5, /10, /25 parallels that have never traded individually. `computeLiveEV` returns `{evMid: 0}` for those. Every variant has `sets: 1` (hydrator default), so the weighted average `Σ(evMid × sets) / Σ(sets)` includes all the zeros — even when a player has real prices on the base card, the zero-priced parallels drag the average under the `evMid === 0` threshold and trip the throw.

**Fix (`app/api/pricing/route.ts`).** Filter out zero-priced variants before computing the weighted average. If at least one variant returned a real price, use it; only fall through to the search/default fallback chain if the *entire* variant set returned zero.

Known follow-up: parallel inner fan-out (`Promise.all(variants.map(computeLiveEV))`) can still hit CH rate limits on players with many variants. `batchPriceEstimate` in `lib/cardhedger.ts` could reduce that to one HTTP call per player_product — deferred to a separate PR since it changes the EV shape (single price vs raw/PSA 9/PSA 10 breakdown).

---

## 2026-04-22 — Hot-fix: pricing route couldn't price CH-hydrated products at scale

Consumer break page on a freshly-hydrated Topps Finest (278 player_products, 6,481 variants) was showing "269 of 278 players using estimated pricing" — `pricing_cache` was empty and the `POST /api/pricing` refresh path had three blocking issues that sent almost every player down the "estimated" fallback chain.

**Root causes** (5th instance of the PostgREST limits bug family — see PRs #4, #6, #8, #10):
1. **Variant load capped at 1000 rows + URL too long.** `.in('player_product_id', [278 UUIDs])` produced a ~9.7KB URL (Kong limit ~8KB); the response was also capped at 1000 rows, so ~85% of variants were invisible to the refresher.
2. **Hydrated `player_products.cardhedger_card_id` is null** (the CH ID lives on each variant now). When a pp's variants fell past the 1000-row cap, the code dropped into the `variants.length === 0` branch → threw → fell into the estimated fallback.
3. **Unthrottled parallel fan-out.** `Promise.all(playerProducts.map(...))` fired 278 outer workers, each firing `Promise.all(variants.map(computeLiveEV))` inside. Even if pagination had worked, the CH API would have rate-limited most of the thousands of parallel calls.

**Fix (`app/api/pricing/route.ts`):**
- `POST` and `GET` now chunk every `.in('player_product_id', ids)` lookup at 200 UUIDs.
- `POST` paginates the variant load in 1000-row pages within each chunk.
- `POST` replaces `Promise.all(...)` with a local `mapLimit` helper capped at 8 concurrent outer workers; inner per-variant `computeLiveEV` calls stay as-is, but peak CH concurrency is now bounded.

**Expected effect:** "Refresh" on the break page (or the 4 AM UTC cron) now actually populates `pricing_cache` for hydrated products. `pricingSource` should flip from `none`/`default` to `live` for the vast majority of players.

---

## 2026-04-22 — Product dashboard: hide parser workflow from UI (beta)

Post-Phase 3, the CH-Hydrate workflow reliably produces 100% variant coverage with auto-created players — so the parser workflow is no longer part of the happy path for new products. For beta we hide the parser card to eliminate decision paralysis, while keeping all parser code paths (`/admin/import-checklist`, `match-cardhedger`, `lib/checklist-parser.ts`) intact.

**Changes:**
- Removed the "Parser Workflow · Fallback" `WorkflowCard` from `app/admin/products/[id]/page.tsx`.
- CH-Hydrate card spans full width; step 2 copy updated to note that players auto-create during hydrate.
- Small footer link below the card points to `/admin/import-checklist` + the new `docs/parser-workflow-legacy.md` for admins who need the fallback.
- New `docs/parser-workflow-legacy.md` documents the 5-step parser flow, when to use it, and how to re-enable the UI card.

**Not removed:** the `WorkflowCard` component, `RunMatchingButton`, `/admin/import-checklist`, `/api/admin/match-cardhedger`, `lib/checklist-parser.ts`. Re-enabling the card is a diff against PR #9 for anyone who needs it. PR #12.

---

## 2026-04-21 — Phase 3: auto-create players + player_products from CH during hydrate

Collapses the CH-hydrate workflow from 6 steps to 4 for new products. Previously admins had to manually add every player via Manage Players before hydrating — if CH had a player that our `players` table didn't, the hydrator would skip that player's variants and surface them in the skipped-players panel. Admin then had to add them manually and re-hydrate.

Now `hydrateVariantsFromCatalog` walks the CH catalog for every player_name not already in the product's `player_products`, then:
1. Upserts into `players` with `onConflict: (name, sport_id)` — safe against players that exist globally but weren't on this product.
2. Upserts into `player_products` with `onConflict: (player_id, product_id)`.
3. Adds the new ppId to the normalized-name map, so subsequent variant inserts bind correctly.

Dedupe by normalized name so `"Luka Dončić"` and `"Luka Doncic"` in the same catalog don't create two player rows.

**Result:** `skippedPlayers` should be empty for healthy products post-hydrate. Non-zero now means an auto-create failed (concurrent write, constraint violation) rather than "admin forgot to add this player."

**New response fields:** `autoCreatedPlayers`, `autoCreatedPlayerProducts`. UI surfaces `+N new players` in the success line when > 0.

**Workflow impact:** The "Add players" step in the CH-Hydrate workflow card is now optional for new products — the hydrator handles it. Keeps the UI step for clarity but the ✓ will populate automatically once you hydrate. PR #11.

---

## 2026-04-21 — Hot-fix: odds import silently dropped 94% of variants

On Topps Finest (12,075 variants) only 732 got odds applied — a 6% bind rate. The "Unmatched odds rows" panel listed virtually every insert (Arrivals, Muse, Finishers, etc.) as not found.

**Two bugs stacked — same 1000-row cap family:**

1. `apply-odds/route.ts` loaded all variants for the product via `.eq(product_id)` — capped at 1000 rows by PostgREST. With 12,075 variants, only the first ~1000 reached the matcher. Insert variants past that window appeared "missing" from the match pool, so their odds rows landed in `unmatched`.
2. Even when a match hit, the update used `.in('id', variantIds)` where `variantIds` came from the same 1000-row sample. So `Red Refractor /5` variants past the cap never had odds applied.

**Fix:**
- Paginate the initial variant load in 1000-row chunks (same pattern as `loadCatalogIndex` and the hydrator).
- Build an `idsByName` map across the full result, then update by chunked `.in('id', slice)` of 200 UUIDs per request to stay under Kong/PostgREST's ~8KB URL limit.
- Response shape now includes `rowsUpdated` per matched subset for easier debugging.

Expected result on Topps Finest: jumps from 732 → thousands of odds-bound variants. PR #10.

---

## 2026-04-21 — Product dashboard: workflow-aware Quick Actions + skipped-players detail

Two small UX passes on top of the hydrator feature.

**Quick Actions → two numbered workflow cards.** Previously buttons were jumbled in one list; unclear which belonged to the new CH-hydrate flow vs. the legacy parser flow. Now side-by-side cards:

- **CH-Hydrate Workflow (recommended)** — 6 steps: set CH set name → add players → refresh CH catalog → hydrate variants → upload odds → view break page.
- **Parser Workflow (fallback)** — 5 steps: add players → import checklist → re-run matching → upload odds → view break page.

Each step renders with a numbered circle and a green ✓ when its state condition is met. Driven by existing + two new cheap count queries: `ch_set_cache` rows for the product's CH set name (drives step 3 done), and `player_product_variants` with `match_tier='ch-native'` (drives step 4 done). No mutation or refactor of the underlying button components — just repositioned into labeled steps.

**Skipped-players detail under Hydrate button.** Previously the "1 player skipped" line was a dead number. Now when skipped > 0, an expandable `<details>` block shows the player names + CH row counts, with a Download CSV button. Makes it trivial to paste into Manage Players. PR #9.

---

## 2026-04-21 — Hot-fix: hydrator 400 Bad Request on >1000-player products

First real click on **Hydrate Variants from CH** against Topps Finest (1011 player_products) returned `Variant delete failed: Bad Request`. Two sibling bugs of the same PostgREST 1000-row family we've been squashing:

1. `player_products` load wasn't paginated — capped at 1000, losing 11 players from the name→id map.
2. `.in('player_product_id', [1000 UUIDs])` blew past PostgREST's URL length limit (~8KB) → 400.

**The DB was not touched** — the failure happened before any delete or insert ran.

Fix: paginate the `player_products` load in 1000-row chunks; chunk the DELETE `.in()` into batches of 200 UUIDs so the URL stays under the Kong/PostgREST limit. Same pattern as PR #4 catalog pagination + PR #6 count-query fix. PR #8.

---

## 2026-04-21 — Hydrate variants from CH catalog (invert the matching pipeline)

New **Hydrate Variants from CH Catalog** button on the product dashboard. Replaces `player_product_variants` with rows sourced directly from `ch_set_cache` — every row pre-linked via `cardhedger_card_id` (match_tier = `ch-native`, match_confidence = 1.0). Matching pipeline becomes a no-op for CH-known variants; only the tail of CH-missing cards needs rescue.

Inverts the legacy flow where the XLSX/PDF parser was the source of truth for "what variants exist." On Topps Finest this meant 225 of 19,399 variants sat unmatched because the parser missed their parallel blocks. After hydrate, variants come from CH's canonical 12,097-row catalog — zero parser intermediation for that dimension.

**Opt-in per product.** Non-destructive across the codebase:
- Checklist parser + `import-checklist` route untouched — re-running "Import Checklist" restores parser-driven rows if we ever pivot off CH
- Only the hydrated product's variants are replaced; other products unaffected
- Confirmation modal on the button to prevent accidental clicks

**Field mapping:** `ch_set_cache.card_id` → `cardhedger_card_id`, `number` → `card_number`, `variant` (minus trailing `/N`) → `variant_name`, trailing `/N` → `print_run`. `is_sp` derived from SP token / SuperFractor / print_run ≤ 99. Defaults `hobby_sets=1, bd_only_sets=0` (odds PDF binds the real weighting via `hobby_odds`).

**Player match:** diacritic-stripped normalized names (Dončić ↔ Doncic). CH rows whose player isn't on the product are surfaced in `skippedPlayers` without crashing.

**Blast radius verified:** pricing (`lib/analysis.ts`, `/api/pricing`, `/api/admin/pricing-breakdown`) reads only `id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, hobby_odds` — no `variant_name` dependency. Odds import's token-fuzzy matcher works fine against CH's canonical names.

Deferred (future PRs): auto-create players from CH rows, strip variant creation from `import-checklist`, delete XLSX `parallels` detection. PR #7. Plan: `/Users/brody/.claude/plans/polymorphic-gathering-valley.md`.

---

## 2026-04-21 — Hot-fix: product dashboard counts truncated at 1000

Same Supabase 1000-row cap as PR #4 but on the UI side. Product dashboard was loading full rowsets from `player_products`, `player_product_variants`, and `pricing_cache` just to `.filter().length` them in memory. On Topps Finest every count silently pinned at 1000.

Fix: switch to `count: 'exact', head: true` for stat counts (no row cap, much less data over the wire) and push the unmatched-variants preview filter to the server with `.is('cardhedger_card_id', null).limit(50)`. PR #6.

---

## 2026-04-21 — Hot-fix: paginate `ch_set_cache` load (Supabase 1000-row cap)

`loadCatalogIndex` was only reading the first 1000 rows of `ch_set_cache` because Supabase/PostgREST caps any single response at 1000 rows by default. For small sets this was invisible — for 2025 Topps Finest Basketball (12,097 cards), ~92% of the catalog never made it into the in-memory index, so every variant missed `byNumber` and fell through to no-match.

Symptom: matching against Topps Finest immediately after the v2 descriptor deploy showed 0/40 matches. Vercel logs: `loaded catalog "2025 Topps Finest Basketball" — 1000 cards, 449 unique numbers` (actual: 12,097 cards, ~10k unique numbers).

Fix: paginate `.range(offset, offset+999)` in 1000-row chunks until a short page comes back. Applies to every catalog load — Topps Finest just made it visible. PR #4.

---

## 2026-04-21 — Topps Finest descriptor + XLSX parallel expansion

Two fixes on top of v2 matching to address the 2025-26 Topps Finest Basketball 50% match rate.

### `toppsFinestDescriptor` — new, registered before `bowmanDescriptor`
- Registry order matters: `topps finest` pattern must win over the broader `topps|bowman` match.
- Unlike Bowman, Topps Finest uses colored parallels that CH appends " Refractor" to — `"Red Geometric /5"` in the checklist is `"Red Geometric Refractor"` in CH. Added explicit `variantSynonyms` for every color + every `<color> Geometric` combo seen in the catalog.
- Removed the `/\bSuperfractor\b/gi` strip that Bowman used — Topps Finest's catalog actually uses `"SuperFractor"` (capital F) as a variant name, so stripping it killed exact-variant matches. `byNumberVariant` compares case-insensitively, so keeping the string lets it hit.
- `insertSetNames` covers section-header leakage: `"Finest Autographs"`, `"Colossal Shots Autographs"`, `"Headliners"`, `"The Man"`, `"Muse"`, `"Aura"`, `"Arrivals"`, `"First"`, `"Parallels"`, `"Teams"` (the last one is an XLSX column-header artifact).
- `cardCodePattern` + `autoPrefixes` cover Topps Finest's insert codes: `FAU-`, `RFA-`, `CS-`, `MA-`, `ESG-`, `BA-`, `AU-`, `H-`, `TM-`, `F-`, `A-`, `M-`, `P-`.

### XLSX parser — parallel expansion
The old XLSX parser collapsed every label-only row into `currentSectionName`, so each card only got one variant row equal to the LAST label before it — e.g., every Finest Autograph came out as `"SuperFractor /1"` or `"Red Geometric /5"` depending on which was last. Real checklists list 13–20+ parallels per card.

**Fix:** `ParsedCard` now has a `parallels: string[]` field. The XLSX parser tracks a per-block list of parallel labels (`"Refractor"`, `"Gold /50"`, `"SuperFractor /1"`, etc.) and attaches the full list to each data row. The base section header (`"Base - Common"`, `"Finest Autographs"`) becomes the `sectionName`. The import route expands each card into one variant row per parallel, plus a synthetic `"Base"` row (Topps checklists don't list Base explicitly but every numbered card has one).

Result on 2025-26 Topps Finest Basketball: 300 base cards × ~22 parallels + 289 autos × ~14 parallels + ~150 insert cards × various = ~12,000 variant rows, matching the CH catalog's 12,097.

### Existing imports
The DB still has skewed variants from the old parser (every card stuck on its section's last parallel label). Re-importing the checklist is the clean fix. The new `toppsFinestDescriptor` also rescues a lot of existing rows on re-match — `"Superfractor /1"` → `"SuperFractor"` via case-insensitive byNumberVariant lookup, `"Red Geometric /5"` → `"Red Geometric Refractor"` via synonym.

---

## 2026-04-21 — CH matching v2: catalog pre-load + descriptor-based knowledge

### New architecture — catalog pre-load + tiered local matcher
Fundamental refactor of the CardHedger matching pipeline. Instead of fuzzy-searching CH per variant, we pre-load the full canonical set once into a persistent Postgres cache, then match every variant locally against that index. Claude is now only invoked for the small tail of variants that miss every local tier, and it scores against in-set candidates rather than a free-form search.

**Why:** The prior 76–88% match ceiling on Bowman products wasn't structural — it was fuzzy-fallback contamination. River @ CardHedger confirmed that `/v1/cards/card-search?set=<canonical>` with pagination returns the complete set (autos included, correct `number` fields). Once the set catalog is in hand, matching by `card_number` is a local Map lookup.

**Pipeline** (see `docs/catalog-preload-architecture.md`):
1. Resolve `ch_set_name` via `/v1/cards/set-search` (one-time per product, stored on `products`)
2. Refresh catalog → paginate `card-search?set=` into `ch_set_cache` (daily cron + admin button)
3. Load `CatalogIndex` with `byNumber` and `byNumberVariant` maps
4. Per variant, walk the tier ladder: exact-variant → synonym → number-only → card-code → claude(candidates) → no-match
5. Persist `cardhedger_card_id`, `match_confidence`, `match_tier`

### Descriptor-based manufacturer knowledge (data, not classes)
`lib/card-knowledge/` refactored from imperative `BowmanKnowledge`/`PaniniKnowledge` classes to plain `ManufacturerDescriptor` objects. Each descriptor is a single `const` with `stripPatterns`, `insertSetNames`, `variantSynonyms`, `cardCodePattern`, `autoPrefixes`, and optional `claudeRules`. Adding a manufacturer = one object literal; no class/registry edits. Trivially diffable and admin-editable later.

**Registry:** `bowmanDescriptor`, `paniniDescriptor` (starter), fallback `defaultDescriptor`.

**Generic matcher** `lib/card-knowledge/match.ts` consumes descriptors against `CatalogIndex` — the same tier ladder applies to every manufacturer.

### New tables, cron, admin UI
- `ch_set_cache` — keyed by `(ch_set_name, card_id)`, indexed on `(ch_set_name, number)` and `(ch_set_name, number, lower(variant))`
- `ch_set_refresh_log` — telemetry per refresh run (pages, cards, duration, errors)
- `player_product_variants.match_tier` — tier name persisted alongside `match_confidence` for debugging
- `/api/cron/refresh-ch-catalogs` — daily at 3 AM UTC, deduplicates by `ch_set_name`, serial per-set
- `/api/admin/refresh-ch-catalog` + `RefreshCatalogButton` — on-demand refresh from product page (auto-resolves canonical name if `ch_set_name` is missing)
- Silent-failure protection: refuses to cache results exceeding `maxPages=200` (guards against set-name mismatch returning CH's full 2.9M corpus)

### Telemetry improvements
`RunMatchingButton` now shows the match tier per variant (exact-variant / synonym / number-only / card-code / claude) and catalog card count in the last-run summary. Tier column exported in debug CSV.

### MCP persisted
Added `card-hedge` MCP server to `.mcp.json` (HTTP streamable, `https://api.cardhedger.com/mcp`, `X-API-Key`) so future sessions auto-load CH tools.

**Files:** `lib/cardhedger-catalog.ts`, `lib/card-knowledge/{types,bowman,panini,default,match,index}.ts`, `lib/cardhedger.ts` (claudeCardMatchFromCandidates), `app/api/admin/match-cardhedger/route.ts` (full rewrite), `app/api/admin/refresh-ch-catalog/route.ts`, `app/api/cron/refresh-ch-catalogs/route.ts`, `app/admin/products/[id]/RefreshCatalogButton.tsx`, `supabase/migrations/20260421120000_ch_set_cache.sql`, `vercel.json`, `docs/catalog-preload-architecture.md`

---

## 2026-04-20 — CH matching improvements, ch_set_name, RLS, edit product UI

### CardHedger matching improvements
Per confirmed data from River @ CardHedger:
- **Autograph query fix:** append "Autograph" to queries for auto-prefix card codes (BMA/CPA/BPA/FDA/CA/BSA/BRA etc). Without it, base BCP cards outrank autos. Implemented in `BowmanKnowledge.AUTO_CODE_RE`.
- **Set-catalog mode:** new matching mode pre-loads full CH set via paginated `card-search?set=` (~94 calls instead of 1,000+), builds `card_number → card_id` map locally, matches at confidence 0.95. Falls back to individual Claude matching for unmatched variants. Now the default in RunMatchingButton.
- **Correct prefix names confirmed:** BMA = Best Mix Auto, BPA = Best Performances Auto, FDA = Family Tree Dual Auto, CA = Chrome Auto.
- **2025 Bowman's Best result: 88% → 96%** after River added BMA/BPA/FDA cards to catalog and set-catalog mode went live.

### ch_set_name field + set-search widget
New `ch_set_name TEXT` column on products stores the exact CardHedger canonical set name. Separates the display name (shown to consumers) from the matching key (must match CH exactly).

Product creation/edit form has a new "CardHedger Matching" section: type a query, hit "Find on CH" to call `/v1/cards/set-search`, select the canonical name from a results dropdown. Matching route uses stored `ch_set_name` directly — skips set-search at match time.

**Files:** `supabase/migrations/20260420120000_product_ch_set_name.sql`, `app/api/admin/set-search/route.ts`, `components/admin/ProductForm.tsx`, `app/api/admin/match-cardhedger/route.ts`

### RLS enabled on all tables
Closes the pre-beta security audit item. All 11 tables now have RLS enabled:
- `sports`, `products`, `players`, `player_products`, `player_product_variants`, `pricing_cache`: SELECT for anon (consumer break pages read these)
- `player_risk_flags`: SELECT for anon, active flags only (`cleared_at IS NULL`)
- `waitlist`: INSERT for anon only (public signup form), no anon reads
- `profiles`, `user_roles`, `user_breaks`: already had RLS from earlier migrations

**File:** `supabase/migrations/20260420140000_enable_rls.sql`

### Edit product page cleanup
Replaced redundant hero banner + floating "Back to Dashboard" link with a compact inline header (back arrow + icon + title + product name).

### Manufacturer rules doc updated
`docs/manufacturer-rules/bowman.md` rewritten with correct prefix names, autograph query pattern, set-catalog mode docs, CH canonical naming conventions, 2026+ Bowman Chrome merge note, and updated match rate history.

### README rewritten
Full rewrite — correct URL (getbreakiq.com), updated stack (Stripe/PSA/PostHog), all current routes (consumer + admin), product setup workflow, subscription tiers, matching overview.

---

## 2026-04-13 — Stripe subscriptions, cost analysis

### Stripe subscriptions — Hobby / Pro tiers
Two-tier subscription model: Hobby ($9.99/mo, 10 analyses + 10 slab lookups) and Pro ($24.99/mo, unlimited). 3 free lifetime analyses as trial before paywall. Promo codes enabled on Stripe Checkout.

**Infrastructure:** `lib/stripe.ts` (checkout sessions, customer portal), `lib/usage.ts` (plan-aware usage gating with atomic counter), `/api/checkout` (create session / portal), `/api/webhooks/stripe` (handles checkout.session.completed, invoice.paid, subscription.updated, subscription.deleted). Usage gates on `/api/analysis`, `/api/card-lookup`, `/api/my-breaks`.

**Schema:** `profiles` extended with `stripe_customer_id`, `stripe_subscription_id`, `subscription_plan` (free/hobby/pro), `subscription_status`, `current_period_end`, `analyses_used`, `analyses_reset_at`. Counter resets on each `invoice.paid` webhook.

**Subscribe page** at `/subscribe` — plan cards with feature comparison, "Continue with free trial" option. Onboarding now redirects to `/subscribe` after completion.

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_PRO`

---

### Cost analysis doc
`docs/cost-analysis.md` — full unit economics: fixed costs, variable costs per action, revenue vs. cost at 50/200/500 users (80/20 Hobby/Pro split), breakeven at ~27 paying users (COGS) or ~76 (with dev). Claude API costs negligible (~$12/mo at 500 users); CardHedger $300/mo flat is the only real COGS.

---

## 2026-04-11 — Onboarding wizard, security hardening, Discord + email signup

### Onboarding wizard — 3-step post-signup flow
New users redirect to `/onboarding` after OAuth callback (checks `onboarding_completed_at` on profiles). Step 1: age gate (hard block under 18). Step 2: experience level, what you collect (baseball through Other TCG), collecting eras (modern through 80s), primary break platform, monthly spend (under $150 through $5k+). Step 3: attribution source, best pull (optional free text).

**Schema:** `experience_level`, `collecting_eras TEXT[]`, `monthly_spend`, `primary_platform`, `referral_source`, `best_pull`, `onboarding_completed_at` added to profiles.

**Files:** `supabase/migrations/20260411120000_onboarding_fields.sql`, `app/api/onboarding/route.ts`, `app/(consumer)/onboarding/page.tsx`, `app/auth/callback/route.ts` (redirect logic).

---

### Security hardening — pre-beta audit
**Critical fixes:** Deleted legacy password-based admin auth route. Added `requireRole('admin','contributor')` to all 10 admin server actions. Added `checkRole()` helper in `lib/auth.ts` for API routes.

**High fixes:** Auth guards on all 9 admin API routes (403 if not admin). Auth checks on all 7 consumer API routes (401 if unauthenticated, dev bypass). 

**Medium fixes:** Security headers (X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy). Open redirect fix in admin login. XSS fix in email template (HTML-escape firstName).

---

### Discord OAuth + email signup
Replaced Apple OAuth with Discord on signup page. Added email+password signup with confirmation flow. Auth callback updated to handle both OAuth code exchange and email confirmation (token_hash + verifyOtp).

---

### PostHog analytics
PostHog installed via wizard. Server-side user identification + `user_signed_up` event tracking in auth callback.

---

## 2026-04-09 — My Breaks feature, buzz indicators fix, pricing cache cron

### My Breaks — consumer break tracking
New consumer feature at `/my-breaks`. Users log breaks they've participated in with product, team, break type, cases, asking price, and platform (Fanatics Live, Whatnot, eBay, Dave & Adam's, Layton Sports, Local Card Shop, Other). Two entry points:

- **"New Break"** (pre-break) — runs live BreakIQ analysis, snapshots signal/fair value/narrative to the DB, status=pending. User comes back after to rate the outcome.
- **"Log Previous"** (post-break) — logs everything at once including outcome rating (Win/Mediocre/Bust).

Pending breaks can be completed (outcome + optional notes + analysis feedback) or abandoned ("Didn't buy in" — outbid, changed mind, etc.).

**Analysis snapshot:** Every break stores `snapshot_signal`, `snapshot_value_pct`, `snapshot_fair_value`, `snapshot_analysis`, `snapshot_top_players` (JSONB), `snapshot_risk_flags` (JSONB), `snapshot_hv_players` at creation time. Frozen — doesn't shift as prices change.

**Analysis feedback:** "Was our analysis helpful?" (thumbs up/down) asked during break completion. Stored as `analysis_feedback` column. Enables measuring analysis quality separate from break outcomes.

**Stats row:** Breaks count, Total Spent (excludes abandoned), W/M/B record breakdown (color-coded).

**Filters:** Time (Week/Month/Quarter/6 Months/Year), Platform, Outcome. Filters apply to both stats and break list.

**CSV export:** Downloads all non-abandoned breaks. **CSV import:** Drag-and-drop upload zone on "Log Previous" form with downloadable template. Fuzzy-matches product names.

**Shared analysis module:** Extracted `runBreakAnalysis()` from the analysis route into `lib/analysis.ts`. Both BreakIQ Sayz and My Breaks call this function.

**Schema:** `user_breaks` table with RLS (self read/insert/update), indexes on user_id, status, product_id, platform, created_at. Chase/hit card tables designed but deferred to Phase 2.

**Files:** `supabase/migrations/20260409120000_my_breaks.sql`, `supabase/migrations/20260409140000_analysis_feedback.sql`, `lib/analysis.ts` (new), `lib/types.ts` (UserBreak, Platform, BreakOutcome types), `app/api/my-breaks/route.ts` (new), `app/api/my-breaks/[id]/route.ts` (new), `app/(consumer)/my-breaks/page.tsx` (new), `app/api/analysis/route.ts` (refactored to thin wrapper), `app/(consumer)/ConsumerNav.tsx` (My Breaks link), `middleware.ts` (/my-breaks route), `app/(consumer)/page.tsx` (My Breaks promo replacing BreakIQ Sayz promo)

---

### Buzz indicators data fix
The social currency badges (↑↓ ★ ⚡ ⚑) were already implemented in PlayerTable and TeamSlotsTable but `buzz_score`, `breakerz_score`, and `is_high_volatility` weren't being selected in the pricing API's GET path. Fixed both GET and POST selects.

---

### Pricing cache nightly cron
`app/api/cron/refresh-pricing/route.ts` — loops through all `is_active` products with matched card IDs, calls the pricing POST for each. `vercel.json` schedules at 4 AM UTC daily. Protected with `CRON_SECRET` bearer token.

---

### Responsible gambling footer
"Gambling problem? Call or text 1-800-GAMBLER" banner on homepage above the stats footer.

---

### Component rename
`components/breakerz/` → `components/breakiq/` for brand consistency.

---

## 2026-04-06 — PSA API integration, Slab Analysis UX redesign, CardHedger matching strategy

### PSA API integration — Slab Analysis cert verification
Slab Analysis now calls the PSA public API (`api.psacard.com`) for PSA cert lookups. PSA provides authoritative card identity + population data. CardHedger provides market-wide grade pricing and recent comps.

**Lookup flow:** PSA API → card identity + pop data → CH name search for card_id → `getAllPrices` + `getComps` at the cert's grade. If PSA fails, falls back to CH cert identity for the name search.

**Pricing change:** switched from cert-specific sale history (`pricesByCert`) to market-wide grade pricing (`getAllPrices` + `getComps`). Avg of all PSA 7 sales is more reliable than the history of one specific cert.

**PSA Insights panel:** cert #, label type, pop at this grade, pop higher (in amber). Mirrors eBay's PSA insights modal.

**Env var:** `PSA_API_KEY` — bearer token for `api.psacard.com`. Set in Vercel (all environments) and `.env.local`. Gotcha: variable name typo in Vercel will silently fall back to CH identity only — watch for "PSA_API_KEY not configured" in the amber debug strip.

**Files:** `lib/psa.ts` (new — `getCertByNumber()`), `app/api/card-lookup/route.ts` (updated cert action).

---

### Slab Analysis UX redesign
- Renamed "Card Lookup" → "Slab Analysis" throughout
- Added **Enter Cert #** tab alongside Upload Image — users can look up a cert directly without an image (enter cert number + select PSA/BGS/SGC grader, press Enter or Look Up)
- PSA Verified badge shows grade description (e.g. "GEM-MT 10") + pop count + pop higher when PSA confirms
- Extracted `ResultsPanel` as a shared component used by both input paths

**File:** `app/(consumer)/card-lookup/page.tsx`

---

### CardHedger matching strategy doc + refined questions list
First-principles analysis of the CH entity matching problem saved to `docs/cardhedger-matching-strategy.md`. Refined questions/scenarios list for the CH team conversation at `docs/cardhedger-questions.md` — organized into Priority 1 (blocking, 3 questions), Priority 2 (structural, 4 questions), Priority 3 (efficiency/partnership, 4 questions).

---

### Waitlist redesigned as landing page
Full landing page layout replacing the minimal form. Two-column desktop layout: left = BreakIQ brand + "Private Beta" pill + feature list (BreakIQ Sayz, Live Slot Pricing, Slab Analysis), right = beta access form. Background gradient with glow effects. Updated success state copy.

**File:** `app/waitlist/page.tsx`

---

## 2026-04-06 — Pricing Audit Panel, Slab Analysis, profile page, staging tooling

### Pricing Audit Panel — admin product dashboard
Kyle needed a spreadsheet-like view of the full pricing calculation to verify the math and compare against his manual Excel model. Added a collapsible "Pricing Audit" section to `/admin/products/[id]/` that shows every player with EV Low/Mid/High, odds coverage, effective score, weight, weight %, hobby slot cost, and BD slot cost.

Break config (cases × cost) is editable inline — changing a value recalculates all slot costs client-side instantly with no new API calls. Export to CSV for direct comparison against Kyle's spreadsheet.

**Key implementation detail:** Fetching pricing_cache and variants with `.in(player_product_id, ppIds)` for large products (866 players on Topps Finest) generates URLs that exceed PostgREST's limit and return 400 Bad Request. Fixed by using join-based filters (`player_products!inner(product_id)`) instead, matching the pattern already used in the product dashboard page.

**Files:** `app/api/admin/pricing-breakdown/[productId]/route.ts` (new), `app/admin/products/[id]/PricingBreakdownPanel.tsx` (new), `app/admin/products/[id]/page.tsx` (updated).

---

### Consumer profile page
Added `/profile` for beta users. Fields: first name, last name, date of birth (used to compute `is_over_18` boolean — DOB is not stored), favorite sports, chasing teams, chasing players (free text → TEXT[] arrays). Age verification badge renders live as DOB is entered.

**Files:** `app/(consumer)/profile/page.tsx` (new), `app/api/profile/route.ts` (new GET + PUT), `supabase/migrations/20260403140000_profiles_consumer_fields.sql` (adds `first_name`, `last_name`, `is_over_18`, `favorite_sports`, `chasing_teams`, `chasing_players` to profiles + self-update RLS policy).

---

### Slab Analysis on consumer hero
Replaced the "Browse Products" CTA with a "Slab Analysis" button linking to `/card-lookup`. Moved `card-lookup` page into the `(consumer)` route group so it gets the nav bar and auth gating. Added `/card-lookup` to middleware matcher and `isConsumerRoute` check.

---

### Admin login link on waitlist page
Added a dim "Admin login" link at the bottom of `/waitlist` so admins can find their way in without knowing the direct URL.

---

### Copy-prod-to-staging script
`scripts/copy-prod-to-staging.mjs` — Node.js script using `@supabase/supabase-js` to copy product data (sports, products, players, player_products, player_product_variants) from production to staging. Clears staging tables in reverse dependency order first (so foreign keys don't block deletes), then paginates fetches with `.range()` to handle Supabase's 1000-row default limit. Uses `columnsExclude` to strip staging-only generated columns (e.g. `total_sets`) from upsert payloads.

**Usage:** `STAGING_SERVICE_ROLE_KEY=<key> node scripts/copy-prod-to-staging.mjs`

---

## 2026-04-03 — Consumer auth gating + nav bar

### Consumer routes were publicly accessible
`/`, `/break/*`, and `/analysis/*` had no auth protection — anyone with the URL could access everything. The middleware comment noted this was disabled pending Phase 3 OAuth, which is now live.

**Fix:** Added a `(consumer)` Next.js route group wrapping all three routes. The shared layout (`app/(consumer)/layout.tsx`) checks the Supabase session server-side and redirects to `/waitlist` if not authenticated. Middleware updated to also gate these routes at the edge as a first-line defense.

### No visible login/logout UI on consumer pages
Authenticated users had no way to see their auth state or sign out without manually navigating to `/admin/login`.

**Fix:** Added `ConsumerNav` — a slim sticky header rendered by the consumer layout. Shows the BreakIQ brand and a Sign Out button. For admin/contributor users, also shows a "Consumer View / Admin Portal" mode switcher dropdown. Sign out redirects to `/waitlist` (not `/admin/login`).

**Files changed:** `middleware.ts`, `app/(consumer)/layout.tsx` (new), `app/(consumer)/ConsumerNav.tsx` (new), `app/(consumer)/actions.ts` (new), `app/(consumer)/page.tsx` (moved from `app/page.tsx`), `app/(consumer)/break/[slug]/page.tsx` (moved), `app/(consumer)/analysis/page.tsx` (moved).

---

## 2026-04-02 — Team Slots bug fix, XLSX parser improvements, CH matching fixes

### Claude JSON parse failures in card matching
Claude Haiku was occasionally returning explanation text after the JSON object (e.g. `{"card_id": null, "confidence": 0}\n\nThe query specifies...`). The closing fence strip regex `/\n?```$/` failed because the string didn't end with backticks, causing a parse error and unnecessary fallback to the token matcher.

**Fix (`lib/cardhedger.ts`):** Replaced fence-strip regex with `indexOf('{')` / `lastIndexOf('}')` extraction — robust to any wrapping or trailing text. Also bumped `max_tokens` from 64 → 128 so the response isn't truncated mid-fence.

### CardHedger questions doc
Created `docs/cardhedger-questions.md` — a running list of 13 questions for the CH team across catalog coverage, API behavior, terminology, and partnership. Seeded from real issues hit during 2025 Bowman Chrome Baseball matching (CPA-* autos not in catalog, missing `number` field on autos, multi-player card handling, etc.).

## 2026-04-02 — Team Slots bug fix + XLSX parser improvements

### Team Slots showing player names instead of team names
The Team Slots table was grouping by `players.team`, which was populated with player names instead of MLB team/college names after importing certain Bowman XLSX files.

**Root cause:** The 2025 Bowman Chrome Baseball XLSX contains two index sheets (`Teams`, `Topps Master Checklist`) with different column layouts or cross-product scope. When processed as regular card data, the `Teams` sheet wrote player names into the `team` field; the `Topps Master Checklist` sheet added ~16,000 unrelated players from all Topps products.

**Fix (`lib/checklist-parser.ts`):**
- Added `"Teams"`, `"MLB Teams"`, and `"Topps Master Checklist"` to `XLSX_SKIP_SHEETS`
- Also strips trailing commas from the `team` field (same cleanup already applied to player names)

**Recovery:** Deleted all `player_products` + orphaned players for the affected product via SQL, then re-imported with the corrected parser.

**Documented in:** `docs/manufacturer-rules/bowman.md` — new "Index sheets to skip" section with full sheet inventory for 2025 Bowman Chrome Baseball.

---

## 2026-03-31 — Auth, Waitlist, Staging Environment

### Admin auth — replaced cookie password with Supabase Auth

The previous admin auth (password cookie via `proxy.ts`) was replaced with a proper Supabase Auth session. Admins now log in with email + password via `signInWithPassword`. Role-based access control is enforced via a `user_roles` table.

**New tables (migration `20260331120000_auth_profiles_roles.sql`):**
- `profiles` — mirrored from `auth.users` (id, full_name, avatar_url); auto-populated on user creation
- `user_roles` — `(user_id, role)` where role is `admin` or `contributor`; admin must be seeded manually after creating a user in the Supabase dashboard

**Middleware (`middleware.ts`):** Cookie-aware Supabase client (via `@supabase/ssr`) refreshes the session on every request. Protects `/admin/*` (except `/admin/login`) and `/api/admin/*` — unauthenticated requests are redirected to `/admin/login?from=<path>`.

**`lib/supabase-server.ts`** (new): Cookie-aware server client for use in Server Components and Server Actions. Uses `@supabase/ssr`'s `createServerClient` with `cookies()` from `next/headers`.

**`lib/auth.ts`** (new): `getCurrentUser()`, `getUserRoles()`, `requireRole(...roles)` — server-side auth helpers. `requireRole()` redirects to `/admin/login` if no session or missing role.

**`app/admin/login/`**: Rewritten from password-only form to email + password form. `actions.ts` calls `signInWithPassword`, checks roles, redirects. `logout` server action calls `supabase.auth.signOut()`.

**Deleted:** `proxy.ts` — old cookie-password protection. Was conflicting with `middleware.ts` (Next.js doesn't allow both simultaneously).

---

### Waitlist — public signup + admin approval + Resend invite

Private beta gating via a waitlist. Visitors sign up at `/waitlist`; admins approve from `/admin/waitlist`; approved users receive a Resend invite email with a pre-filled invite link.

**New table (migration `20260331130000_waitlist.sql`):**
```
waitlist (id, email, full_name, use_case, status, invite_code, invite_sent_at, converted_at, notes, created_at)
```
Status enum: `pending → approved → converted` (or `rejected`). `invite_code` is a 12-char hex string generated at approval time. `UNIQUE` on email.

**New routes and files:**
- `app/waitlist/page.tsx` — public signup form with success / already-on-list states
- `app/admin/waitlist/page.tsx` — server component, calls `requireRole('admin')`, renders `WaitlistTable`
- `app/admin/waitlist/WaitlistTable.tsx` — client component with tabs (pending / approved / converted / rejected), "Approve + Invite →" button with optimistic update
- `app/api/waitlist/route.ts` — public POST; handles `23505` unique constraint as `already_on_list`
- `app/api/admin/waitlist/[id]/approve/route.ts` — generates `randomBytes(6).toString('hex')` invite code, updates waitlist record, sends Resend email. Returns `{ ok: true, emailError: true }` if email fails but code was saved.
- `lib/email.ts` — `sendInviteEmail()` using Resend SDK. Lazy `new Resend(key)` inside `getResend()` — avoids build failure when `RESEND_API_KEY` is not set.
- `app/auth/signup/page.tsx` — Phase 3 placeholder (consumer signup coming in next cycle)
- `app/admin/AdminNav.tsx` — added Waitlist nav link

**New env vars:** `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`

---

### Consumer route gating

Unauthenticated visitors on `/break/*` or `/analysis/*` are now redirected to `/waitlist`. Admins (who have a Supabase session) pass through.

Added to `middleware.ts`:
```typescript
const isConsumerRoute = pathname.startsWith('/break') || pathname.startsWith('/analysis');
if (isConsumerRoute && !user) redirect('/waitlist');
```
Matcher updated to include `/break/:path*` and `/analysis/:path*`.

---

### Staging environment

Separate Supabase project (`isqxqsznbozlipjvttha`) for Preview and Development Vercel environments. Production (`zucuzhtiitibsvryenpi`) remains unchanged.

- **Initial schema migration** (`20260101000000_initial_schema.sql`) created — base tables (`sports`, `products`, `players`, `player_products`, `pricing_cache`) were previously applied manually to production. This migration makes staging reproducible and marks the baseline for future migration tracking. On production: marked as already-applied via `supabase migration repair --status applied`.
- All subsequent migrations applied to staging via `supabase db push`.
- Vercel Preview and Development env vars updated to point to staging Supabase.
- `staging` git branch created and pushed — Vercel auto-deploys preview builds from this branch.

---

### CardHedger matching — manufacturer knowledge system + Bowman's Best ceiling

**Manufacturer knowledge system (`lib/card-knowledge/`)** — extracted all manufacturer-specific matching logic from the route into a typed module system:
- `types.ts` — `ManufacturerKnowledge` interface (`matches()`, `cleanVariant()`, `reformulateQuery()`, `claudeContext()`)
- `default.ts` — no-op fallback (identity transforms, empty context)
- `bowman.ts` — all Bowman/Topps logic: variant cleaning (strips "Base -", "Retrofractor", insert set names), card-code detection, multi-player reformulation (slash-delimited names → code-only query)
- `panini.ts` — stub (matches returns false until Panini XLSX files have been analyzed)
- `index.ts` — registry + `getManufacturerKnowledge(productName)`

`lib/cardhedger.ts`: `claudeCardMatch()` and `cardMatch()` now accept an optional `context` string injected into the Claude Haiku prompt. `lib/supabase.ts` pattern used for `??` fallback.

**Tier 2 player-name fallback fix:** The pre-Claude bypass in `cardMatch()` for autograph card codes (BMA-/BSA-/CA-) was comparing against `cards[0].player_name`, but the CH API returns a `player` field at runtime (not `player_name`). Fixed with `c0.player_name ?? c0.player ?? ''`. Also fixed Tier 2 to compare first name only (not all name parts) — avoids false negatives on accented/middle names.

**Multi-player reformulation:** Slash-delimited player names (DA-/TA-/QA-/FDA-/FTA- card codes) now reformulate to a code-only query `[year, setName, cardCode]` — no player name in the query, which CH handles correctly for these sets.

**Bowman's Best — practical ceiling analysis:** After iterative query tuning through CSV 1–10, match rate reached ~76%. Remaining ~24% is structural:
- ~24 multi-player dual/triple/quad auto cards — CH doesn't index under combined names
- ~173 code-only duplicate rows — CH doesn't expose a `number` field for autograph sets, so duplicate code rows (same code, different player) can't be disambiguated without manual intervention

Calling ~76% the practical ceiling for automated matching on Bowman's Best. Full analysis documented in `docs/cardhedger-matching.md` and `docs/manufacturer-rules/bowman.md`.

**New files:** `lib/card-knowledge/types.ts`, `lib/card-knowledge/default.ts`, `lib/card-knowledge/bowman.ts`, `lib/card-knowledge/panini.ts`, `lib/card-knowledge/index.ts`
**Modified:** `lib/cardhedger.ts`, `app/api/admin/match-cardhedger/route.ts`, `docs/cardhedger-matching.md`, `docs/manufacturer-rules/bowman.md`

---

## 2026-03-27 — Card Lookup Tool

### New feature: `/admin/card-lookup`

Personal auction bidding aid — screenshot any graded card listing, get instant pricing from CardHedger before bidding.

**Flow:**
1. Drop a screenshot of an auction listing (eBay, Goldin, PWCC, etc.)
2. Claude Haiku (vision) extracts: player name, set, year, card number, variant, grading company, grade, cert number
3. Cert lookup via `POST /v1/cards/prices-by-cert` — confirms card identity
4. If cert has no price history (common), auto-falls back to name-based search
5. Grade-level price estimates (all PSA/BGS/SGC grades) + 90-day comps displayed
6. Max bid calculator: enter your margin % → ceiling updates live

**Key technical decisions:**
- `prices-by-cert` returns sale history for the specific physical slab, not aggregate market data. Most certs return empty `prices[]`. Grade-level pricing (`all-prices-by-card`) and `comps` are the primary signals.
- When cert lookup returns empty prices, the client automatically retries with name-based search using the extracted fields; an amber notice explains the fallback.
- Card name search returns `player`/`set` field names (not `player_name`/`set_name`) — the route maps both.
- Top-level try/catch in the route handler prevents empty 500 bodies; any crash returns structured `{ error }` JSON.
- `comps` API returns `null` (not `[]`) when no results — all null guards added.

**UI:**
- Two-panel layout: left = screenshot + editable extracted fields; right = results
- Extracted fields are editable — if Claude misreads a field, correct it and re-run
- Card image shown when available from CardHedger
- Grade Prices table: all available grades, matched grade highlighted in blue
- Recent Comps table: sale price, grade, date, platform (when 90-day data exists)
- "Last Sale (Exact Cert)" label clarifies this is cert-specific, not aggregate

**New files:** `app/admin/card-lookup/page.tsx`, `app/admin/card-lookup/error.tsx`, `app/api/admin/card-lookup/route.ts`, `docs/card-lookup/prd-card-lookup.md`
**Modified:** `lib/cardhedger.ts` (added `pricesByCert()`), `app/admin/layout.tsx` (Card Lookup nav link)

---

## 2026-03-26 (2)

### Fix: Admin UI buttons invisible after design system update

Figma Make theme import had set shadcn semantic vars to light values (`--primary: #030213`, `--input: transparent`, `--border: rgba(0,0,0,0.1)`), making all shadcn-based admin buttons and inputs invisible. Remapped all shadcn vars (`--primary`, `--background`, `--card`, `--border`, `--input`, `--muted`, etc.) to terminal design system values in `globals.css`.

**Modified:** `app/globals.css`

---

## 2026-03-26 (1)

### Terminal Design System + Full Consumer UI Redesign

Major visual overhaul — "Bloomberg terminal for card breaks" direction applied across all consumer-facing pages. The design system is now codified in the repo and sourced from Figma Make.

**Design system (`components/breakiq/ds/`)**
- New DS component library: `ElevatedCard`, `StepHeader`, `FormLabel`, `SegmentedControl`, `CounterInput`, `LargeCTAButton` — all using terminal CSS custom properties
- Design tokens stored at `design-assets/design-system-tokens.json`; component specs at `design-assets/DESIGN_SYSTEM_EXPORT.md`
- All DS components exported from `components/breakiq/ds/index.ts`
- Workflow: Figma Make → export source zip → copy CSS/components → adapt for Next.js (Link href, useParams from next/navigation, real data)

**`app/globals.css`**
- Added terminal design system CSS custom properties: `--terminal-bg`, `--terminal-surface`, `--terminal-border`, `--terminal-border-hover`, `--accent-blue`, `--signal-buy/watch/pass`, `--gradient-blue/hero`, `--glow-blue/green`, `--badge-icon`, sport-specific color tokens, etc.
- Defined as non-layered `:root` rules so they override Tailwind's `@layer base` body styles — intentional, do not move into a layer
- Added `.terminal-label`, `.terminal-surface`, `.signal-buy/watch/pass` utility classes

**`app/layout.tsx`**
- Switched fonts to Inter + JetBrains Mono (via `next/font/google`)

**`app/page.tsx` — Homepage**
- Full redesign: sticky terminal status bar (live count, pre-release count, version), hero section with cards photo background, gradient title, CTA buttons ("Analyze a Break" / "Browse Products"), feature pills
- Products section: terminal-bordered card grid with sport-specific gradient accents, pre-release state, last updated timestamp
- BreakIQ Sayz promo card at bottom of hero area
- Hero background: Unsplash sports card image at 20% opacity as base layer under gradient/dot overlays

**`app/break/[slug]/page.tsx` — Break analysis page**
- Redesigned with terminal aesthetic: dark header, tabbed TeamSlots/PlayerSlots with SegmentedControl-style tabs, DashboardConfig panel

**`app/analysis/page.tsx` — BreakIQ Sayz**
- Full redesign to match Figma Make two-column layout
- Hero header: dark gradient with dot pattern, TrendingUp icon, gradient title, Instant Analysis / Market Intelligence / Social Signals feature pills
- Left column: "1 Configure Your Break" — `ElevatedCard` with `SegmentedControl` (Hobby/BD), `CounterInput` for cases, styled native selects for product/team, large price input, `LargeCTAButton`
- Right column: "2 AI Analysis" — `ElevatedCard` with empty state or full result panel
- Result panel: signal verdict card (color-coded border/bg by BUY/WATCH/PASS), fair value vs asking price grid, AI narrative, key players table, HV advisory, risk flags
- All existing data logic preserved (API calls, Supabase team fetch, result types)

**`components/breakiq/DashboardConfig.tsx`**
- Rebuilt using DS components: `ElevatedCard`, `FormLabel`, `CounterInput`

**`components/breakiq/TeamSlotsTable.tsx`, `PlayerTable.tsx`**
- Restyled with terminal design system vars, Social Currency badges updated

**`components/breakiq/ProductCard.tsx`**
- New component matching Figma Make product card design

**New files:** `components/breakiq/ds/` (6 DS components + index), `components/breakiq/SignalBadge.tsx`, `components/breakiq/SocialBadges.tsx`, `design-assets/DESIGN_SYSTEM_EXPORT.md`, `design-assets/design-system-tokens.json`
**Modified:** `app/analysis/page.tsx`, `app/break/[slug]/page.tsx`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/breakiq/DashboardConfig.tsx`, `components/breakiq/PlayerTable.tsx`, `components/breakiq/TeamSlotsTable.tsx`

---

## 2026-03-24 (6)

### Social Currency — BreakIQ Bets Debrief (B-score input)

- New admin section on `/admin/products/[id]` — **BreakIQ Bets Debrief**: conversational B-score input for the editorial scoring layer
- Flow: admin pastes a free-form market narrative ("Wemby is running hot, Cade's been quiet…") → Claude Haiku parses against the product's full player roster with fuzzy name matching → returns suggested scores (-0.5 to +0.5) and drafted reason notes → admin reviews in a table, edits scores/notes, unchecks any players to skip → clicks "Apply" → writes to DB
- Review table: pill-selector for score (−0.5, −0.25, 0, +0.25, +0.5), editable reason note, include/exclude checkbox; low-confidence matches (< 0.7) flagged amber "Review"
- Hallucination guard: API validates all returned `player_product_id`s against the actual roster — any IDs Claude fabricated are filtered out before returning to the client
- `saveBreakerzBets` server action writes `breakerz_score` + `breakerz_note` to `player_products`
- Migration `20260324200000_add_breakerz_bets.sql`: added `breakerz_score FLOAT` and `breakerz_note TEXT` to `player_products`
- **Note:** data was collected in this session but `breakerz_score` was not yet wired into the engine — that shipped in session (7) Phase 1

**New files:** `app/admin/products/[id]/BreakerzBetsDebrief.tsx`, `app/api/admin/parse-bets-debrief/route.ts`, `supabase/migrations/20260324200000_add_breakerz_bets.sql`
**Modified:** `app/admin/products/[id]/page.tsx`, `app/admin/products/actions.ts`

---

## 2026-03-24 (7)

### Social Currency — Phase 1: BreakIQ Bets wired into engine; Phase 2: Icon tier; Phase 3: Risk flags + high volatility

**Phase 1 — BreakIQ Bets live**
- `lib/engine.ts`: engine now reads both `buzz_score` (automated composite) and `breakerz_score` (editorial), combining them as `effective_score = clamp(buzz_score + breakerz_score, -0.9, 1.0)` before applying the slot cost multiplier. Data was already being collected; now it affects actual prices.
- `app/api/analysis/route.ts` + `app/api/pricing/route.ts`: both select `breakerz_score` from DB; Sayz passes editorial notes to Claude prompt when set
- Migration `20260324200000_add_breakerz_bets.sql` was already applied in session (6)

**Phase 2 — Icon tier**
- `players.is_icon BOOLEAN` added (migration `20260324210000_icon_and_risk_flags.sql`)
- Engine skips buzz multiplier entirely for icon-tier players — their structural demand is already reflected in market EV; applying a multiplier would double-count demand
- Admin toggle on `/admin/products/[id]/players` — purple ★ button per player
- Sayz result card shows purple "★ Icon" badge next to icon players in the key players list; icon context passed to Claude prompt

**Phase 3 — Risk flags + high volatility**
- `player_risk_flags` table: `(id, player_product_id, flag_type, note, created_at, cleared_at)` — soft-delete pattern, cleared flags preserved for audit
- `player_products.is_high_volatility BOOLEAN` added
- Admin UI at `/admin/products/[id]/players` — per-player flag add/clear (⚑ button), HV toggle (⚡ button)
- Flag types: injury, suspension, legal, trade, retirement, off_field
- Sayz result card: red ⚑ banner per active flag with player name + note; amber ⚡ high volatility advisory block; both passed to Claude prompt with explicit instruction to mention flagged players
- Engine math unchanged — flags are disclosure-only, not a score input

**New files:** `app/admin/products/[id]/players/PlayerFlagsManager.tsx`, `supabase/migrations/20260324210000_icon_and_risk_flags.sql`
**Modified:** `lib/types.ts`, `lib/engine.ts`, `app/admin/products/actions.ts`, players admin page, `app/api/analysis/route.ts`, `app/analysis/page.tsx`

---

## 2026-03-24 (5)

### BreakIQ Sayz — rename + case count input + homepage CTA
- Renamed feature from "Breaker Says" → **"BreakIQ Sayz"** everywhere (page title, header, nav links)
- Added **Cases in the break** input on the analysis page (default 10, range 1–50); fair value now scales correctly for single-case vs multi-case group breaks
- API (`POST /api/analysis`) accepts `numCases` param; feeds into `BreakConfig.hobbyCases` / `bdCases` — previously always assumed 10 cases
- Homepage: replaced buried text link with a full-width promo strip between header and products — red "BreakIQ Sayz" badge, tagline, and prominent "Check a deal →" CTA button

---

## 2026-03-24 (4)

### BreakIQ Sayz — AI break slot analysis page
- New public page at `/analysis` — "Is this break worth it?"
- Flow: select product → select team → enter break type + case count + what the breaker is charging → Run Analysis
- Calls Claude Haiku with full player context (EV, RC flags, fair value, ask price) → returns 2–3 sentence BUY/WATCH/PASS narrative
- Shows signal badge, % above/below fair value, AI reasoning, and top 5 players with EV data
- For uncached players, fetches live CardHedger pricing before running analysis — prevents $0 fair values on first run
- Linked from homepage promo strip and break page header
- New API route: `GET /api/analysis` (product list) + `POST /api/analysis` (analysis, accepts `numCases`)

### Product release date + pre-release banner
- Added `release_date DATE` column to products (migration `20260324190000_add_release_date.sql`)
- Admin product form (both ProductForm and edit pages) now includes a Release Date field
- Break page: when `release_date` is set and in the future, shows a prominent **blue banner** with the launch date and explanation that pricing is estimated from historical comps — not actual sales of this set. Replaces the smaller amber estimated-pricing notice when applicable.
- Set release date for Bowman 25-26 Basketball (~May 2026) to activate automatically

### Team Slots deal checker UX polish
- Renamed "Your $" column → **"Current Break Price"**, moved before Players column
- Column header highlighted in navy, input has blue border — visually distinct from other columns
- Signal badge (BUY/WATCH/PASS + %) still appears inline after input

---

## 2026-03-24 (3) — V2.1 MVP

### Consumer deal checker
- Added "Your $" input column to every team row in the Team Slots table
- User enters what they're being quoted for a slot → instant BUY/WATCH/PASS signal with % delta
- Thresholds: BUY ≥ 30% below fair value, WATCH within 30%, PASS above fair value
- Uses existing `computeSignal()` from `lib/engine.ts`; no backend required — pure client state
- Clicking the input does not expand/collapse the team row (`stopPropagation`)

### Pricing fallbacks for new releases
- When CardHedger returns no data (new product, no sales history), engine falls back through a chain instead of showing $0:
  1. **Search fallback** — `get90DayPrices(playerName + cardType)` — generic 90-day search using player name + "Auto RC" (rookies) or "Base" (veterans)
  2. **Cross-product** — looks up the same player's pricing from another product's cache (e.g., prior year same player)
  3. **Position default** — rookies: $15, veterans: $8
- `pricingSource` type extended: `'search-fallback' | 'cross-product' | 'default'` added alongside existing `'live' | 'cached' | 'none'`
- Player rows with estimated pricing show an amber "est" badge on evMid in the Player Slots table
- Break page shows an amber banner: "X players using estimated pricing" when any fallback sources are active
- Live pricing that returns evMid = 0 now also falls through to the fallback chain (previously showed as 'live' with $0)

### Social currency foundation (schema only)
- Added `buzz_score FLOAT DEFAULT NULL` to `player_products` via migration `20260324180000_add_buzz_score.sql`
- Engine weight formula updated: `hobbyWeight = hobbyEVPerBox × (1 + (buzz_score ?? 0))`
- When `buzz_score` is null/0: behavior identical to before. When populated: proportional boost to that player's slot weight
- No admin UI, no data source yet — column is reserved for future social/buzz pipeline

---

## 2026-03-24 (2)

### Infrastructure: permanent repo location
- Moved repo from `/tmp/breakerz-next` to `~/Documents/GitHub/breakerz` — `/tmp` was wiped on every reboot, corrupting git state and losing context between sessions
- Preserved Vercel project link (`.vercel/project.json`) so deploys still target the same project
- Updated CLAUDE.md and README to reflect the new path and correct production URL (`breakerz.vercel.app`)

### Admin login fix
- Auth route was checking `ADMIN_SECRET` (not set) instead of `ADMIN_PASSWORD`; cookie was `admin_token` instead of `admin_session`
- Proxy was checking `admin_session` against `ADMIN_SESSION_SECRET` — mismatch caused silent auth failures
- Fixed auth route to use correct env vars and cookie names
- Fixed login page: replaced `router.push + router.refresh()` with `window.location.href` to avoid RSC navigation race that caused the hang

### Odds-weighted EV in pricing engine
- Engine now weights the hobby pool by `hobbyEVPerBox` = `Σ(variantEV × 1/hobby_odds)` instead of flat `evMid`
- A $50 card at 1:6 odds gets 8× the weight of a $50 card at 1:48 — reflects actual pull frequency per box
- Added `hobby_odds` to variant select in pricing route; POST path computes per-player `hobbyEVPerBox` from variant data
- GET/cached path falls back to `evMid` when odds data is absent

### CardHedger comps fix
- `/v1/cards/comps` started requiring `count` and `grade` fields — was returning 422
- Fixed `getComps()` to always pass `grade = 'Raw'` and `count = 10` as defaults

### XLSX checklist support (Bowman-style)
- Added `parseChecklistXlsx()` to `lib/checklist-parser.ts` — handles multi-sheet XLSX files
- Each sheet becomes a section (Base, Variations, Prospects, Autographs, Inserts); skips aggregate sheets (Full Checklist, NBA Teams, College Teams)
- Row format: `[card_code, "Player Name,", team_or_college, optional "RC"]` — trailing commas on player names are cleaned automatically
- `parse-checklist` API route detects `.xlsx`/`.xls` and routes accordingly
- Import wizard file input now accepts `.pdf`, `.csv`, `.xlsx`, `.xls`

### Import pipeline: batch DB operations + unique constraint
- Rewrote `import-checklist` API route from ~1500 sequential inserts to ~5 bulk operations — eliminated Vercel function timeouts on large checklists
- Players upserted in one batch; player_products in one batch; variants in chunks of 500
- Fixed `ON CONFLICT` error: added `players_name_sport_id_unique` constraint via migration (`supabase/migrations/20260324145748_players_unique_name_sport.sql`); migration also deduplicates any existing duplicate rows first
- Fixed `ON CONFLICT DO UPDATE affects row a second time`: same player appearing across multiple XLSX sheets was creating duplicate rows in the upsert batch — fixed by deduplicating `playerRows` by name before upserting
- Fixed `total_sets generated column` error: removed `total_sets` from insert payload (it's a Postgres generated column)

### Multi-league products (decision)
- Bowman Basketball mixes NBA, WNBA, and college players in one product
- Decision: treat as "Basketball" sport; player `team` field holds whatever string (NBA team, WNBA team, or college). Break page groups by team/school — correct behavior for a Bowman break.
- No schema change needed.

### Jumbo break type (deferred)
- Jumbo boxes have different odds from Hobby and Breaker's Delight
- Deferred until there's an actual Jumbo product to break — would require `jumbo_case_cost` on products, `jumbo_odds` on variants, third pool in engine

### Admin / product creation fixes
- New product page now redirects to product dashboard after save (was silently succeeding with no navigation)
- Fixed build errors: missing `updateProduct` server action, nullable field type mismatches in `createProduct`, undefined error string in `ProductForm`
- Removed deprecated `middleware.ts` — Next.js 16 uses `proxy.ts`; both files existing caused a startup error

---

## 2026-03-22

### Claude-powered CardHedger matching
- **Replaced token-based `cardMatch()`** with a Claude semantic matcher in `lib/cardhedger.ts`
- Claude sees the top 5 CardHedger search results and reasons about which (if any) is the correct match — handling player name variations, set abbreviations, RC year alignment, variant synonyms (Auto = Autograph, RC = Rookie Card, etc.)
- Model: `claude-haiku-4-5-20251001` — fast and cheap enough for batch matching
- Token-based scorer kept as fallback if Claude call fails (rate limit, error, timeout)
- Claude prompt returns `{ card_id, confidence }` JSON; if no match, returns `null`; fallback returns token-matched top result
- Added `AbortSignal.timeout(10_000)` to all CardHedger API fetch calls to prevent zombie connections
- Added `{ timeout: 10_000 }` option to Anthropic SDK call
- Dynamic `import('@anthropic-ai/sdk')` (not `require`) required in Next.js server context
- Added `ANTHROPIC_API_KEY` to Vercel env vars

### Bug fix: matching silently skipped saves
- **Root cause:** `catch` block in the variant matching loop swallowed all errors and returned `'no-match'` — if `cardMatch()` threw for any reason (API timeout, Anthropic error), the Supabase update never ran and the failure was invisible
- **Also:** Supabase `.update()` result was discarded — write errors went undetected
- **Fix:** catch block now logs the error (visible in Vercel function logs) and returns an `error` field in the result; update result is checked and logged if it fails; added null guard on `card_id` before writing an auto-match

### Chunked polling for large-batch matching
- **Rewrote `app/api/admin/match-cardhedger/route.ts`** from streaming NDJSON to chunked polling
- Each POST processes one chunk (default 40 variants, `CONCURRENCY=8`), returns `{ results, total, processed, hasMore, nextOffset }`
- Client (`RunMatchingButton.tsx`) loops: sends offset → gets chunk → updates progress → pauses 300ms → repeats until `hasMore = false`
- Fixes Vercel serverless function timeout issue — each chunk runs in ~10–15s, well under the 60s `maxDuration`
- Writes both `cardhedger_card_id` (auto-matches ≥0.7 confidence) and `match_confidence` to `player_product_variants`

### Product dashboard (`/admin/products/[id]/`)
- **Standalone odds upload:** `OddsUpload.tsx` — upload a Topps odds PDF at any time, independent of the import wizard; shows matched/unmatched variant table after applying
- **Re-run Matching button:** `RunMatchingButton.tsx` — triggers chunked matching with live progress bar (completed/total), summary on completion (matched / low confidence / no match), retry on error
- **Unmatched variants list:** amber section showing up to 50 variants missing a CardHedger card ID (player name, variant name, card number)
- **Product readiness stats:** Players, CH Matched %, Odds status, Pricing cache count with status pills (green/amber/gray)

### Coordinate-aware odds PDF parser (rewrite)
- **Replaced** the text-line odds parser with a coordinate-aware extractor using `pdf2json`
- Old parser: relied on text order, grabbed wrong column (Distributor Jumbo), filled subset names with dash strings from N/A columns. Result: 19 matched / 263 unmatched.
- New parser: reads x/y positions per text token; detects Hobby Box column x-position dynamically (first row with ≥10 `1:` tokens, `colonItems[1]`); only emits rows with actual hobby odds
- Continuation rows (all-caps label, no column data) are appended to the previous emitted row's `subsetName` — handles multi-line subset names correctly
- Mixed-case rows (page titles like "2025 Topps Baseball Series 2") are skipped and reset the continuation target
- Result: 224 clean rows from Series 2 PDF with correct hobby odds

---

## 2026-03-18 (2)

### Break page UI cleanup
- **Hobby/BD toggle:** Added Hobby Case / Breakers Delight pill toggle at the top of the break page. Config, table columns, and totals all reflect the active type. `breakType` is UI state only — engine still computes both.
- **Removed seller fields:** eBay fee rate, shipping/card, and breaker margin commented out of DashboardConfig. Reserved for a future seller/breaker UI variant. Totals simplified to `cases × cost`.
- **Focused tables:** TeamSlotsTable and PlayerTable now show a single Slot Cost column for the active break type (was separate hobby + BD columns).
- **Alphabetical sort:** Teams A→Z in Team Slots; players A→Z in both Team Slots (expanded rows) and Player Slots. Previously sorted by cost descending.

### Admin entry point
- Created `app/admin/products/page.tsx` — product listing page that was missing, making `/admin` unreachable from the browser. Lists all products with links to player management and import wizard.

---

## 2026-03-18

### Deployment fixes
- **Vercel build fix — pdf-parse:** `pdf-parse` evaluates canvas bindings at module load time and crashes the build with `DOMMatrix is not defined`. Fixed by moving `require('pdf-parse')` inside the handler function and adding `export const dynamic = 'force-dynamic'` to affected routes (`parse-checklist`, `parse-odds`).
- **GitHub sync:** Vercel builds from the GitHub repo, not local uploads. Commits must be pushed to `origin/main` before deploying or the build uses stale code.
- **Rebase + merge:** Local branch (team slots, checklist import) was rebased onto `origin/main` (Heritage UI redesign, CardHedger auth fixes). All conflicts resolved; both feature sets now live together.

### CLAUDE.md
- Created `/CLAUDE.md` — project context file loaded automatically by Claude Code each session
- Covers: stack, deploy command, env vars, two known build gotchas (Supabase + pdf-parse), key file map, schema overview, pricing model, checklist format table, MCP config
- Added reference links in README pointing to CLAUDE.md and CHANGELOG.md

### Infrastructure restored
- `scripts/map-cards.mjs` — interactive CLI for manually mapping CardHedger IDs to players; was on GitHub but missing from local
- `.mcp.json` — Supabase MCP server config (project ref: `zucuzhtiitibsvryenpi`); connects Claude Code directly to live Supabase

---

## 2026-03-17

### Checklist import admin wizard
3-step wizard at `/admin/import-checklist` for seeding product rosters from manufacturer checklists.

**Step 1 — Upload:** product selector, file upload (PDF or CSV), parse
**Step 2 — Review & Configure:** per-section table with hobby/BD set inputs, expandable card previews, flagged-line review
**Step 3 — Result:** import summary, CardHedger auto-matching (confidence bands: auto / needs review / no match), optional odds PDF upload

New admin API routes:
| Route | Method | Purpose |
|---|---|---|
| `/api/admin/products` | GET | Product list for import wizard dropdown |
| `/api/admin/parse-checklist` | POST | PDF or CSV → `ParsedChecklist` |
| `/api/admin/parse-odds` | POST | Topps odds PDF → `ParsedOdds` |
| `/api/admin/import-checklist` | POST | Upsert players, player_products, variants |
| `/api/admin/match-cardhedger` | POST | Auto-link variants to CardHedger card IDs |
| `/api/admin/apply-odds` | POST | Write pull rates to variants by fuzzy name match |

### Multi-format checklist parser (`lib/checklist-parser.ts`)
- `parseChecklistPdf()` — Topps numbered (`# Player Team®`) and code-based (`SM-AB Player Team®`); auto-detects format; groups by ALL-CAPS section headers; flags unparseable lines
- `parseChecklistCsv()` — Panini/Donruss CSV; groups by `CARD SET`; maps `SEQUENCE` → `printRun`
- `parseOddsPdf()` — extracts `1:N` tokens per line; subset name = everything before first token

Supported formats:
| Format | Example products |
|---|---|
| Topps PDF — numbered | Heritage Baseball, Finest Basketball (base) |
| Topps PDF — code-based | Finest Basketball (autos), Midnight Basketball |
| Panini/Donruss CSV | Select Football, Optic Football, Donruss Football |
| Topps odds PDF | Finest Basketball odds sheet |
| URL (parked) | Upper Deck — JS-rendered, needs browser automation |

### Player product variants model
- Added `player_product_variants` table: multiple distinct card types per player per product (e.g., Base Auto + XRC Auto), each with its own CardHedger ID, set counts, card number, SP flag, print run, hobby/breaker odds
- Pricing route updated: batch-prices all uncached variant card IDs in one CardHedger call, computes total-set-weighted EV before caching
- Falls back to `player_products.cardhedger_card_id` if no variants exist

### Team Slots view
- Team Slots is now the default tab on the break page
- Aggregates player EV by team: per-team slot cost, RC count, expandable player list
- Added `computeTeamSlotPricing()` to `lib/engine.ts`
- Tab order: Team Slots → Player Slots → Breaker Compare

### CardHedger client additions (`lib/cardhedger.ts`)
- `batchPriceEstimate()` — up to 100 card/grade combos per call
- `cardMatch()` — token-overlap confidence scoring (0–1) for admin auto-matching
- `computeLiveEV()` — EV low/mid/high from all-prices + comps fallback

### Heritage UI redesign
- Topps Heritage-inspired card aesthetic: cream backgrounds, serif type, red accent bar
- Redesigned homepage, break page header, and component styling

### Next.js migration
- Migrated from Vite + React to Next.js 15 App Router (TypeScript, Tailwind, shadcn/ui)
- Added Supabase backend; replaced hard-coded prototype data with live DB
- Schema: `sports`, `products`, `players`, `player_products`, `pricing_cache`, `player_product_variants`

---

## Earlier (pre-Next.js, 2025)

### 0.2.0
- Breaker Comparison tab — hobby vs BD breakeven analysis, top 20 BUY/WATCH/PASS signals
- Player table with EV tier badges (hot / warm / cold)
- DashboardConfig: case counts, costs, eBay fee, shipping inputs

### 0.1.0
- Initial prototype: static player data (2025-26 Topps Finest Basketball), Vite + React + Tailwind
- Break pricing engine: `Slot Cost = Break Cost × (evMid × sets) / Σ(evMid × sets)`
