# BreakIQ — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

## Product Strategy — read first

BreakIQ exists to be the **differentiated voice at the moment of decision** — credible because of our data infrastructure, valuable because the live-break market herds and we don't. Breakers price slots by copying each other; the market is systematically mispriced in both directions (one breaker prices DBacks at $625 when fair value is closer to $1,900; another prices Red Sox at $6,000 when fair value is $2,600). Our job is to catch both directions in real time, before users claim the slot.

**Core value prop:** *"Stop overpaying breakers."* Live breakers price slots by copying each other. The market gets it wrong by hundreds or thousands of dollars per slot. BreakIQ catches both — overcharges and steals — in real time, before you claim the slot. Backed by a multi-source pricing model (CH sales data + objective prospect rankings + Discord-attributed SME observations) that no breaker, calculator, or platform can replicate.

**North star metric:** *Recovery rate per user* — `pull_value / ask_price ≥ 0.5` for X% of breaks over a rolling window. Pull data isn't captured yet (My Breaks Phase 2 unblocks this). **Operational metric in the interim:** EV calibration error + **market delta** (our predicted slot price vs. observed breaker asks — available today from `user_breaks.ask_price` + `snapshot_fair_value`).

**Strategic moat:** Track A (objective player attributes — MLB Pipeline rank, NPB signee status, graduated_rc, etc.) + Track B (subjective multi-scope sentiment via Discord `/insight`) + CH sales data, combined into a transparent, auditable pricing model with full source attribution. The moat is the combination — competitors can copy CH; they can't replicate the SME network or the cascade architecture.

Full strategy:
- [docs/strategy/north-star-and-feedback-loop.md](./docs/strategy/north-star-and-feedback-loop.md) — how we measure success, why the data feedback loop matters, candidate metrics in priority order
- [docs/strategy/product-strategy-map.md](./docs/strategy/product-strategy-map.md) — Reforge 6-dimension framework filled out for BreakIQ (audience, problem, value prop, differentiation, channel, monetization)
- [docs/strategy/execution-roadmap.md](./docs/strategy/execution-roadmap.md) — **the 10-step execution sequence** ordered by strategic clarity per engineering day; gap analysis mapping each strategic claim to required product change; order-of-operations principles ("build the moat after you've surfaced it"); session-continuity reading order for cold-start contributors

**Session continuity:** if picking up this strategic thread cold, read in this order — CLAUDE.md (this section, 1 min) → `north-star-and-feedback-loop.md` (5 min) → `product-strategy-map.md` (3 min) → `execution-roadmap.md` (5 min) → BACKLOG P0+P1 (3 min). ~17 minutes to full strategic context.

**Docs (read on demand, not automatically):**
- [CHANGELOG.md](./CHANGELOG.md) — full feature history
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritized work queue
- [docs/pricing-architecture.md](./docs/pricing-architecture.md) — pricing pipeline (cache-read consumer + cron fan-out writer)
- [docs/cardhedger-matching.md](./docs/cardhedger-matching.md) — CH matching architecture (v1 legacy notes)
- [docs/catalog-preload-architecture.md](./docs/catalog-preload-architecture.md) — CH matching v2 (catalog pre-load + tiered local matcher)
- [docs/cardhedger-questions.md](./docs/cardhedger-questions.md) — running list of questions for the CH team
- [docs/beta-launch-checklist.md](./docs/beta-launch-checklist.md) — pre-launch todo list
- [docs/cost-analysis.md](./docs/cost-analysis.md) — unit economics, breakeven, service costs
- [docs/manufacturer-rules/bowman.md](./docs/manufacturer-rules/bowman.md) — Bowman/Topps prefix names, CH naming conventions, match rate history
- [docs/manufacturer-rules/panini.md](./docs/manufacturer-rules/panini.md) — Panini Master Checklist XLSX format, section model, known gaps (no RC flag, no odds)
- [docs/breaker-identity-prd.md](./docs/breaker-identity-prd.md) — Breaker role + crowdsourced case pricing PRD (backlogged, post-public-beta)
- [docs/product-lifecycle.md](./docs/product-lifecycle.md) — pre_release / live / dormant lifecycle: schema, crons, transitions, consumer rendering
- [docs/plans/2026-04-29-break-analysis-v2.md](./docs/plans/2026-04-29-break-analysis-v2.md) — Break Analysis v2 plan (multi-format, multi-team, insight capture roadmap; Phase 2 rewritten 2026-04-29 as Discord-driven)
- [docs/plans/2026-04-30-pre-release-polish.md](./docs/plans/2026-04-30-pre-release-polish.md) — Pre-release product page polish (countdown hero, sort/filter/group, PSA 9, hype + asking-price chips)
- [docs/score-modulation.md](./docs/score-modulation.md) — risk_flag + hype_tag → effectiveScore math, scope mapping, tuning constants
- [docs/pwa.md](./docs/pwa.md) — PWA architecture: manifest, service worker, cache strategy, install matrix, logout cache wipe
- [docs/my-chase.md](./docs/my-chase.md) — My Chase / Players Hub: schema, API, ChaseHeartButton + provider, /chase list, future phases
- [docs/plans/2026-05-05-my-chase-phase1.md](./docs/plans/2026-05-05-my-chase-phase1.md) — Phase 1 plan (save/unsave + dashboard)
- [docs/plans/2026-05-06-cardhedger-data-audit.md](./docs/plans/2026-05-06-cardhedger-data-audit.md) — CH endpoint inventory + prioritized punch list (P0.2/P0.3 shipped, P0.1 deferred)
- [docs/competitor-intel/cardladder-vs-breakiq-analysis.md](./docs/competitor-intel/cardladder-vs-breakiq-analysis.md) — Card Ladder pricing methodology vs. ours; verdict on what to adopt (Grade Ratio Value worth investigating; player-index infrastructure not). Source PDFs in same folder.
- [docs/plans/2026-05-10-topps-series-split.md](./docs/plans/2026-05-10-topps-series-split.md) — P0 plan for Topps Baseball Series 1/2 split. Root cause: `hydrateVariantsFromCatalog`'s missing predicate for Phase 3 auto-created pps (500 of 1,249 pps leaked 12K+ variants from Series 2). Fix (shipped 2026-05-10): derived `productScope` = union of `checklist_card_numbers` across scoped pps, used as fallback predicate for unscoped pps. Zero new schema. Operational re-hydrate of Series 1 still pending.
- [docs/plans/2026-05-10-streaming-pricing-refresh.md](./docs/plans/2026-05-10-streaming-pricing-refresh.md) — Rearchitect pricing refresh as streaming variant cron + cheap aggregation cron. Hard deadline: ship before active product count crosses 25
- [docs/plans/2026-05-11-per-product-anchor-configurator.md](./docs/plans/2026-05-11-per-product-anchor-configurator.md) — Plan A (shipped 2026-05-11): per-product `anchor_strategy` + `anchor_variant_patterns`, dispatcher in `lib/pricing-anchors.ts`, conversational configurator at `/admin/products/[id]/anchor-config`
- [docs/plans/2026-05-11-slot-price-market-markup.md](./docs/plans/2026-05-11-slot-price-market-markup.md) — Plan B (planned): dual-number display (`fairValue` + `marketFairValue`) so slot prices reflect breaker markup over pure EV. Lifecycle-aware constants in `lib/market-markup.ts`
- [docs/plans/2026-05-11-release-freshness-decay.md](./docs/plans/2026-05-11-release-freshness-decay.md) — Plan C (planned): math-layer release premium + exponential freshness decay for first-2-weeks-live pricing. Stamps `products.live_since` on `pre_release → live`
- [docs/plans/2026-05-11-product-audit.md](./docs/plans/2026-05-11-product-audit.md) — Full audit of 21 active products (2026-05-11). Caught 3 duplicate `ch_set_name` cases (Topps Series 1+2, Finest, Midnight), 3 broken/empty products (Donruss Football, 2024 Panini Prizm, Bowman Draft Sapphire). Cleanup landed; Series 1+2 re-imported with productScope predicate filtering ~58K out-of-scope rows
- [docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md](./docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md) — Two-track player-attribute layer plan (approved 2026-05-12, not yet implemented). **Track A:** objective `players.prospect_rank` / `prospect_status` columns + CSV importer (MLB Pipeline rank, NPB signee, graduated_rc, etc.). **Track B:** multi-scope sentiment via Discord `/insight` extended with `team_sentiment` / `product_sentiment` / `team_product_sentiment` scopes, PLUS a Claude skill for SMEs that captures voice/chat narration → structured Markdown → bulk-import-with-attribution path. Per-sport multiplier table. New `lib/cascading-sentiment.ts` reads observations across scopes with per-scope caps. Per-sport sources: MLB Pipeline, ESPN Big Board, NFL consensus draft boards, NHL Central Scouting
- [docs/icebox.md](./docs/icebox.md) — Long-running tracking doc for deferred ideas: per-sale time-weighted pricing, per-product chase rule library, asking-price → fair-value calibration, build-vs-buy CH revisited
- [docs/edge-cases.md](./docs/edge-cases.md) — Running log of known-but-deferred edge cases with decision + revisit trigger. Multi-team / multi-format `/break-price` bundles, price-range handling, etc.
- [lib/insights-parser.ts](./lib/insights-parser.ts) — Discord `/insight` Claude parser rules (the prompt). Edit this when you want to add/change extraction rules — sentiment scoring guidance, new hype-tag categories, new risk flags, anti-substitution rules, etc.

