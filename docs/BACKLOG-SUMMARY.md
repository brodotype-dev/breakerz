# BreakIQ — Backlog at a Glance

Snapshot of every active entry in [docs/BACKLOG.md](./BACKLOG.md). Shipped / superseded items collapsed at the bottom.

Generated 2026-05-22.

---

## 🔴 Priority 0 — Live-product blockers

- **Topps Baseball Series 1 / Series 2 split — operational re-hydrate of Series 1**
  Code fix shipped; needs the operational step of re-hydrating Series 1 to filter out Series 2 leakage. Plan: [docs/plans/2026-05-10-topps-series-split.md](plans/2026-05-10-topps-series-split.md).

---

## 🟡 Priority 1 — High value, no external blockers

- **#3 Side-by-side comparison UI on `/break/[slug]`** ⏭ NEXT UP
  Slot-level ask vs. our predicted fair value visible at the moment of decision. Strategic point of BreakIQ now visible to consumers.

- **#4 Pull-Data Capture in My Breaks — Stage 2 measurement unblocker**
  North-star metric (recovery rate per user — `pull_value / ask_price ≥ 0.5`) requires capturing what cards users actually pulled. Today My Breaks logs outcome bucket but not card values.

- **#7 In-Stream Delivery — meeting users at the moment of decision**
  Pre-break web posture misses the moment. Users decide while watching a live stream with ~8s to claim a slot, not 30min before sitting at a laptop.

- **Streaming pricing refresh (scaling unblock)**
  Per-product cron workers regularly hit the 300s Vercel kill. Plan: [docs/plans/2026-05-10-streaming-pricing-refresh.md](plans/2026-05-10-streaming-pricing-refresh.md). Hard deadline: before active-product count crosses 25.

- **BreakIQ Bets Decay / Expiry Policy**
  `breakerz_score` has no expiry. A B-score set in March is still affecting slot costs in June. Add timestamp + auto-decay or visible "set N days ago" badge.

- **Catalog Refresh cron_run_log instrumentation**
  Cron Status panel showed "Catalog Refresh: NEVER RUN" even though it was firing nightly. Partial fix shipped; full instrumentation pending.

- **Parser-side team-name normalization**
  Three real bugs in `players.team` create duplicate chips in consumer team picker (e.g. `Dallas mavericks` lowercase 'm'). Normalize at parse time.

- **Baseline Fair Value in BreakIQ Sayz**
  Today users see the adjusted number with no indication of the "raw" model output. Surface both so signal contribution is legible.

- **PWA / Mobile Drawer — PlayerDetailDrawer**
  Desktop slide-over doesn't feel native on mobile. Cramped tap targets, no swipe-to-close. Needs bottom-sheet treatment for narrow viewports.

- **Confidence display — bucket 0..1 into named tiers**
  Card Ladder shows a 5-bucket confidence rating; we have raw `confidence` 0..1 in cache. Partial shipped (Strong / Solid / Stale / Cold tiers); chip needs to render in every surface (currently drawer only).

