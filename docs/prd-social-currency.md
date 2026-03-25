# PRD: Social Currency Signal

**Status:** Planned — schema foundation complete, data pipeline not yet built
**Owner:** Brody Clemmer
**Last updated:** 2026-03-24

---

## Problem

The current pricing engine is purely market-based: slot cost is weighted by card EV and pull odds. It tells you what a player's cards are worth *right now* — but not whether that player is *about to pop*.

Two slots can have identical fair values today but wildly different upside. A veteran with stable comps and a hyped rookie with no sales history yet look the same to the engine. A breakout game, a trade, a viral moment — none of that surfaces until it shows up in sold comps, which lags by days or weeks.

That lag is the gap social currency closes.

---

## Goal

Give buyers (and breakers) a forward-looking signal layer on top of the EV model. When social chatter around a player is spiking — Reddit posts, YouTube pulls, X mentions — the engine weights that player's slot higher, reflecting real demand that hasn't hit sold prices yet.

Primary user: the **consumer** using Breakerz Sayz to evaluate a slot. A high-buzz team should make the BUY threshold harder to hit — because the market may be about to reprice it.

Secondary user: the **breaker** setting slot prices. Knowing which teams have elevated buzz helps them price fairly without getting burned.

---

## What We're Building

### Phase 1 — Manual Curator Score (v3 target)

The simplest version. An admin sets a `buzz_score` per player per product via a simple UI. No data pipeline, no API integrations. This proves the concept and produces real signal for a handful of high-profile players.

**Score interpretation:**
- `null` / `0.0` — no adjustment (identical to current behavior)
- `0.1` — 10% weight boost (mild buzz)
- `0.25` — 25% weight boost (hot player, recent hype)
- `0.5` — 50% weight boost (viral moment, breakout)
- `1.0` — 100% weight boost (maximum; doubles the player's effective weight)

**Engine impact:**
```
hobbyWeight = hobbyEVPerBox × (1 + buzz_score)
```
Already wired in — `buzz_score` column exists on `player_products`, engine reads it. No code change needed for Phase 1, only admin UI.

**Admin UI needed:**
- Input on the player management page (`/admin/products/[id]/players`) — a simple 0–1.0 slider or number field per player
- Optional: bulk "top movers" quick-set (0, 0.1, 0.25, 0.5, 1.0 pill options)

---

### Phase 2 — Automated Score from Social Signals (future)

Replace or supplement manual scoring with a pipeline that ingests social signal and computes `buzz_score` automatically.

**Candidate data sources (not decided):**

| Source | Signal | Feasibility |
|---|---|---|
| Reddit (`r/baseballcards`, `r/basketballcards`, etc.) | Post/comment volume mentioning player name | Reddit API, free tier |
| YouTube | Video count/views for "{player} pull" search | YouTube Data API, free quota |
| X / Twitter | Mention volume + engagement | API is expensive; consider scraping or a third-party aggregator |
| eBay saved searches | Watch count on active listings | Undocumented, risky |
| CardHedger velocity | Volume of sold comps vs 30-day baseline | Kyle can expose this — most accurate leading indicator |

**Recommended starting point:** CardHedger sales velocity from Kyle's data, plus Reddit. Both are accessible without significant cost and correlate directly with break demand.

**Pipeline architecture:**
1. Scheduled job (daily or every 6h) pulls mention counts per player
2. Normalizes to a 0–1 scale relative to baseline (rolling 30-day avg = 0.0; 2× baseline ≈ 0.25; 10× baseline ≈ 1.0)
3. Writes to `player_products.buzz_score`
4. Existing engine picks it up automatically on next pricing request

---

## Consumer-Facing Expression

The buzz signal should be visible to users — not hidden in the math.

**Breakerz Sayz (analysis page):**
- When a team has one or more players with `buzz_score > 0.1`, show a "🔥 trending" tag next to the team name or in the AI narrative prompt
- Claude's prompt already receives player EV and RC flags — add buzz context: "buzz score: 0.4 (trending on Reddit)" so the narrative can reference it

**Team Slots table (break page):**
- Optional flame icon on team rows with elevated buzz — subtle, doesn't replace the math, just surfaces the signal

**Player table:**
- Small indicator badge on rows with `buzz_score > 0.1` (similar to the existing "est" badge for estimated pricing)

---

## What We're Not Building

- A public leaderboard or trending feed — not a social product, not trying to be
- Real-time data — daily or 6h updates are fine; this is directional signal, not a ticker
- A sentiment score — volume only, not positive/negative sentiment analysis

---

## Schema (already deployed)

```sql
-- player_products
buzz_score FLOAT DEFAULT NULL
```

Migration: `supabase/migrations/20260324180000_add_buzz_score.sql`

---

## Open Questions

1. **Who curates the manual score in Phase 1?** Kyle, Brody, or a trusted admin? Define who has access and how often they're expected to update it.
2. **How does buzz interact with pre-release products?** A pre-release player may have high buzz but no EV — does the boost apply to the default/fallback EV values, or only to live-priced players?
3. **Decay?** Should buzz scores decay over time automatically (e.g., reduce by 50% each week without a refresh), or stay until manually cleared?
4. **How do we display uncertainty?** A slot that's priced higher *because* of buzz should probably carry a caveat — "fair value includes buzz adjustment." Need to decide if/how that surfaces.

---

## Success Criteria

- **Phase 1:** An admin can set a buzz score for any player in under 30 seconds. Setting a score of 0.25 on a key player visibly shifts that team's slot cost on the break page and changes the Breakerz Sayz fair value.
- **Phase 2:** Buzz scores update automatically at least daily. At least one score shift per week on active products reflects a real-world event (trade, breakout game, viral pull).

---

## Dependencies

- **Phase 1:** Admin UI on player management page (new input field)
- **Phase 2:** Kyle's agreement on CardHedger velocity data access; Reddit API key; scheduled job infrastructure (Vercel Cron or similar)
