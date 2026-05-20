# BreakIQ — Backlog

Consolidated list of known work, organized by priority. Items pulled from the Social Currency PRD, CLAUDE.md known gaps, and open questions surfaced during development.

**Last updated:** 2026-05-20

---

## Priority 0 — Live-product blockers

Active products on getbreakiq.com that are currently shipping wrong data. Fix before anything else.

### Topps Baseball Series 1 / Series 2 split — derived productScope as fallback predicate
**Effort:** ~1–2 hours
**Full plan:** [docs/plans/2026-05-10-topps-series-split.md](plans/2026-05-10-topps-series-split.md)

**Why P0:** `2025 Topps Series 1 Baseball` ([`/break/topps-series-1-baseball-2025`](https://getbreakiq.com/break/topps-series-1-baseball-2025)) is live with `ch_set_name="2025 Topps Baseball"` pulling **1,249 players × 43,213 variants** from CH's parent set, which conflates Series 1 (#1–330) and Series 2 (#331–660). Slot pricing, chase cards, and Recent Sales blend Series 2 data into Series 1 breaks.

**Root cause (verified 2026-05-10):** The scoping mechanism already exists. `player_products.checklist_card_numbers` is populated by the import-checklist parser and consumed by [`hydrateVariantsFromCatalog`](../lib/variants-from-catalog.ts:144) as a strict per-pp allow-list. **Scoped pps are pristine** — Judge/Ohtani/Trout/Witt all have 100% of variants matching their checklist. The leak comes entirely from **500 unscoped pps** auto-created via Phase 3 of the hydrate flow. Auto-created pps have **no entry** in `attachPredicateByPpId`, so the `if (predicate && !predicate(...))` guard at [line 250](../lib/variants-from-catalog.ts:250) short-circuits and every card through. **Verified leak: 12,112 numeric variants** (10,525 in S2 range + 1,587 above 660).

**Fix shape (no new schema, no admin UI):**
1. At hydrate time, derive `productScope = Union of checklist_card_numbers across scoped pps`.
2. For null-checklist pps (including auto-creates), use `n => productScope.has(n)` as the predicate instead of the implicit "everything allowed."
3. Pre-filter Phase 3's auto-create discovery to only consider CH rows whose card_number is in productScope.
4. Empty productScope (brand-new products before first checklist import) falls back to permissive — preserves today's behavior for that case.

Why this beats the original `card_number_filter jsonb` design: the existing `checklist_card_numbers` column already encodes the truth. Adding a new column would duplicate that signal less precisely. Deriving productScope at runtime needs zero schema and zero admin training.

**Pre-flight checks:**
- ✅ Insert overlap NOT a concern — Topps continues numbering across series for Series 1 / Series 2 (each insert subset like "T90-*" uses one continuous numeric range across both physical products).
- ✅ Backward compatible — empty productScope falls back to today's permissive behavior, so single-set products are unaffected.

**Operational steps (after code lands):**
1. Re-import 2025 Topps Series 1 checklist to ensure `checklist_card_numbers` is populated for legitimate base players.
2. Re-hydrate Series 1 from admin (the existing delete-then-insert flow handles cleanup).
3. Re-run pricing refresh on Series 1.
4. Create 2025 Topps Series 2 Baseball product, import its checklist, hydrate.

**What this also unlocks**: the 2026 Bowman Chrome / Prospects consolidation River announced, and any future product line where the breaker market and CH's canonical naming diverge — all without any new per-product config.

See the [full plan](plans/2026-05-10-topps-series-split.md) for verified data, code sketches, decision log, and execution order.

---

## Priority 1 — High value, no external blockers

> **Note (2026-05-12):** P1 ordering was re-evaluated against the strategic reframe captured in [docs/strategy/north-star-and-feedback-loop.md](strategy/north-star-and-feedback-loop.md) and [docs/strategy/product-strategy-map.md](strategy/product-strategy-map.md). The three entries below — Market Delta Watch, In-Stream Delivery, and Pull-Data Capture — are the items that turn the model work we've already shipped into a measurable, defensible product. They precede pure model-improvement items because measurement-driven validation now unblocks all the model work.

> **Execution sequencing:** The P1 entries below are ordered by the execution roadmap in [docs/strategy/execution-roadmap.md](strategy/execution-roadmap.md). Each step is calibrated to "strategic clarity per engineering day" rather than feature size — items earlier in the list make strategic claims visibly true to users faster. **Do not ship Track A/B (steps 5, 8) before items 1-3 — sophisticated model work without surfacing UI is invisible moat-building.**

### 1. Market Delta Watch — Stage 1 measurement, available today  ✅ SHIPPED 2026-05-12
**Effort (actual):** ~½ day, as estimated.
**Shipped at:** [`/admin/market-delta`](../app/admin/market-delta/page.tsx). Reads `user_breaks` rows directly (no new schema). Renders thesis verdict (P90 absolute delta) + headline stats + 7-bucket distribution histogram + per-product breakdown + recent-50 observation list. Now also includes a "/break-price captures" panel listing the most recent 50 `market_observations.asking_price` rows from step #2.

**Why it stays in the backlog as a reference:** future iterations (slot-level delta vs. bundle delta, per-team fair-value lookup that lets us compute deltas for `/break-price` captures, public-facing version) will live underneath this entry.

---

### 2. Live ask-price ingestion  ✅ SHIPPED 2026-05-13 (as Discord `/break-price`)
**Effort (actual):** ~5 hours. Half the original 1-2 day estimate because we reused the entire `/insight` infrastructure.
**Shipped via:** `/break-price` Discord slash command — narrative + screenshot + notes options, optional product picker via Discord autocomplete (added 2026-05-13). Writes to `market_observations.asking_price` via the existing `pending_insights` ✅/❌ flow. Original "admin-paste UI" sketch was abandoned in favor of Discord-first design — SMEs already watch streams in Discord-adjacent contexts (or on mobile), and zero-context-switch capture beats a separate web form.

**Still queued under this entry:**
- Auto-apply on high-confidence single-product captures (skip the ✅ step). Needs feedback from real usage first.
- Disambiguation buttons when product autocomplete is skipped AND Claude can't infer.
- v2: consumer-side submission flow (still deferred — admin/SME-only for now).
- v3: stream-replay scraping / CV (still deferred).

---

### 3. Side-by-side comparison UI on `/break/[slug]`  ⏭ NEXT UP
**Effort:** ~2-3 days  
**Why:** This is the single highest-user-perceived-impact change in the entire strategic roadmap. Once #2 (ask ingestion) lands, surface the data where users already look. Each team slot row shows:

```
Royals · BreakIQ $1,447 (±$280) · Last 5 breaker asks: $1,800 / $2,100 / $1,650 / $2,600 / $1,950
VERDICT: BUY under $1,800
```

Without this UI, the strategic claim "differentiated voice" is invisible to consumers. The moat is real but unobservable to a user landing on a break page.

**Build:**
- Component on `/break/[slug]` team slot table: per-team row shows BreakIQ value, observed-asks distribution (median + min/max of recent N), recommended action threshold
- Pull from `breaker_ask_observations` filtered to `product_id` + `scope_team`, last 30 days (or last N observations, whichever is smaller)
- Empty state when no asks observed yet: "No recent asks observed — we'll show comparison when data lands"
- Decay/freshness handling: weight more-recent asks higher when computing the comparison center

**Why P1 now:** Step 3 of execution roadmap. The visible form of every prior step's investment. Without this, every Track A/B/UI improvement is invisible to the people we're trying to win.

---

### 4. Pull-Data Capture in My Breaks — Stage 2 measurement unblocker
**Effort:** ~1 week  
**Why:** Per [docs/strategy/north-star-and-feedback-loop.md](strategy/north-star-and-feedback-loop.md), our north-star metric (recovery rate per user — `pull_value / ask_price ≥ 0.5`) requires observing what cards users actually pulled from breaks. Today `user_breaks.outcome` is a 3-bucket subjective label (Win/Mediocre/Bust); we don't capture the actual cards or their values. Until we do, we can't compute recovery rate, calibration error, or verdict accuracy — all of the metrics that would prove BreakIQ's model is right (not just internally consistent).

**Build:** Extend `My Breaks` flow so users completing a break can log their pulls. Three input modes:
1. Manual entry — player name + variant (slowest, most accurate)
2. Photo upload + Claude OCR — friction-light, auto-extracts cards from a breaker's card-list screenshot
3. Bulk paste from breaker's card-list message — works for some platforms

Each logged pull gets CH-priced via existing infrastructure → sum to `total_pull_value` → compute `recovery_ratio`. Backfill historic breaks where data still exists.

**Why P1 now:** Without this, every model improvement (Track A prospect_score, Track B cascading sentiment, freshness multiplier, anchor strategies, grade ratio value) is hypothesis-driven and unprovable. With this, every model constant becomes a tunable hyperparameter validated against observed reality. **This is the single shipping change that converts BreakIQ from "tuning a piano with the lid closed" to a learnable system.**

Related: see Section 4 of [docs/strategy/north-star-and-feedback-loop.md](strategy/north-star-and-feedback-loop.md) for the full measurement stack — Stage 1 (Market Delta, this section) → Stage 2 (recovery ratio, this entry) → Stage 3 (verdict accuracy) → Stage 4 (confidence-calibrated coverage).

---

### 6. Consumer audit trail UI — "Why this price?"  ✅ SHIPPED 2026-05-12
**Effort (actual):** as estimated.
**Shipped at:** [components/breakiq/WhyThisPriceCard.tsx](../components/breakiq/WhyThisPriceCard.tsx). Renders inside [PlayerDetailDrawer](../components/breakiq/PlayerDetailDrawer.tsx) above the variants table when an `audit` prop is provided. Decomposes the slot price into baseline EV → lifecycle multiplier → score modulation rows (Track A prospect with source, SME with note, AI buzz, dominant risk flag, hype tag, Track B cascade combined) → pool allocation → market markup. Per-scope cascade breakdown (Team / Product / Team×Product) is deferred to Phase 3 UI — for now Track B contributions show as a single combined row.

**Still queued under this entry:**
- Phase 3 UI: per-scope cascade breakdown (split Team / Product / Team×Product into separate rows).
- Mobile-first redesign of the card for sub-400px viewports (current layout works but is dense on phone).

---

### 7. In-Stream Delivery — meeting users at the moment of decision
**Effort:** ~1-2 weeks for v1 (Discord bot)  
**Why:** Per the strategy reframe, the web app's pre-break analysis posture misses the actual moment of decision. Users decide while watching a live stream with ~8 seconds to claim a slot, not 30 minutes before the break sitting at a laptop. The value prop ("Stop overpaying breakers — before you claim the slot") writes a check the current product surface can't fully cash.

**Three plausible v1 channels — pick one:**
1. **Discord bot** (recommended for v1) — most breakers already run Discord servers; lowest engineering cost; reuses the Discord parser + bot infrastructure already in production. Bot posts BreakIQ verdicts in real time as the SME types or as the breaker calls slots
2. **Browser extension** — overlays verdict next to live ask on Whatnot / Fanatics Live. Higher engineering cost; harder distribution
3. **Mobile push (PWA)** — pre-configured "watching this product" alerts. We already have PWA infrastructure; alert-payload design is the main work

**Recommendation:** Discord bot first. Lowest cost to market, validates the in-stream-decision-support hypothesis, builds on existing Discord investment.

---

### Streaming pricing refresh (scaling unblock)
**Effort:** ~1.5 days (3 phases × ½ day) **Hard deadline: ship before active product count crosses 25.**

**Plan:** [docs/plans/2026-05-10-streaming-pricing-refresh.md](plans/2026-05-10-streaming-pricing-refresh.md)

**Why:** Current pricing pipeline processes one product end-to-end per Vercel invocation (300s ceiling). At ~3 products per cron worker × 3 concurrent workers × 5 firings/night = ~15 products refreshed per night maximum. **At 25 active products this is a 2-day cycle; at 50 it's 3-4 days; at 100 it's 7+. The 22h staleness threshold becomes meaningless — everything is always stale.** Two patches in May (#68 per-CH-card cache, #71 no-abort orchestrator) bought time but don't change the throughput ceiling.

**Fix:** Two stateless crons:
1. **Variant cron** (every 5 min) — picks N stalest CH cards globally (no product awareness), batches them, writes `ch_price_cache`. Naturally fair — a 10k-variant product's cards refresh at the same per-card cadence as a 100-variant product.
2. **Aggregation cron** (every 15 min) — for each active product, reads variants joined with `ch_price_cache`, applies engine math, upserts `pricing_cache`. Pure read+aggregate, ~5s per product, no CH calls.

Adding products doesn't change cron timing — it just means each card waits a bit longer for its slot. Linear degradation, not cliff. The `ch_price_cache` schema shipped 2026-05-09 is exactly the primitive this design uses.

**Open questions** (in plan doc): admin manual-refresh UX changes; cron 1 budget tuning; CH rate-limit validation at higher cadence.

---

### Panini-aware checklist parser (Master Checklist as canonical source)
**Status: ✅ Complete (2026-05-06)** — `parsePaniniXlsx` shipped in [lib/checklist-parser.ts](../lib/checklist-parser.ts) with auto-detection on the `Master Checklist` sheet header. 2025 Panini Prizm Football now parses to 316 sections / 34,723 cards / 163 variants for Travis Hunter (top star). Variant names match CardHedger's catalog directly. Full rules + verification doc at [docs/manufacturer-rules/panini.md](manufacturer-rules/panini.md). Sanity-check script at [scripts/verify-panini-parser.mjs](../scripts/verify-panini-parser.mjs).

**Original entry below for context.**

**Effort:** ~½ day
**Why:** Surfaced 2026-05-06 trying to import 2025 Panini Prizm Football. Panini XLSX has a fundamentally different shape from the Topps/Bowman files the parser was built for:

- **Topps/Bowman format:** structured per-section sheets where each section lists its base cards once and parallels separately. Parser expands base × parallels at import time. Current behavior is correct.
- **Panini format:** TWO parallel data sources in the same file:
  - **`Master Checklist` sheet** (the canonical source) — flat, fully denormalized table with clean columns: `CARD SET / CARD NUMBER / ATHLETE / TEAM / SEQUENCE`. 34,723 rows × 316 distinct CARD SETs for 2025 Prizm Football. Every (parallel × athlete) tuple is its own row.
  - **`Base / Inserts / Autographs / Memorabilia` sheets** — semi-structured per-section listings using parallel names like "Pink Wave", "Silver" without the "Base Prizm" prefix. The current parser pulls 24 sections from these (~1,595 cards), missing 90%+ of the actual data because Base sheet's "Prizm Black and Blue Checker", "Black Finite", "Blue", "Blue Ice", etc. (all 300-row parallels) aren't getting picked up.

Importing both sources double-imports under different `variant_name` strings (e.g., "Pink Wave" from Inserts vs. "Base Prizm Pink Wave" from Master). The dedupe-on-(pp_id, variant_name, card_number) added in PR #57 won't catch them because the strings differ.

**Today's workaround:** uncheck Master Checklist in the import UI; accept incomplete coverage from the 24 named sections. Not viable long-term — we lose ~90% of the parallel surface.

**Real fix:** detect Panini format at parse time (sheet name "Master Checklist" with `CARD SET / CARD NUMBER / ATHLETE / TEAM / SEQUENCE` header is a strong tell), bypass the metadata sheets, build sections directly from Master Checklist by grouping rows on `CARD SET`. Each unique CARD SET becomes one parser section with its athletes attached as cards. Variant names match Master Checklist verbatim — these are also what shows up in CardHedger search results, so matching gets cleaner too.

**Files to touch:**
- `lib/checklist-parser.ts` — new `parsePaniniXlsx(workbook)` path, gated on Master Checklist sheet detection
- `lib/card-knowledge/panini.ts` — new manufacturer descriptor (synonyms for Panini parallel naming, RC year handling)
- `docs/manufacturer-rules/panini.md` — document the format quirks and matching rules (mirror `docs/manufacturer-rules/bowman.md`)
- Test fixture: 2025 Panini Prizm Football XLSX is in `~/Downloads/2025-Panini-Prizm-Football.xlsx` (single product is enough to validate)

**Verification:** import 2025 Panini Prizm Football, expect ~316 sections + ~34,700 variant rows after parser run, confirm a sample variant matches in CardHedger via the existing match flow.

---

### C. Upgrade Vercel Hobby → Pro for jumbo product pricing
**Status: ✅ Complete (2026-04-22)** — upgraded to Pro, `maxDuration = 300` on both `app/api/admin/refresh-product-pricing/route.ts` and `app/api/cron/refresh-pricing/route.ts`. Graceful-deadline constants in `lib/pricing-refresh.ts` bumped to 270/290s. Bowman Chrome (6,481 variants) now completes a full refresh in a single invocation.

---

### D. Per-variant price cache for incremental refresh
**Status: ✅ Complete (2026-05-09)** — shipped as `ch_price_cache` (keyed by `cardhedger_card_id` rather than per-variant — same CH card can back multiple variants, so per-card sharing is more efficient). Per-chunk writebacks during the batch phase + per-100-PP incremental flush during the per-pp phase mean a timeout no longer wipes the run. Migration: [supabase/migrations/20260509220000_ch_price_cache.sql](../supabase/migrations/20260509220000_ch_price_cache.sql). Pipeline rewrite: [lib/pricing-refresh.ts](../lib/pricing-refresh.ts).

**Original entry below for context.**

**Effort:** ~1 day
**Why:** Today, refreshing pricing for a product means re-fetching *every* variant from CH in one shot. With 6,000+ variants that pushes the batch endpoint hard and forces us into all-or-nothing invocations. If we stored `raw_price` + `last_priced_at` on `player_product_variants`, we could:
1. Skip variants priced in the last 24h (incremental refresh)
2. Resume mid-product after a timeout instead of restarting
3. Price on a schedule staggered across variants (e.g., price 500 most-volatile variants/hour) instead of one big nightly blast

**Schema:**
```sql
ALTER TABLE player_product_variants
  ADD COLUMN raw_price numeric(10, 2),
  ADD COLUMN last_priced_at timestamptz;
```

**Files to touch:**
- `lib/pricing-refresh.ts` — skip fetch if `last_priced_at > now() - 24h` unless `force: true` passed
- Migration in `supabase/migrations/`
- Backfill script (optional — next nightly cron will populate)

Combine with **C** and the pricing pipeline becomes boring.

---

### Jumbo case-cost fields in admin product form
**Status: ✅ Complete (2026-05-07)** — `Jumbo / Case ($)` + `Jumbo AM / Case ($)` inputs added to [app/admin/products/NewProductForm.tsx](../app/admin/products/NewProductForm.tsx). Edit form already had them; the gap was on create + a silently-dropped param on the `updateProduct` action signature, both fixed.

**Original entry below for context.**

**Effort:** ~30 min
**Why:** Break Analysis v2 (Phase 1, shipped 2026-04-29) added `products.jumbo_case_cost` / `jumbo_am_case_cost` columns plus full engine + consumer support for jumbo as a third format. The admin product form was supposed to expose those fields too — listed as a critical file in the plan — but never shipped. Today admins have to set jumbo case costs via SQL, which is why no live product has jumbo populated.

Surfaced 2026-05-02 while creating 2025 Topps Cosmic Chrome Basketball — the create form has Hobby / BD / Hobby AM / BD AM but no Jumbo / Jumbo AM fields.

**Files to touch:**
- `app/admin/products/NewProductForm.tsx` — add Jumbo / Case ($) and Jumbo AM / Case ($) inputs to the Case Costs block, mirroring the BD pattern (both optional)
- `components/admin/ProductForm.tsx` — same two fields on the edit form
- `app/admin/products/actions.ts` — pass `jumbo_case_cost` / `jumbo_am_case_cost` through create/update server actions (verify they're not already being silently dropped)

No schema change — columns already exist. No engine change — already wired. Pure form-field add.

**Verification:** create a product with a jumbo case cost set, confirm it persists, confirm the consumer break page's three-format mix counter shows the Jumbo row instead of hiding it.

---

### Phase 3 — Consumer Auth (Google + Apple OAuth)
**Status: ✅ Google OAuth complete (2026-04-03) — Apple deferred**

Google OAuth is live on production at getbreakiq.com. Invite flow: email → `/auth/signup?code=` → Google OAuth → `/auth/callback` validates invite code, upserts profile, marks waitlist as `converted`. Google consent screen published.

Apple OAuth deferred — requires Apple Developer account ($99/yr).

---

### Remove dead env vars from Vercel Production
**Status: ✅ Complete (2026-04-03)**

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` removed from Vercel Production.

---

### Create staging admin user
**Status: ✅ Complete (2026-04-03)**

---

### Phase 4 — Consumer Buzz Indicators on Break Page
**Status: ✅ Complete (2026-04-09)** — badges were already implemented in components; fixed the data gap by adding `buzz_score`, `breakerz_score`, `is_high_volatility` to the pricing API GET/POST selects.

---

### BreakIQ Bets Decay / Expiry Policy
**Effort:** ~0.5 days
**Why:** `breakerz_score` has no expiry. A B-score set in March will still be affecting slot costs in June unless manually cleared. Either add a `breakerz_score_set_at` timestamp + auto-decay, or add a visible "set X days ago" indicator in the Debrief UI so admins know to refresh stale scores.

**Decision needed:** decay (automatic) or expiry indicator (manual) — recommend the indicator first since it's simpler and keeps humans in the loop.

---

### Pricing Cache — Scheduled Refresh
**Status: ✅ Complete (2026-04-09)** — `app/api/cron/refresh-pricing/route.ts` + `vercel.json` cron at 4 AM UTC daily. Protected with `CRON_SECRET`.

---

### Catalog Refresh cron_run_log instrumentation
**Effort:** ~15 min
**Why:** Surfaced 2026-05-11 during the product audit. The Cron Status panel on `/admin/products` shows "Catalog Refresh: NEVER RUN" — but the catalog refresh is actually firing successfully every night at 03:00 UTC (verified via `ch_set_refresh_log` which has rows from every morning). The issue is `app/api/cron/refresh-ch-catalogs/route.ts` only calls `recordCronRun()` at the END of the serial loop, and at ~5 minutes of real work across 17+ sets the route hits Vercel's `maxDuration=300s` and gets killed before reaching that call. Net effect: catalog refreshes complete + `ch_set_cache` is up-to-date, but admin observability is broken.

**Fix:** Either (a) call `recordCronRun()` after each set inside the loop so partial runs are visible, or (b) call a "started" marker at the top of the route (matching the `refresh-product-pricing/start` pattern that's already working) so the panel knows the run kicked off. Option (b) is simpler.

**Files:** `app/api/cron/refresh-ch-catalogs/route.ts`, `lib/cron-log.ts` (maybe add a `recordCronStart()` helper)

---

### Parser-side team-name normalization
**Effort:** ~1 hour
**Why:** Surfaced 2026-05-11 — three real data bugs in `players.team` created duplicate chips in the consumer team picker (and one text-only fallback when the typo defeated the logo map): `Dallas mavericks` (lowercase 'm'), `Portland Trail blazers` (lowercase 'b'), `San Francsico Giants` (typo). Manually canonicalized via SQL UPDATE, but the upstream cause is the checklist parser writing whatever string the manufacturer XLSX/PDF emits without normalizing against a canonical team-name table. Future imports will keep introducing the same drift.

**Fix:** Build a canonical-team table (or hard-coded TS map) keyed by `(sport, normalized_name)` → canonical display string, and route every parsed team string through it at import time. Fuzz-match (lowercase + diacritic-strip + spelling-distance ≤ 2) so typos resolve to the canonical name. Log un-mappable strings for admin review instead of silently writing them. Reuse the abbreviation map in [lib/team-logos.ts](../lib/team-logos.ts) as the canonical-name source of truth — keep one list, not two.

**Files:** `lib/checklist-parser.ts` (apply normalization), new `lib/team-canonical.ts` (the map + matcher), reused by `lib/team-logos.ts`. Migration to add a `CHECK` constraint or unique-on-`(sport_id, LOWER(team))` to prevent case-dupes at the DB level.

---

### Baseline Fair Value in BreakIQ Sayz
**Effort:** ~0.5 days
**Why:** When `buzz_score` or `breakerz_score` adjusts fair value, buyers currently see the adjusted number with no indication of what the "raw" model says. Showing both (e.g., "Fair value: $42 · Baseline: $38 without signal adjustment") adds transparency and trust.

**Files:** `app/api/analysis/route.ts` (return `baselineFairValue`), `app/analysis/page.tsx`

---

### Per-player graded comp drilldown  ✅ SUPERSEDED 2026-05-20 — shipped in a different shape

The original ask: click a player row → side panel fetches PSA 9 / PSA 10 prices on demand via `getAllPrices` (since the aggregate refresh was Raw-only).

What actually shipped 2026-05-20 ([CHANGELOG entry — player drawer per-grade prices](../CHANGELOG.md)): the existing PlayerDetailDrawer's per-grade columns swapped from N parallel `getAllPrices(cardId)` calls to one batched `card-fmv-batch` covering every (card_id × [Raw, PSA 8, PSA 9, PSA 10]). The drilldown surface is the drawer itself, not a separate side panel. Estimated cells render in italic + 65% opacity with a one-line legend so users can tell direct-sale data from model-fallback estimates.

The standalone drilldown sidebar is no longer needed — the data lives where users were already clicking.

---

### PWA / Mobile Drawer — PlayerDetailDrawer
**Effort:** ~0.5–1 day
**Why:** `PlayerDetailDrawer` is a full-height slide-over designed for desktop web. On mobile browsers the sheet doesn't feel native — tap targets are cramped, dismiss area is small, and there's no swipe-to-close gesture. A bottom-drawer variant gives mobile users a proper sheet pattern without changing the desktop experience.

**Approach:** Use [Vaul](https://vaul.emilkowal.ski/) (shadcn-compatible drawer primitive) to replace the current `Sheet` on small viewports. Detect breakpoint with `useMediaQuery('(max-width: 768px)')` — desktop keeps the slide-over, mobile gets the bottom drawer.

**Files:** `components/breakiq/PlayerDetailDrawer.tsx`

---

### Confidence display — bucket 0..1 into named tiers
**Effort:** ~1–2 hours
**Why:** Surfaced 2026-05-09 comparing our pricing model to Card Ladder ([docs/competitor-intel/cardladder-vs-breakiq-analysis.md](competitor-intel/cardladder-vs-breakiq-analysis.md)). CL displays a 5-bucket confidence rating ("last sold" age tier) next to every suggested price; our model already has a sales-weighted `confidence` from CH's batch-price-estimate (0..1, surfaced as a `low conf` chip below 0.5). The data is in the cache; we just don't bucket it.

A named tier system reads better than a raw number for collectors. Suggested:
- **Strong** — confidence ≥ 0.7
- **Solid** — 0.5–0.7
- **Stale** — 0.2–0.5
- **Cold** — < 0.2

**Files:** `components/breakiq/PlayerTable.tsx`, `components/breakiq/PlayerDetailDrawer.tsx`, `app/(consumer)/player/[id]/page.tsx` (anywhere we render EV).

Cheap, non-blocking. Pure UI.

---

## Priority 2 — High value, external dependency or more effort

### 9. Confidence bands in UI (variance-honesty surface)
**Effort:** ~2-3 days  
**Why:** Per [docs/strategy/north-star-and-feedback-loop.md](strategy/north-star-and-feedback-loop.md) variance-honesty stance + Kyle's "level of gambling" point: every slot price is one sample from a distribution, and publishing point estimates as if they're certain misrepresents the model and the market. Surface ranges, not just numbers.

**Build:**
- Engine extension: compute per-player evLow/evMid/evHigh ranges using variant-level EV variance derived from CH's sales-count distribution and odds-weighted sums (math already partially exists in `pricing-refresh.ts` — we have `ev_low / ev_mid / ev_high`, just need to expose meaningfully)
- UI: every place we render a slot price gets a confidence chip — `$1,447 (likely $1,150-$1,820)` — primary surface on `/break/[slug]`, secondary in BreakIQ Sayz analysis result, tertiary in BulkSentimentUpload preview
- Composes with consumer audit trail UI (#6) — the breakdown shows ranges per contribution too

**Sequencing:** Step 9 in the execution roadmap. Comes after #6 (audit trail) so the bands render alongside the contribution breakdown. Lower-than-P1 because it's variance-honesty refinement on a product that doesn't exist in its strategically-clarified form until #1-7 ship.

---

### Grade Ratio Value — replace hard-coded grade multipliers with per-card historical ratios
**Effort:** ~1–2 days *if CH exposes the data we need* (Q13 in [docs/cardhedger-questions.md](cardhedger-questions.md))
**Blocked on:** confirmation from Kyle that CH has a per-card cross-grade sales endpoint we can query (or willingness to add one).

**Why:** Surfaced 2026-05-09 from the Card Ladder competitive teardown ([docs/competitor-intel/cardladder-vs-breakiq-analysis.md](competitor-intel/cardladder-vs-breakiq-analysis.md)). Today, when CH gives us a Raw price but no PSA 9 / PSA 10 for a card, [lib/pricing-refresh.ts:170-172](../lib/pricing-refresh.ts) falls back to:
```
evHigh = round(evMid × 2.5)   // PSA 10 fallback
evLow  = round(evMid × 0.35)  // Raw fallback when only PSA is available
```
Those multipliers are population averages. They're systematically wrong on the variants that move the most money — chase parallels and superstar rookies have steeper grade curves than commons. CL's "Grade Ratio Value" model uses the *card's own* historical PSA 10 ÷ Raw multiplier (or PSA 10 ÷ PSA 9, whichever has the most recent comp grade) rather than a population mean. Better signal, real dollar accuracy gain on chase variants.

**Approach:**
1. New CH wrapper: `getCardGradeRatios(cardId): { ratio_psa10_raw, ratio_psa10_psa9, ratio_psa9_raw, computed_at }` — derive from whatever CH endpoint (Q13) lets us query pair-wise sales for one card_id.
2. Persist in a new table `ch_card_grade_ratios` (keyed by `cardhedger_card_id`, 7d TTL — ratios change slowly).
3. In `lib/pricing-refresh.ts`, when synthesizing `evHigh` from `psa9_price`, prefer the card's own `ratio_psa10_psa9` over the hard-coded `× 2.5`. Same for `evLow` from `psa10_price`. Population multipliers stay as the very last resort.
4. Track which path produced each EV in `pricing_cache` (new column `ev_high_source: 'real' | 'card_ratio' | 'population_multiplier'`) so we can measure improvement.

**Risk:** if CH has too few historical sales for a card, the ratio is noisy and we want to fall back to the population mean rather than apply a one-data-point ratio. Need a minimum-sample threshold (e.g. 3 paired sales).

**Validation:** run side-by-side on a 100-variant sample comparing card-ratio EV vs. population-multiplier EV vs. (where available) actual recent PSA 10 comp prices. Report MAE per variant tier.

---

### Index-rolled-forward stale card pricing
**Effort:** ~½–1 day
**Blocked on:** Q13 (player-aggregate price-history endpoint shape from CH).

**Why:** Same Card Ladder teardown. When a card hasn't had a CH-pri ced sale recently and our tier ladder falls all the way to the [`$8 / $15` rookie/veteran floor](../lib/pricing-refresh.ts:512), we lose all signal. CL's "Card Ladder Value" rolls a stale card's price forward by tracking the *player's* aggregate market — `today_price = old_price × (today_player_index / past_player_index)`. Better than a flat floor when the player has moved 30%+ since the card's last sale.

**Approach:** insert a new tier between the search rung and the hard-coded floor in [lib/pricing-refresh.ts](../lib/pricing-refresh.ts). If `ch_price_cache` has *some* historical row for this card_id (even if expired) AND CH gives us a usable player-aggregate trend, multiply the stale price by `today / past` aggregate ratio. Floor stays as the very last resort.

**Lower priority than Grade Ratio Value** — it only matters for the small fraction of variants where CH has nothing recent. The existing `ch_price_cache` already absorbs most of the previously-stale variants. But as a defensive layer for the long tail, worth doing once the player-aggregate endpoint is confirmed.

---

### Chase Cards — Panini-aware fallback when no odds data
**Status: ✅ Complete (2026-05-07)** — print-run fallback shipped in [app/api/admin/chase-cards/route.ts](../app/api/admin/chase-cards/route.ts). Each candidate's rarest variant carries a `rankBy: 'odds' | 'print_run'` discriminator; the response surfaces `productHasOdds`. [app/admin/products/[id]/ChaseCardsManager.tsx](../app/admin/products/[id]/ChaseCardsManager.tsx) renders a yellow "Ranked by print run" chip when fallback triggered.

**Original entry below for context.**

**Effort:** ~1 hour
**Why:** Surfaced 2026-05-06 alongside the Panini Prizm Football import. Panini products have no published pull rates, so every `player_product_variants.hobby_odds` is null. The pricing math already handles null correctly (excluded from the equation, never treated as zero — confirmed via audit). But [app/api/admin/chase-cards/route.ts:38-46](app/api/admin/chase-cards/route.ts:38) picks the "rarest variant" by lowest `hobby_odds` and filters out anything where rarest is undefined — so the admin Chase Cards Manager is **empty for every Panini product**, with no signal to the admin about why.

**Fix:** when `hobby_odds` is null on every variant, fall back to lowest `print_run` (or first numbered variant when print runs are also null). Surface a small "no odds available, ranked by print run" indicator in the manager UI.

**Files to touch:**
- `app/api/admin/chase-cards/route.ts` — extend the rarest-variant selector with a print-run fallback when no variant has odds
- `app/admin/products/[id]/ChaseCardsManager.tsx` — render the indicator chip when the fallback path triggered

**Verification:** open the chase cards manager on a freshly-imported Panini Prizm Football product, confirm rarest variants surface ranked by print run with the indicator chip.

---

### Pricing Feedback — Admin Triage Queue
**Effort:** ~1 day

**Why:** The `<PricingFeedback />` component (shipped 2026-05-06) captures row-level thumbs-up / thumbs-down on player rows, team rows, break analysis bundles, and slab analysis results. Each thumbs-down records a category (`pricing_too_high` / `pricing_too_low` / `wrong_player` / `missing_data` / `risk_flag_wrong` / `other`) and optional notes into `pricing_feedback`. Today there's nowhere for an admin to actually see this stream — rows pile up unreviewed.

**Build a `/admin/feedback` panel:**
- Group unreviewed rows by `product_id` then `entity_id`, sorted by count desc (squeaky-wheel surfacing)
- Per-entity drill-down: list of feedback events with rating, category, notes, user_id, created_at, page_url
- Quick actions per row: mark reviewed (writes `reviewed_at` + `reviewed_by`), add `resolution_note`, jump to the relevant `/admin/products/[id]` for fix
- Filter chips: all / unreviewed only / by category / by surface
- Optional cross-link from the Pricing Audit Panel: "3 thumbs-down on Wemby in last 7d"

**Files:**
- `app/admin/feedback/page.tsx` (new)
- `app/admin/feedback/actions.ts` (new) — `markReviewed`, `addResolutionNote` server actions
- Extend `app/admin/products/[id]/PricingAuditPanel.tsx` to surface unreviewed feedback count per player

**Cross-references:**
- Composes with the Discord `/insight` review flow — same admin pattern (capture qualitative signal, attribute to source, manually review). Eventually both could live behind one `/admin/intel` tab.
- Feeds the BreakIQ Bets debrief — clusters of thumbs-down on a player are signal for a manual `breakerz_score` adjustment.

---

### Post-import setup flow — drop "Import another checklist", push admins forward
**Effort:** ~2–3 hours

**Why:** Surfaced 2026-05-11 by Brody after a clean checklist import + match (1,051 player-products, 6,892 variants, 100% auto match). The import-checklist result page's only terminal CTA other than "Go to Product Dashboard" is "Import another checklist" — but no admin sets up a new product by importing two checklists in a row. The real next steps after a fresh import are **(1)** add Chase Cards, **(2)** configure the anchor (per-product anchor configurator shipped in PR #78), **(3)** verify pricing coverage, **(4)** flip lifecycle to live. Today the admin has to navigate back to the product dashboard and remember those steps; the result page should walk them through.

**Sketch:**
- On step 3 (`Result`), replace the "Import another checklist" link with a small forward-flow stepper: **Chase Cards → Anchor Config → Verify Pricing → Flip to Live**. Each step is a card with a one-line description, a CTA button that deep-links into the relevant admin surface, and a checkmark once the underlying state is met (e.g. ≥1 chase card row, `products.pricing_anchor_*` set, ≥80% pricing coverage, `lifecycle_status='live'`).
- "Import another checklist" relegated to a small secondary link at the bottom for the rare case where it's actually wanted.
- Each step's "done?" check is a single SQL/Supabase read — keep it dumb, no cron involvement.

**Relationship to the gated activation wizard below:** that entry is the structural rewrite — state machine, validation gates, demotion on edit. This entry is the tactical "good enough wizard" we can ship today using the existing surfaces. When the gated wizard lands it absorbs this flow; until then, this version closes the biggest UX gap (admins forgetting to configure anchors / chase cards before going live) for a fraction of the effort.

---

### Gated product activation wizard (replace "create + flip to live" with a validation stepper)
**Effort:** ~1 focused session
**Why:** Surfaced 2026-05-11 reflecting on the day's audit work. Every product-data fire today — Bowman Draft Sapphire mis-anchored to `Bowman Chrome Sapphire`, Topps Series 1/2 conflated under one umbrella, Donruss Football with `ch_set_name=null` shipping for two months, 2024 Panini Prizm Football empty shell — followed the same pattern: a product got configured, flipped to `is_active=true`, and went live before anyone verified the resulting roster matched reality. The forensic signals we used to find them (variant count vs. expected, card_number prefix distribution, ch_set_name exact-match against CH catalog, duplicate-ch_set_name detection, productScope filtered-rows count, pricing coverage %) are exactly the checks that should run *before* activation. The bulk-load-and-hope flow is too forgiving of misconfigurations; once a product is live with bad data, the only way to fix it is the destructive cleanup we did today.

**Sketch:** state machine `draft → validating → ready → live`, with each transition gated by automated checks (CH set-name exists, no other product uses the same anchor, parsed sections look like real titles, hydrate ran with productScope, ≥N% of variants priced). New products default to `draft` instead of going straight live. Editing `ch_set_name` on a live product soft-demotes back to `validating` until checks re-pass. Cross-link to today's audit plan ([docs/plans/2026-05-11-product-audit.md](plans/2026-05-11-product-audit.md)) — the audit is the manual version of what this automates.

Worth a focused session — design the state machine + gates + admin UX in one sitting rather than incrementally bolting validators onto the current form.

---

### Rethink consumer product card layout (`/break` index)
**Status: ✅ Phase 1 complete (2026-05-07) — Top Mover chip queued for Phase 5**

Activity counter + hype tag pill + compact density rework shipped via new [components/breakiq/ProductCard.tsx](../components/breakiq/ProductCard.tsx); [app/(consumer)/page.tsx](../app/(consumer)/page.tsx) `getProducts` now fetches break counts + active product-scope hype observations alongside the products list. Inline render in [app/(consumer)/ActiveProductsBrowser.tsx](../app/(consumer)/ActiveProductsBrowser.tsx) replaced; grid bumped to 4-up at xl breakpoint. Top Mover chip queued for Phase 5 C-score — design locked on price-delta format (`↑ Wemby +14%`); reads CH's `top-movers` if it returns deltas directly, otherwise computes deltas from `price-updates` polling over a 7d window.

**Original entry below for context.**

**Effort:** ~1–2 days

**Why:** The current grid is admin-shaped (Case Cost forward). A consumer landing on `/break` doesn't care that the case wholesales for $4,632 — they care whether this product is worth buying *into*: who's trending, how active is the community on it, and is anyone breaking it right now. Cards are also visually heavy — they take a full row's worth of vertical space to communicate two numbers (sport/year + case cost) that don't drive a buy decision.

**Layout rework — replace Case Cost as the headline metric with consumer-shaped signal:**
- **Top Mover chip** — "↑ Wemby +14%" (cross-references top-movers data; reuses the same pipeline planned for Phase 5 C-score and the Top Movers widget below)
- **Activity counter** — "23 breaks logged this week" aggregated from `user_breaks.product_id` over a 7-day window; doubles as a social-proof signal
- **Hype tag pill** — surface when the product has a positive product-scope hype observation in the last N days (already captured via Discord `/insight` parser as `market_observations`)
- **Compact density** — shrink card height ~40% so 6+ products fit above the fold; keep sport/year/manufacturer chips, drop the big case-cost block to a smaller footer line ("$4,632 hobby · $11,500 BD")

**Files (rough):**
- `app/(consumer)/break/page.tsx` — grid query joins `user_breaks` count + top-mover lookup + active hype tags
- `components/breakiq/ProductCard.tsx` (likely new — extract from inline) — compact card layout
- New API helper for "products with consumer signal" if the join gets heavy

**Verification:** load `/break` as a consumer, confirm top-mover chip resolves to a real player from that product, confirm break count matches a SQL spot-check, confirm pre-release / dormant cards still render their lifecycle states correctly.

---

### Breaker Channel Placement on product cards (paid surface)
**Effort:** Phase 1 ~1 day (data model + admin UI); Phase 2 ~1–2 days (consumer surface); Phase 3 monetization is product strategy, not engineering effort

**Why:** If consumers are on the product card to decide whether to buy in, the natural next click is "where can I actually buy a slot in this break right now." Surfacing breaker channel logos with deep links into live breaks turns the product index into a marketplace funnel — and creates an obvious paid-placement surface (sponsored slot per product, similar to the affiliate model in **Vision 3**).

**Phasing:**
1. **Schema + admin** — `breaker_channels` table (name, logo URL, platform, channel URL, contact); `product_channel_placements` join table with `priority`, `is_paid`, `active_from/active_to`. Admin CRUD in `/admin/channels`.
2. **Consumer surface** — small logo strip on the product card ("Live now: [Logo] [Logo] [Logo]"), click opens the channel URL with affiliate tag where available.
3. **Monetization** — Stripe-billed monthly placement subscription per channel. Build after public beta proves traffic.

**Blocker:** Low value pre-public-launch — paid placement requires meaningful consumer traffic on `/break` before it's a sellable surface to channels. Capture intent now, revisit after public beta retention/traffic metrics are real.

**Cross-references:**
- Composes with **Vision 3 — Affiliate Commerce Layer** (channel links can carry affiliate tags)
- Composes with **Vision 5 — My Chase** Phase 3 (live break links) — same data model could power both surfaces
- Top Mover chip on the redesigned card reuses the same pipeline as the Phase 5 C-score Top Movers widget

---

### Breaker Identity + Crowdsourced Case Pricing
**Effort:** ~3–4 days (phased — see PRD)
**PRD:** [`docs/breaker-identity-prd.md`](./breaker-identity-prd.md)

**Why:** The admin AM case pricing field (shipped 2026-04-23) is a static fix — someone has to maintain it. The real opportunity is letting breakers enter what they actually paid per case, then aggregating those inputs into a live market rate that auto-updates the break page defaults for everyone. This doubles BreakIQ's use case (both buyers and breakers), makes the pricing data self-maintaining, and gives breakers a pre-break profitability tool.

**Phases:**
1. Breaker opt-in identity (profile toggle) + persist entered case costs to `breaker_case_costs` table (~1 day)
2. Crowdsourced market rate — median of last 30 days, surface on break page + admin product page, replace AM price as default where ≥ 3 data points (~1 day)
3. Breaker profitability view — slot cost → target price calculator, revenue projection at capacity (~1–1.5 days)

**Blocker:** Low value in private beta with limited breakers. Ship after public launch when there's enough volume for crowdsourcing to be meaningful.

---

### CardHedger Matching — Semi-Automated Knowledge Updates
**Effort:** ~1–2 days
**Why:** The manufacturer knowledge modules (`lib/card-knowledge/`) are currently updated manually — we read the unmatched CSV, spot patterns, update the code, redeploy. Semi-automation closes that loop: after a matching run, the system analyzes its own failures and proposes additions to the knowledge module for human review.

**How it works:**
1. After a matching run completes, the admin can trigger "Analyze failures" from the product dashboard
2. A new API route sends the no-match/review results to Claude with a prompt like: *"Here are N failed card matches. Identify recurring patterns — terms in the query that don't appear in CH results, insert set names being treated as variants, etc. Propose specific additions to the Bowman knowledge module."*
3. Claude returns a structured proposal (new terms to strip, new context lines, new card code patterns)
4. Admin reviews the proposal in the UI — approve individual items or all at once
5. Approved items write to a `pending_knowledge_updates` table; a dev merges them into the appropriate `lib/card-knowledge/*.ts` file on next deploy

**Why not fully automated:** If Claude learns a bad rule, it silently corrupts future match runs across all products. Human review is the right gate.

**Prerequisite:** Manufacturer knowledge system (below) must be live first.

**Files:** New API route `app/api/admin/analyze-match-failures/route.ts`, new UI component on product dashboard, `pending_knowledge_updates` table in Supabase

---

### CardHedger Matching — Manufacturer Knowledge System
**Status: ✅ Complete (2026-03-31)**

`lib/card-knowledge/` is live with `BowmanKnowledge`, `DefaultKnowledge`, and `PaniniKnowledge` stub. Bowman's Best match rate reached ~76% practical ceiling. Full details in `docs/cardhedger-matching.md` and `docs/manufacturer-rules/bowman.md`.

Remaining known limitation: multi-player autos (DA-/TA-/QA-) and code-only duplicate rows (~24% of Bowman's Best) are structural — not solvable without CH exposing a `number` field for autograph sets or a Match Review UI for manual correction.

---

### Phase 5 — C-score: CardHedger Top-Movers + Product Page Widget
**Effort:** 2–3 days
**Status:** Unblocked. Display format locked on price-delta (`↑ Wemby +14%`). Implementation reads CH's `top-movers` first; if the response is rank-only (no per-card delta), fall back to computing deltas ourselves from `price-updates` polling over a 7d window. Both endpoints already on the build list below.

- Add `top-movers` and `price-updates` to `lib/cardhedger.ts`
- **Decision needed first:** store C-score in separate `c_score` column or write composite directly to `buzz_score`? Separate columns are better for auditability and debugging; decide before building.
- Vercel Cron (daily): fetch top-movers → cross-reference `player_product_variants.cardhedger_card_id` → compute C-score → write to DB
- `price-updates` delta poll (every 6h): price swing > threshold → create pending High Volatility review record. Doubles as the source for computed deltas if `top-movers` is rank-only.
- Admin: pending High Volatility review queue
- **Top Mover chip on consumer product cards** (`/break` index): the Phase 1 card redesign reserved space for this. Reads the same C-score data pipeline; renders one chip per card for the top-moving player in that product.
- **Product page Top Movers widget:** on the break page, show a ranked list of players in this product whose cards are trending on the secondary market (e.g. "Trending up: Wemby +18%, Cade +11% · Trending down: KD -8%"). Cross-references `player_product_variants.cardhedger_card_id` against top-movers response — same data pipeline as C-score, surfaced directly to the buyer. This is the consumer-facing output of the C-score computation.

**Files:** `lib/cardhedger.ts`, `app/api/cron/update-scores/route.ts`, `vercel.json`, `app/break/[slug]/` (Top Movers widget)

---

### Match Review UI
**Effort:** ~1 day
**Why:** CardHedger auto-match handles ~90%+ of variants. The remaining ~10% are flagged in the unmatched variants list on the product dashboard, but there's no UI to manually override a match or correct a low-confidence match. Currently requires a CLI script (`node scripts/map-cards.mjs`).

- Add a manual match override UI to the product dashboard or unmatched variants section
- Low priority given high auto-match rate, but worthwhile before onboarding more products

---

### My Breaks Phase 2 — Chase / Hit Card Tracking
**Effort:** ~2–3 days (phased)
**Why:** Chase and hit card tracking was deferred from My Breaks Phase 1. Two follow-on features surfaced from the Chase Cards session:

**1. Community "Report a Hit" form**
Let consumers self-report a chase card hit after a break. Submissions feed a community hit log visible on the break page — raw signal (what pulled in what product, when) that doesn't exist anywhere else in the hobby.
- New `hit_reports` table: `user_id`, `product_id`, `player_id`, `card_description` (free text), `break_platform`, `reported_at`
- Lightweight submit form on the break page ("Got this card? Report it")
- Public feed on the break page: recent hits for this product (latest 10, paginated)
- Admin moderation flag on submissions — not surfaced publicly until reviewed

**2. Automatic pricing recalculation when a chase card is marked hit**
When a hit is reported, the relevant player's slot price should reflect the updated supply signal — high-end pulls reduce scarcity and should drop EV for remaining inventory.
**Blocker:** True real-time recalculation conflicts with the "No real-time data" constraint. Pragmatic path: treat hit reports as an input to the next scheduled pricing refresh (nightly cron picks them up) rather than an immediate trigger. Revisit if buyer demand for same-session repricing is validated.

**Files:** `hit_reports` table + migration, `app/api/hit-reports/route.ts`, `app/break/[slug]/` (submit form + feed component), optional cron integration in `lib/pricing-refresh.ts`

---

### ⚪ OPTIONAL · Full taxonomy expansion (manufacturer / brand / specialty as separate fields)

**Effort:** ~½ day
**Status:** Optional. No near-term trigger. The "taxonomy lite" single-column `product_line` shipped 2026-05-15 (PR #106) already drives parser format-availability and product-form UX. Take this on when consumer browse/filter or cross-product anchoring forces the issue.

**Why this is the natural next step.** [lib/product-lines.ts](../lib/product-lines.ts) already decomposes each `product_line` key into `manufacturer`, `family`, and `is_specialty` flags. The data is there; we just don't have separate database columns. Moving to three columns gives us:
- **Consumer browse** — filter `/` and `/break` by brand (Bowman vs Topps Chrome vs Panini Prizm) without LIKE-querying the name string.
- **Cross-product anchoring** — express pricing rules like "Bowman Best slot fair value tracks ~30% of Bowman flagship slot fair value" in structured pricing math (today this requires reading the line key as a string).
- **Pre-release auto-config** — when a new Topps Heritage drops, templatize the format mix (typically hobby + jumbo) from the brand alone.
- **CH set-name auto-suggestion** — CH naming follows manufacturer/brand/specialty patterns; structured fields could prefill `ch_set_name` better than the current full-name search.

**Shape:**
1. Migration adds `product_manufacturer`, `product_brand`, `product_specialty` columns (all TEXT, nullable). `product_line` stays as a derived/legacy column.
2. Backfill from existing `product_line` via the helper table in `lib/product-lines.ts` — every value already decomposes.
3. Update both product forms ([NewProductForm.tsx](../app/admin/products/NewProductForm.tsx), [components/admin/ProductForm.tsx](../components/admin/ProductForm.tsx)) to use three nested dropdowns (manufacturer → brand → specialty) instead of the single flat one. Preserve the flat option for legacy.
4. Update [parser](../lib/insights-parser.ts) prompt to ship the three fields instead of (or alongside) the single line key — more granular Claude reasoning.
5. Eventually drop `product_line` once nothing reads it.

**Triggers to watch for:** (1) a consumer-facing brand filter is requested; (2) a pricing rule needs to fan out across "all Topps Chrome variants" or "all specialty hobby-only products"; (3) Kyle proposes cross-product anchoring (e.g. Bowman Best ≈ 30% of Bowman flagship slot).

**Why not now:** The current single-column approach unblocks every parser case we've actually hit. Splitting into three columns is structurally cleaner but adds form complexity (nested dropdowns are fussier UX than flat) for no immediate user-visible win.

---

### `/break-price` refine-with-correction flow  ✅ SHIPPED 2026-05-15

**Shipped via:** PR [#108](https://github.com/brodotype-dev/breakerz/pull/108). Third **✏️ Refine** button on every `pending_insights` proposal panel — text-only re-parse for `/insight`, full image + narrative + correction re-parse for `/break-price`. Iterable until the contributor applies or discards. Migration `20260516120000_pending_insights_refine.sql` added `source_attachments JSONB` + `source_kind TEXT` to `pending_insights`. New constants in `lib/discord.ts` (MODAL response type, TEXT_INPUT component, TextInputStyle). New `handleRefineModalSubmit` re-fetches stored Discord CDN URLs within their ~24h window and re-runs the parser with the correction spliced in as additional context. Full per-feature breakdown in [CHANGELOG.md](../CHANGELOG.md) entry dated 2026-05-15.

---

## Priority 3 — Future pipeline, external dependencies required

### Odds matcher — handle insert-subset base rows
**Effort:** ~1–2 hours
**Why:** Surfaced 2026-05-11 during the Topps Series 1 + Series 2 cleanup. The Topps odds PDF includes one row per *parallel* of each insert subset (e.g. "Call to the Hall Pink Foil /99", "Call to the Hall Gold /50"), plus a single row for the **base** of the subset with no parallel suffix (e.g. just "Call to the Hall"). Our odds matcher matches on `(variant_name, card_number)` and successfully links the colored-parallel rows (94% match rate on Series 1: 211 of 224 odds rows). The 13 unmatched on Series 1 were all insert-base rows: `Call to the Hall`, `Heavy Lumber`, `Legendary Homefield Advantage`, `Plakata`, `All Aces`, `Stars of MLB`, `Topps Mega Stars`, plus a handful of autograph-relic subset bases (`Heavy Lumber Autograph Relics`, `City Connect Swatch Collection Autograph Relic`, `Rickwood Autograph Relic Collection`, `Signature Tunes Dual Autographs`, `City Connect Swatch Collection`, `Rickwood Relic Collection`).

The matcher needs a fallback: when an odds row's name matches a section name AND the row has no parallel suffix, apply that row's odds to every card in that section's base variant. Otherwise these insert subsets ship without base-rate odds data, which makes the `1/odds` weighting in the engine treat them as null (excluded from slot math) when their real pull rate is, say, 1:4 packs.

**Impact today:** Low. The high-EV chase parallels of these subsets ARE matched (Pink Foil /99, Gold Foil /50, etc.). The base rate of an insert subset is the lowest-value pull from that subset, so missing it costs little slot-pricing accuracy.

**Files to touch:**
- `app/api/admin/match-odds/route.ts` (or wherever the odds matcher lives — name TBD) — add section-name → base-variant fallback path
- Verification: re-upload Topps Series 1 odds PDF, confirm ≥13 of the previously-unmatched rows now resolve

---

### Background CardHedger matching (close-the-tab-and-walk-away)
**Effort:** ~½ day
**Why:** Today both the import-checklist `handleMatch` and the product-dashboard `RunMatchingButton` drive matching from a client-side loop — the browser fires `POST /api/admin/match-cardhedger` repeatedly with offset paging until `hasMore: false`. Closing the tab kills the loop; matching is resumable on the next click but not autonomous. For Panini Donruss Optic (~14k variants) or 2025 Panini Prizm Football (~35k variants) that's 5-10+ minutes of foreground time per product.

Real fan-out workflow (mirror the pricing-refresh pipeline):

1. New `match_run_log` table (or extend `cron_run_log`) tracks per-run offset, total, started_at, finished_at, status.
2. New `/api/admin/start-match` admin endpoint that initializes a run row and kicks off a `/api/cron/process-match-batch` invocation. Worker processes one chunk and either re-invokes itself for the next chunk (HTTP self-fan-out, like the pricing orchestrator does) or returns and a follow-up cron picks up incomplete runs.
3. Existing `match-cardhedger` route stays the canonical worker — fan-out just wraps it.
4. Client-side: trigger the run, leave a "Match running…" indicator on the product page, walk away. On return, the most recent `match_run_log` row drives the UI state.

**Files to touch:**
- New: `app/api/admin/start-match/route.ts`, `app/api/cron/process-match-batch/route.ts`, migration for `match_run_log`
- `app/admin/products/[id]/RunMatchingButton.tsx` — switch from client loop to "start run + poll status"
- `app/admin/import-checklist/page.tsx` — same shape on the result page

**Verification:** start a match on a 14k+ variant product, close the browser tab, come back 5 minutes later, see completed status + auto-match counts populated.

**Status: ⏸ Low priority** — current resumable client-loop pattern is acceptable for the volume we're at, especially with the new progress UI. Revisit if matching becomes a regular bottleneck or if we start importing 50k+ variant jumbo products often.

---

### Phase 6 — P-score: Reddit Sentiment
**Status: ⏸ Deferred — approval barrier + cost**
**Effort:** 2–3 days (when unblocked)
**Blocker:** Reddit eliminated self-service API access in late 2025. Now requires manual approval (3–7 days for personal, slow/denied for commercial). Commercial tier is $12K/year — not viable at current stage. Revisit if Reddit opens a lower-cost commercial tier or if an alternative hobby sentiment source (e.g. Whatnot, Fanatics Collect) becomes available.
**Notes:** r/sportscards + sport-specific subs; mention volume vs 30-day baseline → normalized P-score. Rate limit evaluation needed — may need to scope to active-product players only. Combines with C-score into `buzz_score` composite. While deferred, the composite rebalances: run Phase 5 C-score only (C × 0.60) until P-score is available.

---

### Phase 7 — S-score: Player Stats API
**Effort:** 3–5 days (per sport, NBA first)
**Blocker:** No external blocker — balldontlie.io is free and requires no approval. Just needs an API key from balldontlie.io.
**API decision:** balldontlie.io (NBA, free). Upgrade path: MySportsFeeds (~$15–25/mo) if injury report reliability or MLB/NFL coverage becomes a priority.
**Notes:**
- Recent performance trend (last 7 days vs season avg) → S-score
- Injury status → auto-drafts Risk Flag pending record → admin review queue (never auto-publishes)
- Prospect window: if `is_rookie` and games < 20, downweight S-score in composite
- **Gap:** No `player_type` or `debut_date` field to distinguish pre-debut draft picks from active rookies. Needs either a new field on `players` or a heuristic from game count.

---

## Known Limitations

Problems we've identified but don't yet have a clear solution for. Not features — more like structural constraints to keep in mind when scoping future work.

### CardHedger — Dual / Triple / Quad Autographs
Multi-player autograph cards (e.g. `"Dylan Crews/James Wood 2025 Bowman's Best DA-WC"`) are unmatched because:
1. The player name field contains a slash-delimited list of players, which no search query handles well
2. CardHedger doesn't appear to index multi-player cards under a combined player name
3. The card code (DA-WC, TA-CEC, QA-ADGS) is unique but CH returns wrong cards for multi-player queries

**Impact:** Low volume (~2-3% of variants in Bowman's Best). High-end cards by value but low count.
**Potential directions:** Search CH by the card code alone (no player name); match the first player name only and accept the result; or treat these as permanently manual-match candidates in the Review UI.
**Not worth solving until** the Match Review UI exists, since manual correction is the fallback anyway.

---

## Security — Post-Launch Hardening

Addressed in the pre-beta security audit (2026-04-10). Criticals and highs are fixed. These remain as defense-in-depth improvements.

### RLS on Core Business Tables
**Effort:** ~0.5 days
**Why:** `products`, `players`, `player_products`, `player_product_variants`, `pricing_cache`, `player_risk_flags`, and `waitlist` have no RLS policies. The app uses `supabaseAdmin` (service role) for all writes, so RLS isn't the primary gate — but if the anon key is used incorrectly, these tables are wide open. `waitlist` is the highest priority since it contains emails and invite codes.
**Approach:** Enable RLS on all tables. Add read-only policies for anon on public-facing tables (products, players, pricing_cache). Admin-only tables get no anon policies — only accessible via service role.

### Rate Limiting
**Effort:** ~0.5 days
**Why:** No rate limiting on any endpoint. The waitlist, analysis (Anthropic API calls), and CardHedger proxy routes are all unlimited. An attacker could burn API quota or spam the waitlist.
**Approach:** `@upstash/ratelimit` with Redis. Priority endpoints: `/api/waitlist` (IP-based, 5/min), `/api/analysis` (user-based, 20/hr), `/api/card-lookup` (user-based, 30/hr), `/api/cardhedger/*` (user-based, 60/hr).

### File Upload Validation
**Effort:** ~0.25 days
**Why:** Admin upload endpoints (`parse-odds`, `parse-checklist`) accept arbitrary files with no MIME type or size validation. `card-lookup` accepts unbounded base64 image payloads. Malformed files could crash parsers or consume excessive memory.
**Approach:** Validate MIME types, add file size limits (10MB for admin uploads, 5MB for card images), reject unexpected extensions.

### Error Message Sanitization
**Effort:** ~0.25 days
**Why:** Many API routes return `err.message` directly in JSON responses. Supabase errors can leak database structure, query details, or stack traces to the client.
**Approach:** Log full errors server-side, return generic messages to clients. Keep specific messages only in development.

---

## Open Questions

These need a decision before the relevant work can be scoped or started.

| # | Question | Blocks |
|---|---|---|
| 1 | **Score decay:** Should `buzz_score` auto-decay between pipeline runs (-20%/day), or persist until overwritten? Daily pipeline may make this moot. | Phase 5 design |
| 2 | **Component columns:** Store `c_score`, `s_score`, `p_score` separately for auditability, or just write composite to `buzz_score`? Separate = better debugging, more schema. | Phase 5 |
| 3 | **BreakIQ Bets expiry:** Decay automatically or show "set N days ago" indicator + manual refresh? | Decay/expiry item above |
| 4 | **Icon process:** Who can designate icon status? Criteria? Recommend: both Brody + Kyle must agree, reviewed once per product cycle. | Ongoing |
| 5 | **Risk flag style guide:** Notes are consumer-facing. Define: past tense, factual, no speculation, source + date. E.g., *"Suspended 80 games for PED violation (MLB, March 2026)."* | Admin UX |
| 6 | **Controversy vs. cold:** Player has a negative Risk Flag but positive buzz (dark curiosity buying). Show both? Let Claude decide in narrative? Likely: show both. | Phase 3 follow-up |

---

## Long-term Vision (Kyle's Ideas — 2026-03-25)

These are not near-term roadmap items. Capturing them here so the thinking isn't lost.

---

### Vision 1 — Enhanced Pricing Engine (CardPulse Integration)

Expand the engine beyond card EV by layering in real-world demand signals that haven't moved the secondary market yet:

- **Real-time player statistics** — live game performance feeding into demand signal (extends the S-score concept from Phase 7, but real-time rather than daily)
- **Player rankings across platforms** — cross-reference how a player ranks on alt-market platforms, fantasy services, and hobby sites; consensus ranking as a demand proxy
- **Live sports betting odds** — if a player is heavily backed to win MVP, win a championship, or hit a performance threshold, that translates directly into card demand. Sportsbook APIs (DraftKings, FanDuel, etc.) are accessible.
- **Prediction markets** — Polymarket, Kalshi, and similar platforms allow trading on outcomes like "Will Player X win Rookie of the Year?" These are early-signal, liquid, and increasingly accessible via API. A Polymarket position moving sharply before the market reacts is exactly the kind of leading indicator we want.

**Technical note:** Betting odds and prediction market prices are available via free/low-cost APIs. The harder problem is normalization — converting a betting line into a directional card demand signal requires modeling. This is a research task before it's a build task.

**What this enables:** The engine moves from "what are cards worth right now" to "what are cards about to be worth" — a genuinely differentiated product in the hobby space.

---

### Vision 2 — Deal Monitor / Card Arbitrage Tool

A daily (or near-real-time) scanner that surfaces underpriced cards and hot auctions across the major platforms.

**Two modes:**

**Hot Auctions** — active auction monitoring across Alt, Golden, Fanatics Collect. Surface auctions where the current bid is materially below CardHedger's estimated value with low time remaining. Gives collectors and resellers a live edge.

**BUY IT NOW Steals** — scan BUY IT NOW listings on eBay, Alt, Fanatics Collect, MySlabs, COMC for cards listed below a target discount threshold. User flow:
1. User sets a target ROI (e.g., "show me cards where BIN price is ≥ 20% below market value")
2. System queries listings, checks against CardHedger API for current market value
3. Returns ranked list of matching cards sorted by ROI

**What needs to exist:**
- Platform APIs or scraping for eBay (has a Marketplace API), Alt, Fanatics, COMC, MySlabs — availability and rate limits vary per platform
- CardHedger as the value oracle (already integrated)
- A matching layer to link listing card identifiers to CardHedger `card_id`s — this is the hard part, same fuzzy matching problem as the checklist import but at scale

**What this enables:** Turns Breakerz into a tool resellers and flippers actively use daily, not just during break season. High engagement driver.

---

### Vision 3 — Affiliate Commerce Layer

If we're surfacing links to Alt, Golden, Fanatics Collect, eBay, and others throughout the app (deal monitor, auction links, break page context), there's a natural affiliate revenue opportunity.

- **Alt** — has an affiliate/referral program
- **eBay Partner Network** — well-established affiliate program, easy to implement
- **Fanatics Collect** — worth checking; Fanatics has affiliate infrastructure
- **COMC, MySlabs** — TBD

**Implementation:** Append affiliate tracking parameters to outbound links. Low effort once the deal monitor surfaces links — the link is already there, it just needs the affiliate tag.

**Revenue model:** Commission per sale or per click depending on the platform program. Not a primary revenue stream, but a natural byproduct of features we'd build anyway.

**Note:** Affiliate links need disclosure — standard footer/tooltip language is sufficient.

---

### Vision 5 — My Chase

A personalized player watchlist. Users save/favorite players they're actively chasing and get a persistent view of everything relevant to those players in one place.

**Core experience:**
- Save players to a personal chase list (star/heart on any player row across the app)
- "My Chase" dashboard: one card per player showing current market value (PSA 9/10 price from CardHedger), live buzz indicators (B-score, C-score, risk flags), and recent comp movement
- Products they appear in: which breaks are available to buy into for that player, with slot EV pulled live from the pricing engine
- Eventually: direct links to live breaks on Fanatics Collect, Whatnot, eBay — shows you exactly where you can buy a slot containing that player right now

**What it enables:**
- Moves BreakIQ from "tool you open once to analyze a break" to "dashboard you check daily"
- Natural hook for push notifications: "A break containing Wander Franco just went live on Whatnot — your max slot cost is $47"
- Affiliate revenue layer: links to Fanatics/Whatnot/eBay are natural affiliate opportunities (see Vision 3)
- Strong retention driver — personalization creates habit

**Data already exists:** players, pricing_cache, buzz scores, risk flags, and CardHedger card_ids are all in the DB. The personalization layer (saved players per user) is the new piece — likely a simple `user_chase_list` table (user_id, player_id, added_at).

**Phase 1 scope (MVP):** save players, show current market value + buzz indicators per player.
**Phase 2:** products they appear in + slot EV.
**Phase 3:** live break links (Fanatics/Whatnot/eBay API integrations or curated links).

---

### Vision 4 — Hobby Education Hub

A content layer for collectors who are new to the hobby or learning to evaluate breaks more carefully.

**Content areas:**
- **Beginner's guide to group breaks** — what a group break is, hobby vs. BD vs. random team, how slot pricing works
- **Card evaluation guides** — how to read a checklist, what makes a card valuable, the difference between base/refractor/auto
- **Grading guides** — when to grade, who to grade with (PSA vs. BGS vs. SGC), cost/benefit for different price points
- **Card prep guides** — how to handle, store, and submit cards without damaging them
- **What to watch out for** — trimmed cards, fake autos, relabeled holders, altered serial numbers

**Technical approach:** Static MDX pages are the simplest path — no CMS required, version-controlled, easy to update. Could also be a Notion-backed content layer if the team prefers editing in Notion.

**What this enables:**
- SEO surface area — "how to grade cards," "what is a group break," etc. are high-intent hobby searches
- Reduces buyer friction on BreakIQ Sayz — a new collector who doesn't understand EV can click through to learn before buying
- Trust signal — demonstrates expertise, not just a calculator

---

## Decided / Out of Scope

- No public social leaderboard or trending feed
- No real-time data — daily/6h refresh is the ceiling
- Icon tier is a model correction flag, not a promotional feature
- Reddit API > X/Twitter for hobby signal (hobby-specific, free, better S/N ratio)
- Google Trends: rejected — too broad for player-level card signal
