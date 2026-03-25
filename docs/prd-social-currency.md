# PRD: Social Currency Signal

**Status:** Planned — schema foundation complete, data pipeline not yet built
**Owner:** Brody Clemmer
**Last updated:** 2026-03-24

---

## Problem

The current pricing engine is purely market-based: slot cost is weighted by card EV and pull odds. It tells you what a player's cards are worth *right now* — but not whether that's about to change.

Two slots can have identical fair values today but wildly different trajectories. A veteran on a hot streak and one nursing an injury look the same to the engine. A breakout game, a trade, a viral pull video, or a season-ending injury — none of it surfaces until it shows up in sold comps, which lags by days or weeks.

Social currency closes that gap in both directions: upward momentum *and* downward risk.

---

## Goal

Add a forward-looking signal layer on top of the EV model that reflects real-world demand — both hype and decline — before it hits sold prices.

Primary user: the **consumer** on Breakerz Sayz evaluating whether a slot price is fair. A team with elevated buzz should be harder to call a BUY; a team with a key player on injured reserve should surface a risk flag.

Secondary user: the **breaker** setting slot prices. Social signal helps price fairly without getting burned by a player's stock crashing mid-break cycle.

---

## Two Distinct Signal Components

Social currency is not one thing. It's the combination of two separate signals that need to be tracked and displayed differently.

### 1. Player Social Signal (P-score)

*What is the cultural moment around this athlete?*

This captures hype, discourse, and sentiment about the **person** — not their cards specifically. Are people excited about them? Is the conversation positive or negative? Is this name coming up everywhere or fading out?

Examples:
- Wemby drops 40 points in a playoff game → spike in positive mentions
- Player announces they're skipping the season → spike in negative/concerned mentions
- Veteran player has a bad month, fan sentiment turns → gradual decline

**Inputs:**
- Mention volume on Reddit hobby subs, X, YouTube
- Sentiment analysis of those mentions (positive / neutral / negative ratio)
- Search trend velocity (Google Trends or similar)

**Output:** A directional score, positive or negative, reflecting momentum of cultural attention.

---

### 2. Card Market Signal (C-score)

*What is the market actually doing with this player's cards?*

This captures behavior of the **secondary market** — sell-through rate, price trajectory, and demand velocity relative to the player's own historical baseline. This is distinct from EV (which is a point-in-time average price) — this is about *rate of change* and *market enthusiasm*.

Examples:
- A player's cards are selling 3× faster than their 30-day baseline → demand spike
- Prices on key cards are declining week-over-week despite stable mention volume → hype without buyers
- Cards barely moving, sitting on eBay for days → weak demand regardless of EV

**Inputs:**
- CardHedger sales velocity vs rolling 30-day baseline (Kyle to confirm availability)
- Price trajectory: current comps vs 14-day and 30-day averages
- Sell-through rate: how quickly listings are moving

**Output:** A market momentum score — positive when demand is accelerating, negative when it's contracting.

---

## Composite Score

The two signals combine into a single `buzz_score` that feeds the engine.

```
buzz_score = weighted_average(P-score, C-score)
```

Suggested weighting: C-score carries slightly more weight (0.6 / 0.4) because actual market behavior is a stronger predictor than social chatter alone. This is tunable.

**Score scale: -1.0 to +1.0**

| Range | Meaning | Engine effect |
|---|---|---|
| `null` / `0.0` | No data, no adjustment | Baseline (current behavior) |
| `+0.1` to `+0.25` | Mild positive buzz | +10–25% weight boost |
| `+0.25` to `+0.5` | Hot — trending, active demand | +25–50% weight boost |
| `+0.5` to `+1.0` | Peak hype — viral, breaking out | +50–100% weight boost |
| `-0.1` to `-0.25` | Mild headwind — fading, quiet | -10–25% weight reduction |
| `-0.25` to `-0.5` | Soft — injured, poor performance, declining sentiment | -25–50% weight reduction |
| `-0.5` to `-0.9` | Cold — IR, suspended, disgraced | -50–90% weight reduction (floor: -0.9) |

**Engine formula (already wired in):**
```
hobbyWeight = hobbyEVPerBox × (1 + buzz_score)
```

Floor at `buzz_score = -0.9` to prevent zero or negative weights. A weight of zero means a team's slot cost drops to $0 if one player dominates their team — needs the floor to behave correctly.

---

## The Icon Tier — Players Outside Statistical Reference

Some players exist beyond the reach of a normal scoring model. Their cultural footprint is so large and so durable that no historical comp, no sales baseline, and no sentiment score captures what they actually mean to the hobby.

**Wemby. Ohtani. Judge. LeBron. Harper.**

These are not outliers in the statistical sense — they don't just have high buzz scores. They have *structural sticking power*. Their cards move regardless of recent performance, their hype self-sustains, and their floor is substantially higher than what their pure EV suggests during any given period.

Treating them like a normal player with a high buzz_score misrepresents the situation. A 1.0 buzz score implies a multiplier that could flip back to 0. For icon-tier players, the elevated demand is not a cycle — it's the baseline.

### How We Handle Icons

**New flag:** `is_icon BOOLEAN DEFAULT FALSE` on `player_products` (or `players` — probably players, since iconhood is player-level not product-level).

**Engine behavior when `is_icon = true`:**
- Do not apply `buzz_score` multiplier — the floor is already baked in via elevated EV comps
- Instead, surface a distinct UI signal: this player operates outside normal model reference

