# PRD: Social Currency Signal

**Status:** Planned — schema foundation complete, data pipeline not yet built
**Owner:** Brody Clemmer
**Last updated:** 2026-03-24
**Input:** Kyle (Town & Line / CardPulse) — signal layer architecture and API recommendations

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

## Three Signal Layers

Kyle's architecture breaks this into three distinct layers. Each is independent — they can be built and shipped incrementally, and each adds signal on its own before the others are in place.

---

### Layer 1 — Card Market (C-score)

*What is the market doing with this player's cards right now?*

**Source:** CardHedger (already integrated)

This is the most direct signal — actual secondary market behavior. Distinct from the EV point-in-time price: this is about *rate of change* and *demand velocity*.

**Inputs:**
- Sales velocity vs rolling 30-day baseline
- Price trajectory: current comps vs 14-day and 30-day averages
- Sell-through rate: how quickly listings are moving

**Examples:**
- Cards selling 3× faster than baseline → strong demand spike
- Prices declining week-over-week despite steady mentions → hype without buyers
- Cards sitting on eBay for days → weak demand regardless of EV

**CardHedger endpoints available (from full API review):**

| Endpoint | Purpose | How we use it |
|---|---|---|
| `GET /v1/cards/top-movers` | Pre-computed cards with highest recent price gains; anomaly-filtered | **Primary C-score source** — cross-reference against our active players; no custom velocity math needed |
| `POST /v1/cards/price-updates` | Delta polling for price changes since a given timestamp | Powers High Volatility auto-detection; efficient — only fetches what changed |
| `GET /v1/download/daily-price-export/{file_date}` | Full CSV of all prices for a given day | Nightly batch refresh once product catalog grows; far cheaper than per-card calls |
| `POST /v1/cards/subscribe-price-updates` | Subscribe to real-time tracking for specific card IDs | Future — real-time alerts; not needed for Phase 2 MVP |

**Key insight:** `top-movers` means we don't need to build C-score velocity from scratch. CardHedger already computes "cards with the highest recent price gains" with outlier filtering built in. Pulling that endpoint daily and joining against our tracked players IS the C-score — significantly lower build effort than originally estimated.

**Note on card matching:** CardHedger also exposes `POST /v1/cards/card-match`, an AI-powered natural language matcher. We currently do this with Claude (`lib/cardhedger.ts` → `claudeCardMatch()`). Worth benchmarking their endpoint against ours on a sample batch — if accuracy is comparable, it eliminates Anthropic API cost on matching operations entirely.

---

### Layer 2 — Player Performance (S-score)

*Is this player playing well right now?*

This layer was missing from the original PRD. Recent on-court/on-field performance is a direct driver of card demand — a player averaging 35 PPG in a playoff run moves differently than the same player at 18 PPG in a lost season.

**Sources by sport:**

| Sport | API | Cost | Key metrics |
|---|---|---|---|
| NBA | balldontlie.io | Free | PPG, RPG, APG, PER, recent game logs |
| NBA (deeper) | sportsdata.io | Paid | More depth, injury status |
| College | ESPN public endpoints | Free | Stats, draft stock context |
| WNBA | ESPN public endpoints | Free | Stats |
| MLB | — | TBD | Similar approach |
| NFL | — | TBD | Similar approach |

**What we compute:**
- Recent performance trend (last 7 days vs season average) — rising or falling
- Injury status (feeds directly into Risk Flags, see below)
- Draft/prospect context for college players on pre-release products

**Output:** A performance momentum score — positive when a player is playing above their norm, negative when trending down or on IR.

---

### Layer 3 — Social Buzz (P-score)

*Are people talking about this player, and is it positive?*

Captures cultural attention — search interest, hobby community sentiment, media volume. Harder to source than market or stats data, but captures things the other two miss: viral moments, off-field stories, draft hype, breakout narratives.