Update CHANGELOG.md at the end of every session with what changed and why.

**Multi-phase features get four touch-points** (so we can grep them later instead of digging through git history):
1. **Plan file** in `docs/plans/YYYY-MM-DD-feature.md` — saved at the end of plan mode. Add a status header at the top noting actual shipped scope vs. the original plan.
2. **Architecture doc** in `docs/feature-name.md` — the live reference for how it works.
3. **CHANGELOG entry** linking to both.
4. **CLAUDE.md** — add to docs index + add a one-line summary to the Current State section.

Single-commit fixes / small features only need the CHANGELOG entry.

---

## Current State

Live at [getbreakiq.com](https://getbreakiq.com). Private beta — consumer routes require auth; unauthenticated visitors redirected to `/waitlist`.

**Admin pipeline** ✅ Product creation → checklist import (Topps PDF/CSV, Bowman XLSX) → CardHedger matching (Claude Haiku, ~76–90% auto-match) → odds import → readiness dashboard → BreakIQ Bets debrief

**Auth + Waitlist** ✅ Supabase Auth (email+password for admins, Google/Discord/email OAuth for consumers). Public waitlist → admin approval → Resend invite email → `/auth/signup?code=` → OAuth or email signup → `/auth/callback` validates invite, creates profile, marks converted. Test invite code: `beta-test-2026`.

**Social Currency** ✅ B-score (breakerz_score), Icon tier (is_icon), Risk Flags (player_risk_flags), HV (is_high_volatility), consumer badges (★ ↑↓ ⚡ ⚑)

**Slab Analysis** ✅ Upload cert image or enter cert # directly → Claude parses → PSA API verifies (grade + pop data) → CardHedger prices + comps → max bid calculator

**My Breaks** ✅ Consumer break tracking: log pre-break (with live analysis snapshot) or post-break. Rate outcome (Win/Mediocre/Bust), select platform, analysis feedback (helpful/not helpful). Stats row + time/platform/outcome filters. CSV export + import. Chase/hit card tracking designed, deferred to Phase 2.

**Pricing Pipeline** ✅ Consumer `/api/pricing` is a pure cache read — no external calls, no 504s. Writes happen in two places, both hitting `/api/admin/refresh-product-pricing` (300s budget per invocation): (1) admin on-demand via "Refresh Pricing" button on product page; (2) overnight cron, 5 staggered firings between 4–6:30 AM UTC. Each firing picks the stalest products (latest `pricing_cache.fetched_at` null or > 22h old, oldest first), throttles to 3 concurrent CH-fetching workers, and exits within 270s. Workers it can't finish get picked up by the next firing. Concurrency=3 because 16-way parallel CH starved bandwidth and blew worker timeouts on 2026-04-27. Middleware lets `Authorization: Bearer ${CRON_SECRET}` requests through `/api/admin/*` — without that bypass the orchestrator's fan-out POSTs get 307'd to `/admin/login`. Cron orchestrator must fan out to `NEXT_PUBLIC_APP_URL` (the production alias `https://www.getbreakiq.com`), NOT `req.url`. Vercel cron invokes us at the `*.vercel.app` deployment URL, which is behind Vercel Deployment Protection (SSO) — fan-out POSTs to that host hit a 401 SSO challenge before reaching the app and fail 16/16 silently. The orchestrator returns 200 (with `processed=N ok=0 err=N` in the payload), so the failure looks like success to the dashboard. Detection: query `pricing_cache` for writes in the cron window. If cache is empty, consumer page shows a passive "pricing not yet available" banner. See `docs/pricing-architecture.md`. Requires Vercel Pro.

**Onboarding** ✅ 3-step wizard at `/onboarding`: age gate (hard block under 18), about you (experience level, collecting interests including TCGs, eras, platform, monthly spend), quick hits (attribution, best pull). OAuth callback redirects new users to onboarding; returning users skip it.

**Subscriptions** ✅ Stripe integration — Hobby ($9.99/mo, 10 analyses), Pro ($24.99/mo, unlimited). 3 free lifetime analyses as trial. Usage gates on `/api/analysis`, `/api/card-lookup`, `/api/my-breaks`. Promo codes enabled. Webhook handles checkout, invoice, subscription lifecycle.

**Security** ✅ Pre-beta audit (2026-04-10): auth guards on all admin server actions + API routes, consumer API auth, security headers (X-Frame-Options, CSP, etc.), XSS fix in email, open redirect fix, legacy auth backdoor deleted.

**Analytics** ✅ PostHog installed — server-side user identification + `user_signed_up` event in auth callback.

**CH Matching v2** ✅ (2026-04-21) Catalog pre-load into `ch_set_cache` + tiered local matcher. Descriptor-based knowledge (`lib/card-knowledge/` — data, not classes). Tier ladder: exact-variant → synonym → number-only → card-code → claude(in-set candidates) → no-match. Daily cron refreshes catalogs for active products at 3 AM UTC. On-demand "Refresh CH Catalog" button on product page. `match_tier` persisted on variants for debugging. `ch_set_name` on products stores exact CH canonical name — use "Find on CH" widget in product form. See `docs/catalog-preload-architecture.md`.

**Security** ✅ RLS enabled on all 11 tables. Auth guards on all admin actions and API routes. Security headers. See security section in BACKLOG for remaining items (rate limiting, file validation).

**After-Market Case Pricing** ✅ (2026-04-23) Admin can set `hobby_am_case_cost` / `bd_am_case_cost` separate from MSRP. Consumer break page defaults to AM price when available. `DashboardConfig` shows MSRP · Market reference row. Phase 2 (Breaker identity + crowdsourced pricing) backlogged — see `docs/breaker-identity-prd.md`.

**Product Lifecycle** ✅ (2026-04-27) Three-state lifecycle (`pre_release` / `live` / `dormant`) on products, orthogonal to `is_active`. Drives admin UX, cron behavior, and consumer rendering. Pre-release products skip all daily crons and render a hype layout (countdown + chase cards + 90-day player historical comps); live products run the full pipeline; dormant products skip daily crons but get a biweekly pricing refresh (1st + 15th, `/api/cron/refresh-dormant-pricing`). Admin transitions via confirm-dialog buttons; `pre_release → live` blocks unless `ch_set_name` is set. See `docs/product-lifecycle.md`.

**Break Analysis v2** ✅ (2026-04-29) Multi-format breaks (hobby + BD + jumbo mix), multi-team selection (chip picker), standalone player slots (searchable picker), single bundle ask price. Engine adds a third pool (jumbo) parallel to hobby. `runBreakAnalysis` takes `{ teams: string[], extraPlayerProductIds, formats: { hobby, bd, jumbo }, askPrice }` and returns one bundle fair value + signal. `POST /api/analysis` rejects the legacy single-team payload with 400. `/break/[slug]` keeps a "View Format" toggle for slot tables but configures cases via three counters in the format-mix box. Schema: `products.jumbo_case_cost` / `jumbo_am_case_cost`, `player_product_variants.jumbo_sets` / `jumbo_odds`. Phase 2/3 (asking-price observation capture, hype tags, dedicated mobile capture surface) deferred — see plan.

**1/1 Filter** ✅ (2026-04-29) `lib/pricing-refresh.ts` and `lib/analysis.ts` exclude variants with `print_run <= 1` from per-player aggregated EV. Eliminates the Austin Reaves bug where a single $2,200 SuperFractor sale pulled his slot to $4,400. Variant-level EV for 1/1s is preserved (still rendered in the player drawer); they just no longer skew the sets-weighted slot math.

**My Breaks v2** ✅ (2026-04-29) Multi-team / multi-player / mixed-format break logging. `user_breaks` schema gets `teams text[]`, `extra_player_product_ids uuid[]`, `formats jsonb`; old single-value columns kept nullable. Form mirrors `/analysis` (TeamChip multi-select, searchable player picker, three-format counters). CSV export/import use `Teams` (semicolon-sep) + per-format case columns.

**Multi-player checklist rows** ✅ (2026-04-29) Combined-name rows (`Skubal / Blanco / Valdez` — League Leaders, dual autos) auto-flag `insert_only=true` at import time and get excluded from team filters. Per Kyle: every individual player has exactly one team; concatenated rows are subset cards, not real entities. 101 legacy rows flipped via backfill.

**Cron Status panel** ✅ (2026-04-29) `cron_run_log` table records every orchestrator invocation. `<CronStatusPanel>` on `/admin/products` shows last-success age + last-attempt result with healthy/stale/failed/never-run badges. Stale threshold 26h daily / 17d biweekly. Caught the silent SSO-fan-out failure that had been killing the pricing cron for 2+ days — fan-out now resolves to `NEXT_PUBLIC_APP_URL` with forced www-prefix and `redirect: 'manual'`, plus a shared AbortController fires at 240s to keep the orchestrator inside Vercel's 300s kill.

**Discord insight capture** ✅ (2026-04-29) Allowlisted contributors run `/insight <narrative>` in `#breakiq-insights`; Claude parses into four update kinds (sentiment, asking_price, hype_tag, risk_flag); bot replies with proposed updates + ✅/❌ buttons. Apply path writes to `player_products.breakerz_score`, `breakerz_sentiment_history`, `market_observations`, `player_risk_flags` — all with full source attribution back to `pending_insights` for longitudinal analysis. Runs entirely on Vercel via Discord HTTP Interactions (no gateway connection). See `lib/insights-parser.ts` for parser rules + prompt and `app/api/discord/interactions/route.ts` for the dispatcher.

**Score Modulation** ✅ (2026-04-30) `risk_flag` rows + `hype_tag` market_observations now fold into `effectiveScore` alongside `buzz_score + breakerz_score`. Constants in `lib/score-modulation.ts`: per-flag-type risk adjustments (retirement -0.80, suspension -0.50, legal -0.40, injury -0.30, off_field -0.25, trade -0.15; most-negative wins, no stacking). Hype: `direction × strength × HYPE_MAX(0.30) × decayFactor` (linear decay over `decay_days`); multiple hype tags stack. Wired into `/break/[slug]` and `runBreakAnalysis`; pool-wide flags fetch reused for the bundle response. No DB migration, no admin UI, no `pricing_cache` change — engine math runs at render time. Asking-price stays display-only. See `docs/score-modulation.md`.

**Insight capture granularity** ✅ (2026-04-30) Discord `/insight` parser learned three new dimensions. (1) Sentiment scope `'global' | 'product'` — "Wemby in Topps Chrome 2024 is wild" only bumps that one product, not all his SKUs. (2) Variant scope on hype + asking_price — captures Product → Player → Variant intel like "Ohtani's orange ref is going wild" while his base is saturated. variant_name stored as free text in payload; variant_id resolution deferred to engine-reads slice. (3) Asking-price `source` enum (`ebay_listing | stream_ask | social_post | other`) — eBay listing is the unsold-listing leading indicator CH can't see during release week. Plus new `odds_observation` parser kind for "this hit pulls 1:80 cases on hobby" — stored in `market_observations` via one-line CHECK extension. Engine doesn't read variant scope or odds observations yet — accumulating as field intel until the variant-aware engine slice lands. See plan Phase 3b.

**My Chase / Players Hub** ✅ (2026-05-05) Phase 1 — personal player watchlist. `user_chase_list` table (composite PK on `user_id`+`player_id`, RLS owner-only). `<ChaseHeartButton>` drops in next to any player name (PlayerTable, PreReleaseLayout PlayerRow, PlayerDetailDrawer); `<ChaseSetProvider>` hydrates the visible set with one fetch instead of per-row API calls. `/chase` page shows saved players with the most-recent `evMid` across all of their `player_products`, B-score + risk-flag chips, and a link to the break that produced the pricing. API: `GET/POST /api/chase`, `DELETE /api/chase/[playerId]`. Phase 2 (cross-product slot EV view) and Phase 3 (live break links + push) deferred per BACKLOG Vision 5. See `docs/my-chase.md`.

**PWA (consumer)** ✅ (2026-05-05) Consumer surface installable on iOS / Android / desktop. `app/manifest.ts` (display: standalone, theme `#0a0e1a`, icons in `public/icons/` generated from `public/brand/icon-gradient.svg` via `scripts/generate-pwa-icons.mjs`). Service worker via `@serwist/next` — `app/sw.ts` compiled to `public/sw.js`, disabled in dev. Runtime caching bypasses `/admin/*`, `/api/*`, `/auth/*` (NetworkOnly so live pricing + auth never serve stale); NetworkFirst for consumer HTML/RSC with `/offline` fallback; standard cache rules for fonts/images/`_next/static`. `app/(consumer)/SignOutButton.tsx` posts `BREAKIQ_LOGOUT` to the SW before logout — deletes every Cache Storage bucket so shared devices don't leak the previous user's RSC payloads. Install prompt chip in `app/(consumer)/InstallPrompt.tsx` — `beforeinstallprompt` capture for Android/Chrome, manual hint for iOS Safari. Admin stays a desktop-only web app, never cached. Mobile-layout audit deferred. See `docs/pwa.md`.

**Pricing feedback (consumer)** ✅ (2026-05-06) Inline 👍 / 👎 on player rows, team rows, break-analysis result, and slab-analysis result. 👍 fires `pricing_feedback_submitted` silently. 👎 opens an inline popover (category select: pricing too high / too low / wrong player / missing data / risk flag wrong / other + optional notes) — submit writes to `pricing_feedback` table and fires the same PostHog event. Component is `<PricingFeedback surface entityType entityId productId />` in `components/breakiq/`. API at `POST /api/feedback/pricing`. Migration: `20260506160000_pricing_feedback.sql`. Admin triage queue intentionally deferred — see BACKLOG.

**PostHog hardening** ✅ (2026-05-06) Centralized event taxonomy in `lib/posthog-events.ts` (PH_EVENTS + PH_PERSON_PROPS); `captureServer()` + `identifyServer()` helpers in `lib/posthog-server.ts` with awaited flushes (Vercel was dropping events on cold-exit); `<PostHogIdentify />` in consumer layout ties browser SDK identity to the user (was anonymous for the whole session); `posthog.reset()` on sign out; subscription person-property sync from Stripe webhook. Removed duplicate `checkout_initiated` event.

**Pre-release page polish** ✅ (2026-04-30) `components/breakiq/PreReleaseLayout.tsx` rewritten for hype-rich consumer surface. Countdown hero (D · HH · MM, ticks to HH:MM:SS on launch day, "Live now" pulse if past `release_date` and admin hasn't flipped to live), sub-hero ribbon (launch date + case costs + asking-price chip), product-scope hype banner above chase cards, Watching widget (top 3 by raw_avg_90d), sort/filter/group-by-team controls on the roster, PSA 9 column split out from PSA 10 (`pre_release_player_snapshots.psa9_avg_90d` / `psa9_sales_90d` added via `20260430210000_pre_release_psa9.sql`), risk-flag pills enlarged with pulse on injury/suspension, hype chips on player rows. Display-only — engine reads stay deferred (Phase 3c). `app/(consumer)/break/[slug]/page.tsx` adds parallel `asking_price` query gated on `lifecycle_status='pre_release'` so live/dormant pages skip the second fetch. See `docs/plans/2026-04-30-pre-release-polish.md` and `docs/product-lifecycle.md`.

**Panini parser** ✅ (2026-05-06) Panini Prizm/Donruss/Optic XLSX files use a fully-denormalized `Master Checklist` sheet (header `CARD SET / CARD NUMBER / ATHLETE / TEAM / SEQUENCE`) as the canonical record of every (parallel × athlete) row. The Topps/Bowman parser only saw the metadata sheets and missed ~90% of parallels (24 of 316 for 2025 Prizm Football). New `parsePaniniXlsx` in [lib/checklist-parser.ts](lib/checklist-parser.ts) auto-detects via Master Checklist header and routes there directly. Each unique CARD SET becomes one section; each row becomes one card with no `parallels` array — the importer's fallback creates one variant per card with `variant_name = sectionName`, which matches CH's catalog naming directly so the exact-variant tier should land most rows. SEQUENCE → `printRun`. Player names cleaned of trailing comma + trademark symbols. Known gaps documented in [docs/manufacturer-rules/panini.md](docs/manufacturer-rules/panini.md): no rookie flag (Master Checklist doesn't carry RC), no odds (Panini doesn't publish — engine already null-safe). Sanity-check script at `scripts/verify-panini-parser.mjs`.

**CH data audit** ✅ (2026-05-06) Mapped every CH endpoint we call vs. what their MCP exposes. All three P0 fixes shipped. **P0.3:** `get90DayPrices` was assuming a `{ prices: [...] }` shape that CH actually returns as `{ cards: [...] }`. The mismatch made every caller throw `result.prices.find(...)` inside a try/catch — the search-priced fallback rung in `lib/pricing-refresh.ts` and the live non-hydrated path in `lib/analysis.ts` were silent no-ops, and refreshes fell through to the default $8/$15-rookie rung more often than the dashboard suggested. Wrapper rewritten to return a sales-weighted aggregate `{ avg_price, min_price, max_price, sale_count } | null`; both callers updated. **P0.2:** `batch-price-estimate` returns a per-card `confidence` (0..1) on every response — was being dropped at the cache upsert. Migration `20260506180000_pricing_cache_confidence.sql` adds nullable `pricing_cache.confidence`; `lib/pricing-refresh.ts` writes a sales-weighted average across each player's priced variants (fallback rungs write `null`); `app/api/pricing/route.ts` projects the column into `PlayerWithPricing.confidence`; `components/breakiq/PlayerTable.tsx` shows a `low conf` chip next to EV Mid when confidence < 0.5. Threshold is a starting cut. **P0.1:** primary engine was Raw-only, synthesizing PSA 9 (`evMid`) and PSA 10 (`evHigh`) from `Raw × 0.35 / × 2.5` multipliers. Each batch chunk now fires three parallel `batchPriceEstimate` calls (Raw / PSA 9 / PSA 10) and assembles ev directly from real per-grade prices; multipliers are last-resort fallbacks. Concurrency 6 → 12, `BATCH_DEADLINE_MS` 270s → 280s, `HARD_DEADLINE_MS` 290s → 295s to absorb the 3× CH call count; peak in-flight is now 36 concurrent CH requests, with retry-with-backoff absorbing rate-limit hits and the cron's stale-first selection picking up partial completions. Confidence is averaged across the grades that returned real prices. Full P1/P2/P3 punch list (free-signal capture, total-sales-by-player adoption, search-cards-sorted, etc.) lives in `docs/plans/2026-05-06-cardhedger-data-audit.md`.

**Consumer product card redesign (Phase 1)** ✅ (2026-05-07) `/break` index cards rewritten consumer-shaped. New [components/breakiq/ProductCard.tsx](components/breakiq/ProductCard.tsx) drops the big Case Cost block to a single mono footer line, tightens density ~40%, and surfaces two inline chips: activity ("N this week" from `user_breaks` last-7d non-abandoned, grouped by `product_id`) + hype ("Release Premium" / "Underhyped" — most-recent active product-scope `market_observations` with a positive `payload.tag`; negative tags suppressed). `getProducts` in [app/(consumer)/page.tsx](app/(consumer)/page.tsx) does three parallel queries instead of one. Top Mover chip queued — design locked on price-delta format (`↑ Wemby +14%`). Implementation reads CH's `top-movers` if it returns deltas directly, otherwise computes the delta from `price-updates` polling over a 7d window. Same pipeline will feed Phase 5 C-score Top Movers widget on `/break/[slug]`.

**Per-CH-card price cache (timeout-safe refresh)** ✅ (2026-05-09) Production regression repair after the 2026-05-06 multi-grade audit pushed big-product wall time over the 240s orchestrator deadline. Symptom: 19 of 20 active products stale 66–92h, same 3 big products (Donruss Optic, Pristine, Topps Finest) timed out every cron firing for 2+ days. Root cause: per-CH-card prices accumulated in memory and per-pp `cacheRows` only upserted to `pricing_cache` at the END of the function — every timeout = 0 rows written. Fix is two coordinated changes: (1) new [ch_price_cache](supabase/migrations/20260509220000_ch_price_cache.sql) table keyed by `cardhedger_card_id` (not per-variant — same CH card backs multiple variants), 24h TTL, written DURING each batch chunk via `runChunk` so partial progress always persists; (2) incremental `pricing_cache` flush every ~100 PPs in the per-pp phase via `maybeFlush()` (sync slice + cursor advance prevents double-flush across concurrent workers). On entry, `lib/pricing-refresh.ts` reads fresh `ch_price_cache` rows and pre-populates `pricesOnly` directly — only stale/never-fetched card_ids get chunked into CH calls. Donruss Optic recovers within 2–3 cron firings: each firing persists ~100 cards/chunk before timing out, next firing skips those. EV math (`evMid = psa9 ?? raw`, `evLow = raw ?? evMid * 0.35`, `evHigh = psa10 ?? evMid * 2.5`) identical across cache-hit and live-fetch paths. `RefreshSummary` extended with `variantsFromCache` + `variantsNewlyFetched`.

**Per-product anchor configurator (Plan A pricing trilogy)** ✅ (2026-05-11) Triggered by the 2026-05-11 Kyle call where he flagged Bowman draft sapphire slot prices were systematically low ($121 Bobby Witt Jr. vs. his $350–400 gut). Diagnosed three tangled issues: CH catalog gap on `2025 Bowman Draft Sapphire` (P0.1, deferred), naive sets-weighted EV including thin-comp 1/1s + SuperFractors (this slice), and missing breaker markup over pure EV (Plan B, planned). New `products.anchor_strategy` (`sets_weighted_all | curated_variants | curated_with_tail`) + `anchor_variant_patterns text[]` + `anchor_config_notes text` columns drive a dispatcher in [lib/pricing-anchors.ts](lib/pricing-anchors.ts) called from [lib/pricing-refresh.ts](lib/pricing-refresh.ts). `curated_with_tail` adds a fixed `CURATED_TAIL_BONUS = 0.15` representing long-tail option value. Fallback rule: zero-match curated → `sets_weighted_all` with `fellBack: true` (never zero out a slot on misconfiguration). `RefreshSummary` exposes `anchorStrategy`, `anchorFellBackCount`, `anchorMatchedVariantsAvg`. Configuration UX is a conversational Claude chat at `/admin/products/[id]/anchor-config` — admin describes anchors in plain English, Claude proposes regex patterns drawn from manufacturer-specific `anchorConcepts` (new `ManufacturerDescriptor` field, populated for Bowman + Panini), preview panel shows current vs proposed EV for top 5 players using cached variant prices (no CH calls). Save = publish; next pricing refresh applies. Defaults preserve current behavior on every existing product — zero big-bang risk. Sibling plans for Plan B (market markup display) and Plan C (release/freshness decay) live in `docs/plans/2026-05-11-*.md`; the icebox in [docs/icebox.md](docs/icebox.md) tracks per-sale time-weighted pricing, per-product chase rule library, asking-price → fair-value calibration, build-vs-buy CH revisited.

**Pricing trilogy Plans B + C (display markup + lifecycle EV multiplier)** ✅ (2026-05-11) Completes the 2026-05-11 trilogy. Plan B: new [lib/market-markup.ts](lib/market-markup.ts) holds `MARKET_MARKUP_BY_LIFECYCLE = { pre_release: 1.40, live: 1.20, dormant: 1.05 }`; `runBreakAnalysis` returns both pure `fairValue` and `marketFairValue` and runs `computeSignal` against the market-adjusted number; `<PlayerTable>` + `<TeamSlotsTable>` accept a `marketMarkup` prop (default 1.0) and render market-adjusted slot cost as the primary number with a small grey "model $X" sub-line. Plan C: math-layer release + freshness decay (`RELEASE_PREMIUM = 1.15`, `FRESHNESS_PREMIUM = 0.20`, halflife 10d, settled past 30d) applied in [lib/pricing-refresh.ts](lib/pricing-refresh.ts) at all 7 cache-row push sites via an `applyMultiplier(lo, mid, hi)` helper. Migration `20260512170000_products_live_since.sql` adds `products.live_since` (backfilled to `created_at` for live products — already past 30d floor so no behavior change, applied via Supabase MCP); `setProductLifecycle` stamps `live_since = now()` only on `pre_release → live` transitions. The two layers compound legitimately: math = "what this card is worth in this lifecycle window" (in `pricing_cache`), display = "what the breaker charges on top of that" (at render). `RefreshSummary` exposes `lifecycleStatus` + `lifecycleMultiplier`; terminal log shows `lifecycle=live mult=1.200`.

**Inline Break Analysis block on product pages** ✅ (2026-05-11) `/break/[slug]`'s "Format Mix" card replaced with the full deal-checker flow — format mix → team chip multi-select → searchable player picker → ask price → Run → inline AI verdict + market ask range + top players + risk flags. Same `/api/analysis` endpoint as `/analysis`, same `runBreakAnalysis()`. Result UI extracted into shared [components/breakiq/AnalysisResultPanel.tsx](components/breakiq/AnalysisResultPanel.tsx) (new `productSlug` prop hides the self-link when rendered on the break page; both surfaces render verdicts identically). Format counters reuse existing `config` state — single source of truth across the analysis block AND the slot tables below. PostHog `break_analysis_run` event includes `surface: 'break_page_inline'` for per-surface conversion segmentation. Gated on `!isDormant`. `/analysis` stays as the standalone cross-product deal checker.

**Observability quick wins** ✅ (2026-05-11) Two single-commit follow-ups bundled with the trilogy ship. (1) Catalog cron `recordCronStart()` marker — `app/api/cron/refresh-ch-catalogs/route.ts` was hitting `maxDuration=300s` before the final `recordCronRun` summary, leaving the admin Cron Status panel showing "Catalog Refresh: NEVER RUN" even though `ch_set_cache` writes were completing nightly. New helper inserts a `success=true` marker row at route entry so the panel sees the run regardless of timeout. (2) Confidence tier chips — `pricing_cache.confidence` (populated since 2026-05-06 P0.2) was rendered as a binary "low conf" chip below 0.5. Replaced with named tiers per Card Ladder's pattern: Strong ≥ 0.7 / Solid 0.5–0.7 / Stale 0.2–0.5 / Cold < 0.2. New `confidenceTier()` helper in [lib/engine.ts](lib/engine.ts) so PlayerDetailDrawer + future surfaces share the same mapping.

**Market Delta Watch (admin)** ✅ (2026-05-12) Roadmap step #1. New admin surface at `/admin/market-delta` ([app/admin/market-delta/page.tsx](app/admin/market-delta/page.tsx), nav entry in [AdminNav.tsx](app/admin/AdminNav.tsx)). Computes `(ask_price − snapshot_fair_value) / snapshot_fair_value` across every non-abandoned `user_breaks` row with both numbers logged — no new schema, data has been accumulating since 2026-04-09. Renders four layers: thesis verdict from P90 absolute delta (Sample too thin / Herd is tight / Material spread / Wide spread), headline stats (mean + median, overcharge % > +20, steal % < −20), 7-bucket distribution histogram (Steal+ → Overcharge+), per-product breakdown + recent-50 observation list. Pure read, server component, no CH calls. Answers the foundational question "is BreakIQ saying something different from the herd at scale?" before further roadmap investment.

**Consumer audit trail — "Why this price?"** ✅ (2026-05-12) Roadmap step #6. New [components/breakiq/WhyThisPriceCard.tsx](components/breakiq/WhyThisPriceCard.tsx) renders inside [PlayerDetailDrawer](components/breakiq/PlayerDetailDrawer.tsx) above the variants table when an `audit` prop is provided. Decomposes the slot price into five visible layers: baseline EV (CH aggregate raw → PSA 9 → PSA 10), math-layer lifecycle multiplier (`RELEASE_PREMIUM` for pre-release / `freshnessMultiplier()` decay for first-30d-live), score modulation rows shown only when non-zero (Track A prospect rank with source string, SME sentiment with `breakerz_note`, AI buzz, dominant risk flag, hype tag, Track B cascade sentiment combined — each colored by sign, with running `effectiveScore` below), pool allocation (weight share + model slot cost), display-layer market markup with the final number. Confidence/estimated/icon/HV chips below. Pure render — pulls all numbers from the `PlayerWithPricing` row already in memory, no new fetches. Threaded from `/break/[slug]` via new `audit` prop; drawer keeps working without it so non-break surfaces (chase list, future) can render variants alone. **Gate for activating Track A: must ship before flipping prospect-rank bumps on in the pricing engine.**

**`/break-price` Discord capture path** ✅ (2026-05-13) Roadmap step #2. Replaces the original "admin paste UI" sketch with a Discord-first design — SMEs already watch streams in Discord-adjacent contexts (or on mobile), and zero-context-switch capture beats a separate web form. New `/break-price` slash command with three options: `narrative` (string, optional), `screenshot` (attachment, optional), `notes` (string, optional). At least one of narrative/screenshot required. Parser is new `parseBreakPrice()` in [lib/insights-parser.ts](lib/insights-parser.ts) — single-purpose, emits only `asking_price` ParsedUpdate rows, supports Claude vision via image content blocks (Haiku 4.5, $0.002/image). Roster-aware: validates every emitted row against active products + player names, drops anything unknown. Dispatcher is new `handleBreakPrice()` in [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) — resolves attachment from `data.resolved.attachments[attachmentId]`, fetches Discord CDN URL, base64-encodes, calls parser, stages to `pending_insights` with the same ✅/❌ flow as `/insight`. Apply path doesn't fork — existing `asking_price` write logic handles the rows. Edge cases (multi-team bundles, multi-format bundles) explicitly dropped at parse time per [docs/edge-cases.md](docs/edge-cases.md) — Claude returns empty array for those, dispatcher surfaces a "couldn't extract" reply with drop reasons. Market Delta Watch ([app/admin/market-delta/page.tsx](app/admin/market-delta/page.tsx)) gets a new "/break-price captures" panel listing the most recent 50 `market_observations.asking_price` rows; delta vs. current pricing is a follow-up (needs per-team fair-value lookup from `pricing_cache`). Operational: re-run [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) post-deploy to push the new command to Discord; existing `discord_contributors` allowlist gates access. Polish follow-up (2026-05-13): added optional `product` autocomplete option to `/break-price` so SMEs pick the product from Discord's native autocomplete instead of having to name it in the narrative — removes the most common reason for empty parses.

**Beta launch messaging PR3 — nav restructure + empty-state CTAs + onboarding microcopy + jargon tooltips** ✅ (2026-05-13) Final PR of three; finishes the messaging trilogy. (1) [ConsumerNav](app/(consumer)/ConsumerNav.tsx) restructured to read the workflow — Breaks/Research/Slabs (discover) → primary blue **+ Log a Break** CTA → Chase/My Breaks/Profile (manage). Labels collapse to icons on `md`, full on `lg`. Mobile keeps a duplicated **+ Log** pill outside the hamburger. (2) [My Breaks](app/(consumer)/my-breaks/page.tsx) reads `?view=new` / `?view=log` deep-links so the primary CTA lands directly on the form. (3) Empty states gain CTAs — My Breaks: "Research a break" → `/analysis` + "Log a previous break"; `/chase`: "Browse breaks" → `/`. (4) [Onboarding](app/(consumer)/onboarding/page.tsx): new `<Why>` helper drops one-line "why we ask" microcopy under What-you-collect / Platform / Spend / Best-pull labels; step-1 gets a workflow preview above the age gate; step-3 CTA renamed "Let's Go" → "Show me my dashboard". (5) New [components/breakiq/ds/InfoTip.tsx](components/breakiq/ds/InfoTip.tsx) — small "?" hover/focus tooltip — dropped next to first-mention labels: Format mix on `/analysis`, `/break/[slug]`, `/my-breaks`; EV Low/Mid/High + Max Pay on PlayerTable headers; Latest EV Mid on `/chase`.

**Beta launch messaging PR2 — feedback-loop framing + home footer real stats** ✅ (2026-05-13) PR2 of three. Turns silent contribution into a visible loop ("You teach. We tune."). (1) [PricingFeedback](components/breakiq/PricingFeedback.tsx): popover helper *"We retrain pricing weekly from breaker reports."* + success replaces "✓ Thanks" with *"Logged for the next pricing pass."* (2) [ChaseHeartButton](components/breakiq/ChaseHeartButton.tsx): first-save hint *"Saved — find them on My Chase ↗"* persisted via `localStorage.breakiq_chase_first_save_seen`, auto-hides 4.5s. (3) [My Breaks](app/(consumer)/my-breaks/page.tsx): "How did it go?" + "Was our take helpful?" labels get one-line "why" helpers; post-save shows a 1.2s confirmation naming the change before the card collapses. (4) Home footer ([app/(consumer)/page.tsx](app/(consumer)/page.tsx)): replaced vague *AI / 24/7* with real numbers — `liveCount` products live, breaks logged in last 7d (`user_breaks` non-abandoned), community insights applied this month (`pending_insights` where `status='applied'` since UTC month start). Two cheap parallel count queries. No new schema. Out of scope for PR2 (queued for PR3): ConsumerNav restructure, empty-state CTAs, onboarding microcopy, jargon tooltips.

**Beta launch messaging PR1 — positioning spine + verdict reframe + beta banner** ✅ (2026-05-13) PR1 of three from `~/.claude/plans/2026-05-13-beta-launch-messaging-refresh.md`. (1) Naming sweep: "BreakIQ Bets" / "BreakIQ Sayz" → **"BreakIQ Insights"** consumer-facing; admin "BreakIQ Bets debrief" → "BreakIQ Insights Debrief". Discord `/insight` command name untouched. (2) Positioning spine — two-line stack everywhere the product introduces itself: hook *"Stop buying breaks blind."* + descriptor *"Every break you buy, in one place — research it, log it, learn from it."* Applied to manifest, layout metadata (+ first-time OpenGraph + Twitter cards), waitlist H1+sub, home hero, subscribe sub, signup card sub. (3) Verdict reframe in [components/breakiq/AnalysisResultPanel.tsx](components/breakiq/AnalysisResultPanel.tsx) — "Our take" label above the BUY/WATCH/PASS badge + one-line attribution sub. Color treatment intact. CTAs softened "Analyze Bundle" → "Run the check" / "Reading the comps…". (4) New [components/breakiq/BetaBanner.tsx](components/breakiq/BetaBanner.tsx) — dismissible via `localStorage.breakiq_beta_banner_dismissed`, PostHog `beta_banner_dismissed` event with `surface` property; rendered on home, `/break/[slug]`, `/analysis`. Out of scope for PR1 (queued for PR2 / PR3): feedback-loop microcopy, home footer real stats, nav restructure, empty-state CTAs, onboarding helpers, jargon tooltips. No DB migrations, no API contract changes.

**Next up:** Step #3 of the execution roadmap — side-by-side comparison UI on `/break/[slug]`. With `/break-price` observations now flowing, the comparison surface has a real source. The per-team fair-value query that powers comparison also unblocks computing deltas on the captures panel inside Market Delta Watch. Then defensive layer (set-name validator widget + gated activation state machine per `~/.claude/plans/2026-05-11-data-accuracy-roadmap.md`), streaming pricing refresh before product count crosses 25, and Grade Ratio Value when Kyle confirms CH Q13. Phase 3c — variant-aware engine reads (resolve variant_name → variant_id, apply variant hype as EV multiplier, override `*_odds` from active odds_observations) + display slice (asking-price chips + hype-tag chips on `/break/[slug]`) + asking-price feedback into fair-value weighting. Phase 5 C-score (blocked on Kyle), My Breaks Phase 2 (chase/hit card tracking), Sentry error tracking, rate limiting, 2025-26 Bowman Basketball re-match (CPA cards being added by CH this week)

---

## Stack

Next.js 15 App Router · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres + Auth) · Stripe · CardHedger API · PSA API · Claude Haiku · Resend · PostHog · Vercel

---

## Deploy

```bash
cd ~/Documents/GitHub/breakerz
git push origin main
vercel --prod --yes
```

Production: `breakerz.vercel.app` | Staging branch: `staging` | Repo: `github.com/brodotype-dev/breakerz`

---

## Environments

| | Production | Preview/Development |
|---|---|---|
| Supabase | `zucuzhtiitibsvryenpi` | `isqxqsznbozlipjvttha` (staging) |
| URL | `breakerz.vercel.app` | staging preview URLs |

**Env vars** (set in Vercel, use `.env.local` for local dev):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CARDHEDGER_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `PSA_API_KEY`, `CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_PRO`, `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`

Supabase Vercel integration injects both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` — `lib/supabase.ts` uses `??` fallbacks for both. Don't remove them.

---

## Known Gotchas

1. **PDF parsing** — use `pdf2json` not `pdf-parse` (canvas crash on Vercel). Lazy `require()` inside handler + `export const dynamic = 'force-dynamic'`. See `app/api/admin/parse-odds/route.ts`.
2. **Resend lazy init** — `new Resend(key)` must be inside a function, not module-level, or builds fail when `RESEND_API_KEY` is absent.
3. **hobbyEVPerBox not cached** — pricing_cache stores ev_low/mid/high but not odds-weighted EV. Cached GET falls back to evMid. Schema change needed to fix (in backlog).
4. **Supabase migrations** — CLI linked to production. To push: `supabase db push`. To repair a failed migration: `supabase migration repair --status reverted <timestamp>`. Files in `supabase/migrations/`.
5. **Stripe webhook** — raw body required for signature verification. Route uses `request.text()` + `export const dynamic = 'force-dynamic'`. Webhook endpoint: `/api/webhooks/stripe`.
6. **Stripe SDK types** — v22+ uses `2026-03-25.dahlia` API version. Webhook event data objects cast to local interfaces to avoid SDK type drift.
7. **Dev mode auth bypass** — consumer API routes (`my-breaks`, `onboarding`) fall back to first profile in dev mode when no auth session. Never deploy with `NODE_ENV=development`.
8. **Supabase email rate limit** — free tier limits ~4 confirmation emails/hour. Hits during testing but not an issue in production.

---

## Key Files

```
middleware.ts                    — auth guard: /admin/*, /api/admin/*, /break/*, /analysis/*
lib/supabase.ts                  — admin client (service role)
lib/supabase-server.ts           — cookie-aware server client (@supabase/ssr)
lib/auth.ts                      — getCurrentUser(), requireRole()
lib/email.ts                     — sendInviteEmail() via Resend
lib/engine.ts                    — pricing engine: computeSlotPricing, computeEffectiveScore
lib/cardhedger.ts                — CardHedger API + Claude matching (claudeCardMatchFromCandidates for v2)
lib/cardhedger-catalog.ts        — catalog lifecycle: findCanonicalSet, refreshSetCatalog, loadCatalogIndex
lib/psa.ts                       — PSA public API: getCertByNumber() (bearer token auth)
lib/card-knowledge/              — descriptor-based manufacturer knowledge (bowman, panini, default, match, types)
lib/card-knowledge/match.ts      — generic tier-ladder matcher (exact-variant → synonym → number-only → card-code)
lib/checklist-parser.ts          — PDF/CSV/XLSX checklist parsers
app/waitlist/                    — public signup
app/auth/signup/                 — consumer OAuth entry (invite code validation)
app/auth/callback/route.ts       — OAuth callback: exchange code, validate invite, create profile
app/admin/login/                 — admin auth
app/admin/waitlist/              — approve users, send invites
app/admin/products/[id]/         — product dashboard (matching, odds, BreakIQ Bets, Pricing Audit)
app/(consumer)/                  — auth-gated consumer route group (layout, nav, actions)
app/(consumer)/profile/          — beta user profile page (name, DOB/age, hobby prefs)
app/(consumer)/card-lookup/      — Slab Analysis tool (auth-gated)
app/break/[slug]/                — consumer break analysis (auth required)
app/analysis/                    — BreakIQ Sayz deal checker (auth required)
app/api/admin/pricing-breakdown/ — per-player pricing inputs for Pricing Audit Panel
app/api/pricing/                 — consumer pricing read (GET/POST, pure cache read, no CH calls)
lib/pricing-refresh.ts           — shared refresh pipeline: CH batch-fetch, aggregate EV, upsert pricing_cache (throws on error)
app/api/admin/refresh-product-pricing/ — per-product worker (maxDuration=300); called by admin button AND cron fan-out
app/admin/products/[id]/RefreshPricingButton.tsx — admin on-demand "Refresh Pricing" button (Quick Actions)
app/api/cron/refresh-pricing/    — nightly cron (4 AM UTC); fans out one HTTP call per active product in parallel, each on its own Vercel invocation
app/api/cron/refresh-ch-catalogs/— daily cron (3 AM UTC) to refresh ch_set_cache for active products
app/api/admin/refresh-ch-catalog/— admin on-demand catalog refresh for a single product
app/admin/products/[id]/RefreshCatalogButton.tsx — UI button for on-demand catalog refresh
app/api/my-breaks/               — GET (list), POST (create with analysis snapshot)
app/api/my-breaks/[id]/          — PUT (complete or abandon a pending break)
app/(consumer)/my-breaks/        — consumer break tracking page (list, new break, log previous)
lib/analysis.ts                  — shared runBreakAnalysis() used by BreakIQ Sayz + My Breaks
lib/stripe.ts                    — Stripe client, checkout sessions, customer portal
lib/usage.ts                     — checkAndIncrementUsage() with plan-aware limits
app/api/checkout/                — POST (Stripe checkout session), GET (customer portal)
app/api/webhooks/stripe/         — Stripe webhook handler (checkout, invoice, subscription events)
app/api/onboarding/              — PUT (save onboarding fields, set onboarding_completed_at)
app/(consumer)/onboarding/       — 3-step onboarding wizard (age, preferences, attribution)
app/(consumer)/subscribe/        — plan selection page (Hobby/Pro + free trial)
app/api/profile/                 — GET + PUT consumer profile (RLS-scoped)
scripts/copy-prod-to-staging.mjs — copy product data from prod to staging Supabase
lib/posthog-events.ts            — PH_EVENTS + PH_PERSON_PROPS constants (single source of truth for event names)
lib/posthog-server.ts            — server SDK singleton + captureServer() / identifyServer() with awaited flush
app/(consumer)/PostHogIdentify.tsx — ties browser posthog-js identity to the auth user
components/breakiq/PricingFeedback.tsx — inline 👍/👎 + popover; reusable across player/team/analysis surfaces
components/breakiq/WhyThisPriceCard.tsx — consumer "Why this price?" decomposition (CH baseline + lifecycle multiplier + score modulation + pool allocation + market markup); renders inside PlayerDetailDrawer when audit prop is set
components/breakiq/BetaBanner.tsx — dismissible private-beta banner with localStorage persistence + PostHog beta_banner_dismissed event; rendered on home / break page / analysis
components/breakiq/ds/InfoTip.tsx — small "?" hover/focus tooltip helper used for first-mention glossing of trader vocabulary (Format mix, EV Mid, Max Pay)
app/admin/market-delta/page.tsx — admin Market Delta Watch dashboard; thesis verdict + distribution + per-product breakdown over user_breaks (ask vs. snapshot_fair_value)
app/api/feedback/pricing/route.ts — POST endpoint that writes pricing_feedback rows + fires pricing_feedback_submitted event
```

---

## Database Schema

```
sports, products, players, player_products, player_product_variants
pricing_cache         — 24h TTL, ev_low/mid/high per player_product
player_risk_flags     — soft-delete (cleared_at); injury/suspension/legal/trade/retirement
user_breaks           — consumer break log: analysis snapshot, platform, outcome, feedback, status lifecycle
products              — ch_set_name TEXT: exact CardHedger canonical set name for set-catalog matching
products              — hobby_am_case_cost / bd_am_case_cost NUMERIC: admin-set after-market case price (nullable; break page prefers over MSRP when set)
ch_set_cache          — pre-loaded CH set catalogs, keyed by (ch_set_name, card_id); drives v2 local matching
ch_set_refresh_log    — per-refresh telemetry (pages, cards, duration, errors)
player_product_variants.match_tier — which tier matched (exact-variant | synonym | number-only | card-code | claude | no-match)
profiles              — mirrors auth.users + onboarding fields + subscription (stripe_customer_id, subscription_plan, analyses_used)
user_roles            — (user_id, role): admin | contributor
waitlist              — status: pending → approved → converted | rejected
pricing_feedback      — consumer 👍/👎 + category + notes per (surface, entity_type, entity_id); RLS owner-only select; admin triage via service role
```

---

## Pricing Model

```
effectiveScore = clamp(buzz_score + breakerz_score, -0.9, 1.0)  [0 if is_icon]
hobbyWeight    = hobbyEVPerBox × (1 + effectiveScore)
slotCost       = breakCost × (hobbyWeight / Σ hobbyWeights)
hobbyEVPerBox  = Σ(variantEV × 1/hobby_odds)  [falls back to evMid if no odds]
```

---

## MCP Servers

- **Supabase** — `.mcp.json` at repo root, project ref `zucuzhtiitibsvryenpi`. Query tables directly.
- **Figma** — `~/.claude/mcp.json` global. Share a Figma URL to read design specs.