**Breakerz Sayz behavior:**
- When a team's slot includes an icon-tier player, show a visible callout: **"This team includes [Player], a generational player — their cards hold structural demand that our model's baseline doesn't fully capture. Fair value may be understated."**
- Claude's analysis prompt gets an explicit note: `{player name} is designated icon-tier — their historical comps are not a reliable statistical reference for current demand. Mention this in the analysis.`

**Admin UI:**
- Simple toggle on the player management page: `Icon Player` checkbox
- Short list — this should be 10–20 players globally across all sports, not a casual designation

**Examples of icon-tier players (not exhaustive):**
- Baseball: Shohei Ohtani, Aaron Judge, Ronald Acuña Jr.
- Basketball: LeBron James, Victor Wembanyama, Giannis Antetokounmpo
- Football: Patrick Mahomes, Josh Allen

---

## Consumer-Facing Expression

Signal should be visible to users — not hidden in the math.

**Breakerz Sayz (analysis page):**
- Positive buzz: surface in Claude's narrative — "demand for [player]'s cards is running hot right now"
- Negative buzz: surface as a risk flag — "note: [player] is currently on injured reserve"
- Icon tier: explicit callout (see above)

**Team Slots table (break page):**
- Small up/down arrow or flame/cold indicator on rows with elevated or depressed buzz
- Icon-tier players get a distinct badge (e.g., a star or crown mark)

**Player table:**
- `buzz_score > 0.1`: upward indicator badge
- `buzz_score < -0.1`: downward indicator badge
- `is_icon`: icon badge separate from buzz (always shown regardless of current score)

---

## What We're Not Building

- A public social leaderboard or trending feed
- Real-time data — daily or 6h refresh is sufficient; this is directional, not a ticker
- A pure sentiment product — sentiment is one input, not the whole score
- Icon status as a marketing feature — it's a model correction flag, not a way to promote players

---

## Schema

**Already deployed:**
```sql
-- player_products
buzz_score FLOAT DEFAULT NULL  -- -0.9 to +1.0
```

**To add (Phase 1):**
```sql
-- players (icon status is player-level, not product-level)
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_icon BOOLEAN DEFAULT FALSE;
```

Existing migration: `supabase/migrations/20260324180000_add_buzz_score.sql`
New migration needed: `supabase/migrations/YYYYMMDDHHMMSS_add_is_icon.sql`

---

## Implementation Phases

### Phase 1 — Manual Curator Score + Icon Flag (v3 target)

No data pipeline. Admin sets scores manually, flags icons manually.

- Admin UI: buzz_score slider/pills (-0.9 to +1.0) on player management page
- Admin UI: `is_icon` toggle on player management page
- Engine: already reads `buzz_score`; add `is_icon` guard to skip multiplier for icons
- Breakerz Sayz: surface icon callout in Claude prompt and result UI
- Migration: add `is_icon` to `players` table

---

### Phase 2 — Automated Score from Signal Sources (future)

Replace manual C-score with automated pipeline; optionally automate P-score.

**Candidate data sources:**

| Source | Component | Signal | Feasibility |
|---|---|---|---|
| CardHedger velocity | C-score | Sales volume vs 30-day baseline | Best option — Kyle to confirm |
| CardHedger price trajectory | C-score | Current comps vs 14/30-day avg | Same API call |
| Reddit hobby subs | P-score | Post/comment volume mentioning player | Reddit API, free tier |
| YouTube | P-score | Video count/views for "{player} pull" search | YouTube Data API, free quota |
| X / Twitter | P-score | Mention volume + engagement | Expensive; use aggregator |
| Google Trends | P-score | Search velocity relative to baseline | Free, unofficial API |

**Recommended starting point:** CardHedger sales velocity (C-score) + Reddit mention volume (P-score). Both accessible without significant cost; together they cover market and cultural signal.

**Pipeline architecture:**
1. Scheduled job (daily or every 6h) pulls signal per player from data sources
2. Normalizes each component to -1.0 to +1.0 relative to rolling 30-day baseline
3. Computes weighted composite score, clamps to [-0.9, +1.0]
4. Writes to `player_products.buzz_score`
5. Existing engine picks it up on next pricing request

---

## Open Questions

1. **Who curates scores in Phase 1?** Kyle, Brody, or a trusted admin? How often are they expected to refresh?
2. **Negative buzz on pre-release products?** If a player gets injured before a product releases, should the negative score apply to default/fallback EV values, or only live-priced players?
3. **Decay mechanism?** Should buzz scores auto-decay over time without a refresh (e.g., -50% per week toward 0.0), or persist until manually updated?
4. **Transparency in Breakerz Sayz:** When fair value is influenced by buzz_score, should we show the "unadjusted" baseline fair value alongside it so users can see how much the signal moved the number?
5. **Icon review process:** How does a player earn or lose icon status? Who decides? Define the criteria (likely: sustained elite demand across multiple product cycles, not just one breakout moment).
6. **Negative sentiment direction:** Is `buzz_score = -0.5` always "this player is cold" — or can you have a player who is talked about a lot but negatively (controversy, scandal)? These have different implications for card demand. May need separate `sentiment_direction` field in Phase 2.

---

## Success Criteria

- **Phase 1:** Admin can set a buzz score and icon flag for any player in under 30 seconds. A -0.5 score on an injured star visibly reduces their team's slot cost. An icon-tier player surfaces a callout in Breakerz Sayz output.
- **Phase 2:** Scores update automatically at least daily. A real-world event (injury, breakout game, viral pull) produces a measurable score shift within 24 hours.

---

## Dependencies

- **Phase 1:** Admin UI work on player management page; `is_icon` migration; engine guard for icon players
- **Phase 2:** Kyle's agreement on CardHedger velocity data access; Reddit API key; scheduled job infrastructure (Vercel Cron or similar)
