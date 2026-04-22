# BreakIQ — Backlog

Consolidated list of known work, organized by priority. Items pulled from the Social Currency PRD, CLAUDE.md known gaps, and open questions surfaced during development.

**Last updated:** 2026-04-04

---

## Priority 1 — High value, no external blockers

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

### Baseline Fair Value in BreakIQ Sayz
**Effort:** ~0.5 days
**Why:** When `buzz_score` or `breakerz_score` adjusts fair value, buyers currently see the adjusted number with no indication of what the "raw" model says. Showing both (e.g., "Fair value: $42 · Baseline: $38 without signal adjustment") adds transparency and trust.

**Files:** `app/api/analysis/route.ts` (return `baselineFairValue`), `app/analysis/page.tsx`

---

### Per-player graded comp drilldown
**Effort:** ~1 day

**Why:** Pricing refresh now uses `batchPriceEstimate` with `grade: 'Raw'` — one HTTP call per 500 variants, no rate limits, fast. Cost of the switch: EV Mid is now based on raw sale prices only. PSA 9 / PSA 10 comps are no longer included in the aggregate. Disclosed to the user via a banner on the break page.

Graded pricing still matters for specific decisions (is this slot worth it if I grade the hit?). Don't bring it back to the aggregate refresh — that would reintroduce the per-variant fan-out. Instead: click a player row → side panel fetches graded comps on demand via `getAllPrices` for that player's top variants (base + autos + key parallels).

**Files:**
- `components/breakiq/PlayerTable.tsx` — row click handler + side panel
- `app/api/pricing/graded-comps/route.ts` (new) — takes `{ playerProductId }`, fetches graded prices for the player's top N variants
- Copy change on the break page banner once drilldown ships

---

## Priority 2 — High value, external dependency or more effort

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
**Blocker:** Kyle needs to confirm `top-movers` endpoint response structure — specifically whether it includes volume data for normalization, or just relative rank. Normalization strategy changes depending on the answer. If rank-only, we show directional arrows; if price delta is included, we can show % movement.

- Add `top-movers` and `price-updates` to `lib/cardhedger.ts`
- **Decision needed first:** store C-score in separate `c_score` column or write composite directly to `buzz_score`? Separate columns are better for auditability and debugging; decide before building.
- Vercel Cron (daily): fetch top-movers → cross-reference `player_product_variants.cardhedger_card_id` → compute C-score → write to DB
- `price-updates` delta poll (every 6h): price swing > threshold → create pending High Volatility review record
- Admin: pending High Volatility review queue
- **Product page Top Movers widget:** on the break page, show a ranked list of players in this product whose cards are trending on the secondary market (e.g. "Trending up: Wemby +18%, Cade +11% · Trending down: KD -8%"). Cross-references `player_product_variants.cardhedger_card_id` against top-movers response — same data pipeline as C-score, surfaced directly to the buyer. This is the consumer-facing output of the C-score computation.

**Files:** `lib/cardhedger.ts`, `app/api/cron/update-scores/route.ts`, `vercel.json`, `app/break/[slug]/` (Top Movers widget)

---

### Match Review UI
**Effort:** ~1 day
**Why:** CardHedger auto-match handles ~90%+ of variants. The remaining ~10% are flagged in the unmatched variants list on the product dashboard, but there's no UI to manually override a match or correct a low-confidence match. Currently requires a CLI script (`node scripts/map-cards.mjs`).

- Add a manual match override UI to the product dashboard or unmatched variants section
- Low priority given high auto-match rate, but worthwhile before onboarding more products

---

## Priority 3 — Future pipeline, external dependencies required

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
