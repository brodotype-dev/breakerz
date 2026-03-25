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

## Decided / Out of Scope

- No public social leaderboard or trending feed
- No real-time data — daily/6h refresh is the ceiling
- Icon tier is a model correction flag, not a promotional feature
- Reddit API > X/Twitter for hobby signal (hobby-specific, free, better S/N ratio)
- Google Trends: rejected — too broad for player-level card signal
