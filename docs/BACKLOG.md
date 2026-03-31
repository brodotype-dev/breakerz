# Card Breakerz — Backlog

Consolidated list of known work, organized by priority. Items pulled from the Social Currency PRD, CLAUDE.md known gaps, and open questions surfaced during development.

**Last updated:** 2026-03-25

---

## Priority 1 — High value, no external blockers

### Phase 4 — Consumer Buzz Indicators on Break Page
**Effort:** ~0.5 days
**Why now:** Phases 1–3 are live. The data exists in the DB. The break page currently shows none of it — buyers see no signal that a player is hot/cold/flagged until they run Breakerz Sayz. Phase 4 closes that gap.

- `components/breakerz/TeamSlotsTable.tsx`: add up/down arrow (↑↓) on team rows where `effective_score > 0.1` or `< -0.1`
- `components/breakerz/TeamSlotsTable.tsx`: show purple ★ badge for icon-tier players on the team
- `components/breakerz/PlayerTable.tsx`: buzz indicator badge, icon badge, ⚡ high volatility badge per player row
- Risk flags: show ⚑ icon on team row + tooltip with flag note on hover

**Files:** `components/breakerz/TeamSlotsTable.tsx`, `components/breakerz/PlayerTable.tsx`

---

### Breakerz Bets Decay / Expiry Policy
**Effort:** ~0.5 days
**Why:** `breakerz_score` has no expiry. A B-score set in March will still be affecting slot costs in June unless manually cleared. Either add a `breakerz_score_set_at` timestamp + auto-decay, or add a visible "set X days ago" indicator in the Debrief UI so admins know to refresh stale scores.

**Decision needed:** decay (automatic) or expiry indicator (manual) — recommend the indicator first since it's simpler and keeps humans in the loop.

---

### Pricing Cache — Scheduled Refresh
**Effort:** ~1 day
**Why:** Pricing cache has a 24h TTL but there's no scheduled job to refresh it. After expiry, the first user to hit the break page triggers a live CardHedger fetch — adds latency and occasionally fails. A nightly Vercel Cron job refreshing active products would fix this.

- New cron route: `app/api/cron/refresh-pricing/route.ts`
- Vercel cron config in `vercel.json`
- Scope: only active products with players that have a `cardhedger_card_id`

---

### Baseline Fair Value in Breakerz Sayz
**Effort:** ~0.5 days
**Why:** When `buzz_score` or `breakerz_score` adjusts fair value, buyers currently see the adjusted number with no indication of what the "raw" model says. Showing both (e.g., "Fair value: $42 · Baseline: $38 without signal adjustment") adds transparency and trust.

**Files:** `app/api/analysis/route.ts` (return `baselineFairValue`), `app/analysis/page.tsx`

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
**Effort:** ~1 day
**Why:** All manufacturer-specific matching rules are hardcoded regex in `cleanVariant()` and inline conditionals in the route. As Panini, Topps Finest, and other products are imported, this becomes unmaintainable. The system also has a structural blind spot: for card-code queries (BDC-91 etc.), CH correctly returns the right player but Claude rejects the match because there's no player name in the query to verify against.

**Design:** `lib/card-knowledge/` module system — each manufacturer is one TypeScript class implementing a `ManufacturerKnowledge` interface with three methods: `cleanVariant()`, `reformulateQuery()`, `claudeContext()`. The context string is injected into the Claude Haiku prompt so it understands manufacturer-specific terminology (e.g. "BDC codes are unique per player — trust CH's result"). Full plan at `/Users/brody/.claude/plans/precious-hatching-sedgewick.md`.

**Key insight from 2026-03-31 CSV analysis:** Card-code queries are working (CH finds the right player/set) but Claude has 0 confidence because the query has no player name. The manufacturer context fix — telling Claude that card codes uniquely identify players — should resolve most of the remaining ~28% unmatched.

**Files:** `lib/card-knowledge/` (new dir), `lib/cardhedger.ts`, `app/api/admin/match-cardhedger/route.ts`

---

### Phase 5 — C-score: CardHedger Top-Movers
**Effort:** 2–3 days
**Blocker:** Kyle needs to confirm `top-movers` endpoint response structure — specifically whether it includes volume data for normalization, or just relative rank. Normalization strategy changes depending on the answer.

- Add `top-movers` and `price-updates` to `lib/cardhedger.ts`
- **Decision needed first:** store C-score in separate `c_score` column or write composite directly to `buzz_score`? Separate columns are better for auditability and debugging; decide before building.
- Vercel Cron (daily): fetch top-movers → cross-reference `player_product_variants.cardhedger_card_id` → compute C-score → write to DB
- `price-updates` delta poll (every 6h): price swing > threshold → create pending High Volatility review record
- Admin: pending High Volatility review queue

**Files:** `lib/cardhedger.ts`, `app/api/cron/update-scores/route.ts`, `vercel.json`

---

### Match Review UI
**Effort:** ~1 day
**Why:** CardHedger auto-match handles ~90%+ of variants. The remaining ~10% are flagged in the unmatched variants list on the product dashboard, but there's no UI to manually override a match or correct a low-confidence match. Currently requires a CLI script (`node scripts/map-cards.mjs`).

- Add a manual match override UI to the product dashboard or unmatched variants section
- Low priority given high auto-match rate, but worthwhile before onboarding more products

---

## Priority 3 — Future pipeline, external dependencies required

### Phase 6 — P-score: Reddit Sentiment
**Effort:** 2–3 days
**Blocker:** Reddit API key
**Notes:** r/sportscards + sport-specific subs; mention volume vs 30-day baseline → normalized P-score. Rate limit evaluation needed — may need to scope to active-product players only. Combines with C-score into `buzz_score` composite.

---

### Phase 7 — S-score: Player Stats API
**Effort:** 3–5 days (per sport, NBA first)
**Blocker:** balldontlie.io API key (free for NBA)
**Notes:**
- Recent performance trend (last 7 days vs season avg) → S-score
- Injury status → auto-drafts Risk Flag pending record → admin review queue (never auto-publishes)
- Prospect window: if `is_rookie` and games < 20, downweight S-score in composite
- **Gap:** No `player_type` or `debut_date` field to distinguish pre-debut draft picks from active rookies. Needs either a new field on `players` or a heuristic from game count.

---

## Open Questions

These need a decision before the relevant work can be scoped or started.

| # | Question | Blocks |
|---|---|---|
| 1 | **Score decay:** Should `buzz_score` auto-decay between pipeline runs (-20%/day), or persist until overwritten? Daily pipeline may make this moot. | Phase 5 design |
| 2 | **Component columns:** Store `c_score`, `s_score`, `p_score` separately for auditability, or just write composite to `buzz_score`? Separate = better debugging, more schema. | Phase 5 |
| 3 | **Breakerz Bets expiry:** Decay automatically or show "set N days ago" indicator + manual refresh? | Decay/expiry item above |
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
- Reduces buyer friction on Breakerz Sayz — a new collector who doesn't understand EV can click through to learn before buying
- Trust signal — demonstrates expertise, not just a calculator

---

## Decided / Out of Scope

- No public social leaderboard or trending feed
- No real-time data — daily/6h refresh is the ceiling
- Icon tier is a model correction flag, not a promotional feature
- Reddit API > X/Twitter for hobby signal (hobby-specific, free, better S/N ratio)
- Google Trends: rejected — too broad for player-level card signal