- ~~**CardHedger data-health dashboard**~~ ✅ Shipped 2026-05-26 (PRs #138 + #139).
  `/admin/data-health` route with per-product coverage rows + per-row "Probe CH" live button. See Recently Shipped below.

---

## 🟢 Priority 2 — High value, external dependency or more effort

- **#9 Confidence bands in UI (variance-honesty surface)**
  Every slot price is one sample from a distribution. Render ranges (`$1,447 likely $1,150–$1,820`) instead of point estimates.

- **Grade Ratio Value — per-card historical grade ratios**
  Replace hard-coded grade multipliers (raw → PSA 9/10) with per-card historical ratios. **Blocked on Kyle confirming CH endpoint Q13.**

- **Index-rolled-forward stale card pricing**
  When a card hasn't sold in N days, project price forward via player-aggregate index. **Blocked on Q13.**

- **Pricing Feedback — Admin Triage Queue**
  Consumer 👍/👎 feedback rows pile up in `pricing_feedback` with no admin surface to review them. Needs a triage queue.

- **Post-import setup flow — push admins forward**
  Result page's only forward CTA is "Import another checklist" — nobody does that. Replace with stepper: Chase Cards → Anchor → Verify Pricing → Flip to Live.

- **Gated product activation wizard (validation stepper)**
  Bigger rewrite that absorbs the post-import flow above. State machine that gates `is_active=true` on a validation pass (variant count, ch_set_name uniqueness, pricing coverage, etc.). Catches every product-data fire we hit in May.

- **Breaker Channel Placement on product cards (paid surface)**
  Logos + deep links to live breaks on consumer product cards. Natural revenue surface once consumer demand for "where can I claim this right now" is proven.

- **Breaker Identity + Crowdsourced Case Pricing**
  Full PRD: [docs/breaker-identity-prd.md](./breaker-identity-prd.md). Backlogged post-public-beta.

- **CardHedger Matching — Semi-Automated Knowledge Updates**
  After a match run, surface low-confidence + unmatched rows + Claude-suggested manufacturer-knowledge updates as proposals for admin review.

- **Phase 5 — C-score: CardHedger Top-Movers + Product Page Widget**
  Display format locked (`↑ Wemby +14%`). Reads CH's `top-movers` first; falls back to computing deltas from `price-updates` polling over a 7d window.

- **Match Review UI**
  Manual override / correction for the ~10% of variants that don't auto-match. Today requires a CLI script.

- **My Breaks Phase 2 — Chase / Hit Card Tracking**
  Per-card logging for hits + chase outcomes. Was deferred from My Breaks Phase 1.

- ⚪ **OPTIONAL · Full taxonomy expansion (manufacturer / brand / specialty)**
  No near-term trigger. The "taxonomy lite" single-column `product_line` already drives everything we need. Take this on when consumer browse/filter UI demands it.

---

## 🔵 Priority 3 — Future pipeline, external dependencies required

- **Odds matcher — handle insert-subset base rows**
  Topps odds PDF has per-parallel rows for inserts plus a base "Insert Set" row that the matcher currently fumbles. Surfaced during Series 1+2 cleanup.

- **Background CardHedger matching (close-the-tab-and-walk-away)**
  Match loop runs client-side today — close tab kills progress. Move to a background job for jumbo products (Panini Donruss Optic, Prizm Football).

- **Phase 6 — P-score: Reddit Sentiment** ⏸ Deferred (approval barrier + cost)

- **Phase 7 — S-score: Player Stats API**
  Unblocked — needs balldontlie.io API key.

---

## ⚠️ Known Limitations

- **CardHedger — Dual / Triple / Quad Autographs**
  Multi-player autograph cards (e.g. `Dylan Crews/James Wood 2025 Bowman's Best DA-WC`) are unmatched.

---

## 🔒 Security — Post-Launch Hardening

- **RLS on Core Business Tables** — `products`, `players`, `player_products`, `player_product_variants`, `pricing_cache`, `player_risk_flags`, `waitlist`. App uses `supabaseAdmin` (service role) so RLS isn't the active gate, but defense-in-depth.
- **Rate Limiting** — no rate limiting on any endpoint. Waitlist + analysis (Anthropic) + CH proxy all unlimited.
- **File Upload Validation** — admin upload endpoints accept arbitrary files. No MIME or size validation. `card-lookup` accepts unbounded base64.
- **Error Message Sanitization** — many routes return `err.message` directly; Supabase errors can leak schema details.

---

## 🌌 Long-term Vision (Kyle's Ideas — 2026-03-25)

- **Vision 1 — Enhanced Pricing Engine (CardPulse integration)** — real-world demand signals beyond card EV.
- **Vision 2 — Deal Monitor / Card Arbitrage Tool** — scanner for underpriced cards across major platforms.
- **Vision 3 — Affiliate Commerce Layer** — affiliate revenue from links to Alt / Golden / Fanatics Collect / eBay.
- **Vision 4 — Hobby Education Hub** — content layer for collectors new to the hobby.
- **Vision 5 — My Chase** — personalized player watchlist. _(Phase 1 already shipped 2026-05-05.)_

---

## ✅ Recently Shipped (last ~2 weeks)

For full descriptions see CHANGELOG.md.

- **Side-by-side composition + observation enrichment (slice 1 + 2b)** — 2026-05-14
- **Market Delta Watch (#1)** — 2026-05-12
- **Consumer audit trail "Why this price?" (#6)** — 2026-05-12
- **Live ask-price ingestion (#2 via Discord `/break-price`)** — 2026-05-13
- **`/break-price` refine-with-correction flow** — 2026-05-15
- **`/break-price` multi-screenshot via context menu + slash slots** — 2026-05-14 / 2026-05-15
- **Per-product anchor configurator (Plan A pricing trilogy)** — 2026-05-11
- **Pricing trilogy Plans B + C (display markup + lifecycle EV multiplier)** — 2026-05-11
- **Inline Break Analysis block on product pages** — 2026-05-11
- **Streaming pricing refresh — partial** — 2026-05-09 (ch_price_cache + incremental flush)
- **Topps Series 1 / Series 2 split — derived productScope fallback** — 2026-05-10
- **Composition + observation source-type (slice 1 of 3)** — 2026-05-14
- **Panini parser (Master Checklist canonical sheet)** — 2026-05-06
- **CH data audit — P0.1/P0.2/P0.3 shipped** — 2026-05-06
- **Per-player graded comp drilldown (FMV-batch swap)** — 2026-05-20 _(superseded original spec)_
- **CH catalog dedup on (number, variant) collisions** — 2026-05-20
- **ch_price_cache COALESCE-preserving upsert** — 2026-05-20
- **Pre-release page polish (countdown, sort/filter, PSA 9, hype + ask chips)** — 2026-04-30
- **Score modulation (risk_flag + hype_tag → effectiveScore)** — 2026-04-30
- **Insight capture granularity (sentiment scope + variant scope + odds_observation)** — 2026-04-30
- **My Chase / Players Hub Phase 1** — 2026-05-05
- **PWA install matrix (consumer)** — 2026-05-05
- **Pricing feedback (consumer)** — 2026-05-06
- **PostHog hardening** — 2026-05-06
- **Beta launch messaging PR1 + PR2 + PR3** — 2026-05-13
- **Verdict observation enrichment (slice 2b)** — 2026-05-14

---

## ✅ 2026-05-25 → 2026-05-26 ship — pricing-cron arc + parser fixes + data-health + FMV

Pricing-refresh cron recovery, /insight + /break-price parser hardening, CH data-health dashboard with live probe, and FMV `price_explanation` surfaced in the player drawer.

- **#135** Cache-read chunk 1000 → 200 (Kong URL cap — pricing cron was timing out for 3 days)
- **#136** Skip refetching fresh-but-all-null cached rows (saved tens of thousands of wasted CH calls per firing)
- **#137** Worker `AbortController` so we never hit Vercel's 300s kill — always return structured `partial` summary
- **#138** CardHedger data-health dashboard at `/admin/data-health`
- **#139** Per-row "Probe CH" live button on the dashboard
- **#140** `/insight` refine correction = authoritative override + nickname table
- **#141** `/break-price` same shape applied
- **#142** Scope insights roster to active-product players (real fix for Wemby misattribution — 6,666 → 2,889)
- **#143** FMV `price_explanation` tooltip on player drawer per-grade cells

Scheduled task `check-pricing-cron-aborts` fires 2026-05-26 09:00 ET to verify overnight cron firings recovered.

---

## ✅ Earlier ship (2026-05-21 → 2026-05-22)

UD/OPC importer arc + UX polish + waitlist admin + delete-product + Discord CTA. See PRs #117–#133.

- **#117** UD URL parser foundation (Firecrawl + odds)
- **#118** Firecrawl Zod→JSON Schema pre-conversion + UD panel gating
- **#119** UD URL parser pivot to deterministic markdown table parse
- **#120** Beckett XLSX parser (Master Card List)
- **#121** Pre-release products can publish without CH set name
- **#122** UD importer moved to /admin/import-checklist
- **#123** Legacy parser skips Master Card List sheet
- **#124** Legacy parser detects UD XLSX + throws useful error
- **#125** UD odds parsed deterministically (drop Claude Haiku)
- **#126** Edit page nav hierarchy (back → list, dashboard → top right)
- **#127** Waitlist Reject + Delete actions
- **#128** Products table sortable columns + Release column + newest-first default
- **#130 / #131** Discord CTA scaffolding + live invite URL
- **#132** Product Delete with Danger Zone + type-to-confirm
- **#133** CH data-health dashboard added to P1 backlog (shipped 2026-05-26 as #138/#139)