**Sources (Kyle's assessment):**

| Source | Cost | Signal |
|---|---|---|
| Google Trends (pytrends) | Free | Search interest spikes — strong proxy for card demand |
| Reddit API | Free | r/sportscards + sport-specific subs; hobby-specific sentiment |
| X / Twitter API | ~$100/mo (basic tier) | Mention volume + engagement |
| NewsAPI | $0–$449/mo | Media mention volume |
| TikTok / Instagram | No public API | Would need SocialBlade or Google Trends as proxy |

**Kyle's recommendation for MVP: Google Trends + Reddit.** Both free, together they cover search intent (is anyone looking this player up?) and hobby community sentiment (are collectors excited or not?).

**Output:** A cultural attention score — directional, positive or negative, based on volume and sentiment of mentions.

---

## Composite Score

The three layers combine into a single `buzz_score` that feeds the engine.

```
buzz_score = weighted_average(C-score, S-score, P-score)
```

Suggested MVP weighting:
- C-score (market): **0.5** — actual buying behavior is the strongest signal
- S-score (stats): **0.3** — on-court performance is predictive and objective
- P-score (social): **0.2** — directional signal but noisier; weight up as confidence increases

All weights are tunable. The ratio should shift as we validate which signals actually correlate with break slot demand.

**Kyle's recommended MVP stack:**
1. Google Trends (free) — buzz proxy
2. Reddit API (free) — hobby sentiment
3. One paid sports stats API — performance layer
4. CardHedger — market pricing (already have this)

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

## Player Risk Flags — A Separate Concept

Risk flags are **not** part of the buzz_score system. They are a disclosure layer — the equivalent of a fantasy sports injury report. The engine doesn't adjust the math; it surfaces information and lets the buyer make the call.

The distinction matters because the *outcome* of a news event is unknowable at the time of the break, and the *impact* on card value is highly context-dependent:

- Wander Franco (MLB, criminal investigation, likely career-ending) → cards essentially worthless
- NFL player DV charge (league issues fine, plays next week) → hobby community largely doesn't care
- Star player traded mid-season to a bad team → meaningful price drop, no controversy involved
- Player retires unexpectedly → depends entirely on legacy and whether they were already priced in

A score can't capture that. What it needs is a flag + a plain-language note that puts the buyer on notice.

### What a Risk Flag Looks Like

Each flag has three parts:

1. **Type** — categorizes the situation so the UI can choose appropriate framing
2. **Note** — a short, factual description of the situation (admin-written or AI-drafted)
3. **Severity** — Low / Medium / High; drives display treatment, not the score

| Type | Examples | Typical severity |
|---|---|---|
| `injury` | Day-to-day, IR, season-ending | Low → High |
| `suspension` | PED, conduct, league discipline | Medium → High |
| `legal` | Investigation, charges, arrest | Medium → High (depends on outcome) |
| `trade` | Traded to weak team, diminished role | Low → Medium |
| `retirement` | Announced or rumored | Medium → High |
| `off-field` | Controversy, scandal, public incident | Highly variable — needs a note |

### Display in Breakerz Sayz

When a team includes a flagged player:

- Surface a **red flag banner** in the result card, similar to an injury report line
- Example: `⚑ Wander Franco — Under investigation (MLB suspended indefinitely). Card values have declined significantly pending outcome.`
- Claude's prompt receives the flag and note: the AI narrative should acknowledge the risk directly rather than ignoring it

### Display in Break Page / Team Slots

- Small flag icon on the team row and expanded player row
- Tooltip with the note text on hover

### Admin UI

- Flag management on the player page — add/edit/clear flags per player
- Fields: Type (dropdown), Severity (Low/Medium/High), Note (free text, 1–2 sentences)
- Flags are player-level, not product-specific — an injured player carries the flag across all active products

### Phase 2 — AI-Assisted Flag Detection

In a future automated phase, a news scanner could:
1. Pull recent headlines for tracked players via a news API or RSS
2. Send to Claude with a prompt: "Does this headline indicate a risk to this player's card value? If yes, classify the type and severity and draft a one-sentence note."
3. Surface as a *pending flag* for admin review and approval — never auto-publish
4. Admin approves, edits, or dismisses

The human stays in the loop on risk flags. Automated buzz scores can publish directly; risk flags require a human judgment call before going live.

---

## High Volatility Tag — A Third Label Type

Distinct from both Risk Flags and buzz_score. A Risk Flag says "here's a known event that may impact value." The High Volatility tag says "this player's cards are behaving unpredictably — expect large price swings in either direction."

The key difference: **Risk Flags have a known cause. High Volatility may not.**

A High Volatility tag is appropriate when:
- Card prices are swinging more than 2–3× their normal range with no clear reason
- The player is a hot prospect with no established comp baseline (thin data, wild spread)
- Rumors are circulating but nothing confirmed (trade speculation, draft position chatter)
- The card has recently been pumped or manipulated on social (artificial spike, not organic demand)
- The player is polarizing — some buyers are all-in, others won't touch it

It is **not** a negative signal — it's an uncertainty signal. A highly volatile player could spike massively or crater. The tag says: factor this into your risk tolerance, not "avoid this."

### Display

- Different visual treatment from Risk Flags: where a Risk Flag gets a red icon (⚑), High Volatility gets a lightning bolt or similar "unstable" indicator (⚡)
- Breakerz Sayz: surfaces as a neutral advisory, not a warning — "This player's card market is showing high volatility — prices have been swinging significantly. The fair value shown may not reflect where the market lands by break day."
- Claude's prompt receives the tag and should reference it: frame the slot as higher risk/reward, not as a pass
- Player table: small indicator badge on the row

### Schema

```sql
-- player_risk_flags table (already planned) — add high_volatility as a type
-- OR: separate boolean on player_products for simplicity
ALTER TABLE player_products ADD COLUMN IF NOT EXISTS is_high_volatility BOOLEAN DEFAULT FALSE;
```

Because High Volatility is tied to a specific product context (a player's cards in *this* set may be volatile while their cards in another set aren't), it lives on `player_products` rather than `players`. Risk Flags are player-level because an injury applies everywhere; volatility is card/product-specific.

### Phase 2 Automation

C-score data (CardHedger price spread, sell-through variance) can auto-detect high volatility:
- If price spread (high/low ratio) exceeds 3× the player's 30-day baseline spread → auto-flag for admin review
- If sales volume spikes >5× in 48 hours → auto-flag
- Like Risk Flags, auto-detection drafts a pending flag; admin approves before it goes live

---

## Prospects, Draft Picks, and the Pre-Stat Window

The player stats layer (S-score) is built on performance data. But the highest-buzz players in the hobby often have *zero* stats to reference — top draft prospects, college players on pre-release products, and rookies before they've played a meaningful NBA/MLB/NFL game.

This is not a gap in the model. It's a different regime entirely.

**The argument:** At draft time and in the pre-rookie window, a prospect's cards can see some of the most intense demand in the hobby. Bowman is the clearest example — draft picks are being broken months before a single pro at-bat. The entire value is forward-looking hype, not performance.

**How we handle the pre-stat window:**

| Player type | S-score | C-score | P-score | Notes |
|---|---|---|---|---|
| Established pro | Full weight | Full weight | Full weight | Normal composite |
| Rookie (debut season) | Partial — limited game log | Full weight | Full weight | S-score weighted down until 20+ games |
| Draft pick (pre-debut) | Null | Full weight | Full weight | S-score excluded entirely; C + P only |
| College player (Bowman) | Null | Full weight | Full weight | Same as draft pick |
| Prospect (pre-announcement) | Null | Partial | Full weight | C-score may be thin if card is new |

**When S-score is null, the composite rebalances:**
```
buzz_score = weighted_average(C-score × 0.6, P-score × 0.4)
```

**Prospect-specific P-score inputs to prioritize:**
- Draft board position and movement (mock drafts, beat reporter consensus)
- Combine/workout performance buzz (Reddit, beat writers)
- College highlight reel viral momentum
- "Top prospect" designations in hobby media

**The implication for Breakerz Sayz:** When a team's slot is dominated by a high-buzz draft prospect with no pro stats, the AI narrative should explicitly frame this as a pure hype play — "this slot's value is entirely prospect hype, not established performance." That's a different conversation than a veteran slot, and Claude's prompt should know which regime it's in.

**High Volatility is almost always appropriate for pure prospects.** No comps, thin data, massive upside and downside. Admin should default to tagging top draft picks as High Volatility on pre-release products until their market establishes.

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
-- players (icon status and risk flags are player-level, not product-level)
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_icon BOOLEAN DEFAULT FALSE;

-- Risk flags (separate table — a player can have multiple active flags)
CREATE TABLE player_risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type TEXT NOT NULL,         -- 'injury' | 'suspension' | 'legal' | 'trade' | 'retirement' | 'off-field'
  severity TEXT NOT NULL,     -- 'low' | 'medium' | 'high'
  note TEXT NOT NULL,         -- 1–2 sentence plain-language description
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Existing migration: `supabase/migrations/20260324180000_add_buzz_score.sql`
New migrations needed:
- `supabase/migrations/YYYYMMDDHHMMSS_add_is_icon.sql`
- `supabase/migrations/YYYYMMDDHHMMSS_add_player_risk_flags.sql`

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

Replace manual scores with an automated pipeline. Build incrementally — each layer adds value independently.

**Recommended build order (updated based on full API review):**

1. **`top-movers` cross-reference** (C-score) — single daily API call, join against tracked players; no custom velocity pipeline needed. Fastest path to a real market signal.
2. **`price-updates` delta polling** — powers High Volatility auto-detection; efficient because it only returns what changed since last poll
3. **Reddit API** (P-score) — free, hobby-specific sentiment; covers the social layer adequately for MVP
4. **Sports stats API** (S-score) — pick one provider per sport; injury status auto-drafts Risk Flags
5. **`daily-price-export`** — replace per-card calls with a nightly CSV batch once the tracked player list grows beyond ~200

**Pipeline architecture:**
1. Scheduled job (daily) calls `top-movers`, filters to our tracked `cardhedger_card_id` set
2. `price-updates` delta poll (every 6h) flags cards with >threshold price swing → queues High Volatility review
3. Reddit + stats job (daily) computes P-score and S-score per player
4. Normalizes each component to -1.0 to +1.0 relative to rolling 30-day baseline
5. Computes weighted composite, clamps to [-0.9, +1.0], writes to `player_products.buzz_score`
6. Engine picks it up on next pricing request — no cache invalidation needed
7. Stats API injury flag → auto-drafts Risk Flag record (pending admin approval before publishing)

---

## Open Questions

1. **Who curates scores in Phase 1?** Kyle, Brody, or a trusted admin? How often are they expected to refresh?
2. **Negative buzz on pre-release products?** If a player gets injured before a product releases, should the negative score apply to default/fallback EV values, or only live-priced players?
3. **Decay mechanism?** Should buzz scores auto-decay over time without a refresh (e.g., -50% per week toward 0.0), or persist until manually updated?
4. **Transparency in Breakerz Sayz:** When fair value is influenced by buzz_score, should we show the "unadjusted" baseline fair value alongside it so users can see how much the signal moved the number?
5. **Icon review process:** How does a player earn or lose icon status? Who decides? Define the criteria (likely: sustained elite demand across multiple product cycles, not just one breakout moment).
6. **Controversy vs. cold:** High negative-sentiment volume (scandal, incident) is now handled by Risk Flags, not buzz_score. But the two signals can conflict — a player's cards may spike on controversy (dark curiosity buying) even while the flag says "risk." Do we surface both simultaneously, or does a High severity flag suppress the positive buzz display?
7. **Risk flag sourcing in Phase 1:** Who writes the notes? They need to be factual and neutral — not editorializing — since they appear in a consumer-facing product. Define a style guide (past tense, no speculation, source in parentheses if possible).

---

## Success Criteria

- **Phase 1:** Admin can set a buzz score and icon flag for any player in under 30 seconds. A -0.5 score on an injured star visibly reduces their team's slot cost. An icon-tier player surfaces a callout in Breakerz Sayz output.
- **Phase 2:** Scores update automatically at least daily. A real-world event (injury, breakout game, viral pull) produces a measurable score shift within 24 hours.

---

## Dependencies

- **Phase 1:** Admin UI work on player management page; `is_icon` migration; engine guard for icon players
- **Phase 2:** Kyle's agreement on CardHedger velocity data access; Reddit API key; scheduled job infrastructure (Vercel Cron or similar)
