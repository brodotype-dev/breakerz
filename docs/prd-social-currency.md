# PRD: Social Currency Signal

**Status:** In progress — B-score input built; engine, consumer display, and automated pipeline not yet built
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

## Build Status

| Component | Status | Notes |
|---|---|---|
| `buzz_score` column on `player_products` | ✅ Deployed | Migration 20260324180000 |
| `buzz_score` read by engine | ✅ Wired | `lib/engine.ts` — but always null/0 until populated |
| `breakerz_score` + `breakerz_note` columns | ✅ Deployed | Migration 20260324200000 |
| Breakerz Bets Debrief admin UI | ✅ Built | `/admin/products/[id]` — conversational input, review table, saves to DB |
| `breakerz_score` read by engine | ❌ Not wired | Data is collected but has no effect on slot costs yet |
| Breakerz Bets callout in Breakerz Sayz | ❌ Not built | |
| `is_icon` flag on `players` | ❌ Not built | Migration + engine guard + UI + Sayz callout all pending |
| Icon callout in Breakerz Sayz | ❌ Not built | |
| `player_risk_flags` table | ❌ Not built | Migration + admin UI + display all pending |
| Risk flag display in Breakerz Sayz | ❌ Not built | |
| `is_high_volatility` on `player_products` | ❌ Not built | |
| High Volatility display | ❌ Not built | |
| Buzz indicators on Team Slots / Player table | ❌ Not built | |
| C-score (CardHedger top-movers) | ❌ Not built | No automated pipeline yet |
| P-score (Reddit sentiment) | ❌ Not built | |
| S-score (sports stats API) | ❌ Not built | |
| Composite score formula in engine | ❌ Not built | Engine reads raw `buzz_score` directly, not a composite |
| Score decay mechanism | ❌ Not designed | Open question |

---

## Signal Architecture

### Score Design

The system has two score fields on `player_products` that combine in the engine:

```
effective_score = clamp(buzz_score + breakerz_score, -0.9, 1.0)
hobbyWeight = hobbyEVPerBox × (1 + effective_score)
```

- **`buzz_score`** — the automated composite output (C + S + P layers). Written by the scheduled pipeline. When no pipeline exists, this is null/0 and has no effect.
- **`breakerz_score`** — the editorial layer (B-score). Written via the Breakerz Bets Debrief admin UI. Always human-curated, never automated.

They add additively so neither can fully override the other. The combined value is clamped to [-0.9, +1.0] to prevent zero/negative weights.

The automated composite is computed outside the engine (in the scheduled job) before writing to `buzz_score`:

```
buzz_score = clamp(C × 0.45 + S × 0.25 + P × 0.15, -0.9, 1.0)
```

B-score is always separate — it does not fold into `buzz_score`.

---

### The Four Signal Layers

#### Layer 1 — Card Market (C-score, weight 0.45)

*What is the market doing with this player's cards right now?*

**Source:** CardHedger — already integrated

Rate of change and demand velocity, not a point-in-time price.

**CardHedger endpoints:**

| Endpoint | Purpose | How we use it |
|---|---|---|
| `GET /v1/cards/top-movers` | Pre-computed cards with highest recent price gains; anomaly-filtered | **Primary source** — cross-reference against our tracked `cardhedger_card_id` set daily |
| `POST /v1/cards/price-updates` | Delta polling since a timestamp | High Volatility auto-detection — only fetches what changed |
| `GET /v1/download/daily-price-export/{file_date}` | Full daily CSV | Nightly batch once catalog grows beyond ~200 tracked players |

`top-movers` means no custom velocity pipeline is needed. CardHedger already computes the signal with outlier filtering. Cross-referencing against our players IS the C-score.

---

#### Layer 2 — Player Performance (S-score, weight 0.25)

*Is this player playing well right now?*

Recent on-court/on-field performance is a direct driver of card demand. S-score is null for pre-debut prospects and college players — the composite rebalances when S-score is absent (see Prospect Window below).

**Sources by sport:**

| Sport | API | Cost |
|---|---|---|
| NBA | balldontlie.io | Free |
| NBA (deeper) | sportsdata.io | Paid |
| College / WNBA | ESPN public endpoints | Free |
| MLB / NFL | TBD | TBD |

**Key metrics:** PPG/ERA/etc., recent game log trend vs season average, injury status

Injury status → auto-drafts a pending Risk Flag for admin review (never auto-publishes).

---

#### Layer 3 — Social Buzz (P-score, weight 0.15)

*Are people talking about this player, and is it positive?*

**Sources:**

| Source | Cost | Signal |
|---|---|---|
| Reddit API | Free | r/sportscards + sport subs — hobby-specific sentiment |
| X / Twitter API | ~$100/mo | Mention volume + engagement |
| NewsAPI | $0–$449/mo | Media mention volume |

**MVP recommendation:** Reddit only. Free, hobby-specific, good signal-to-noise for card demand specifically. Google Trends was previously considered but is too broad and noisy for player-level card signal.

---

#### Layer 4 — Breakerz Editorial (B-score, weight 0.15 via `breakerz_score`)

*What does the Breakerz team think is about to happen?*

Permanent human-curated layer. Coexists with automation forever — it captures what no API can: breaker conversations, insider chatter, pattern recognition, upcoming YouTube drops.

**Input mechanism:** Breakerz Bets Debrief (✅ built)
- Admin pastes a market narrative in natural language
- Claude parses against the product's full player roster, fuzzy-matches names (e.g., "Wemby" → "Victor Wembanyama")
- Returns suggested scores (-0.5 to +0.5) and drafted reason notes for admin review
- Admin edits scores/notes, checks/unchecks players, clicks "Apply"
- Writes to `breakerz_score` and `breakerz_note` on `player_products`

**Score range: -0.5 to +0.5** — editorial opinion modifies the signal, doesn't dominate it.

**Consumer label:** "Breakerz Bets" — displayed as a distinct callout in Breakerz Sayz with the reason note. Not an algorithm output. The team's read, attributed to the team.

---

### The Icon Tier

Some players exist beyond the reach of a normal scoring model — structural sticking power that doesn't cycle like normal buzz. **Wemby. Ohtani. Judge. LeBron.**

For these players, a buzz multiplier misrepresents the situation. Their elevated demand is not a phase — it's the baseline. The `is_icon` flag skips the buzz multiplier entirely and instead surfaces a consumer callout: *"This is a generational player — our model's baseline doesn't fully capture their structural demand."*

**Engine behavior:** `is_icon = true` → skip `buzz_score`/`breakerz_score` multiplier. EV comps already reflect their true floor.

**Admin UI:** `is_icon` checkbox on the player management page. Short list — 10–20 players globally.

---

### Player Risk Flags

Separate from buzz_score entirely. Disclosure layer, not a scoring adjustment — equivalent to a fantasy sports injury report.

The engine does not change slot costs based on Risk Flags. They surface information and let the buyer decide.

**Schema:** `player_risk_flags` table (player-level — an injury applies across all products)

| Field | Type | Values |
|---|---|---|
| `type` | TEXT | `injury` / `suspension` / `legal` / `trade` / `retirement` / `off-field` |
| `severity` | TEXT | `low` / `medium` / `high` |
| `note` | TEXT | 1–2 factual sentences, no speculation |
| `is_active` | BOOLEAN | Clear when resolved |

**Phase 2:** Stats API injury status → auto-drafts pending flag → admin approves before publishing. Human always in the loop on Risk Flags.

---

### High Volatility Tag

Uncertainty signal — not negative, not positive. *"Expect large price swings in either direction."* Different from a Risk Flag (which has a known cause). High Volatility may have no identified cause.

Lives on `player_products` (not `players`) because volatility is product/card-specific.

**Phase 2 auto-detection:** C-score price spread > 3× 30-day baseline → pending admin review.

**Default for top prospects on pre-release products** — tag them High Volatility until the market establishes.

---

### Prospect and Draft Window

S-score is null for pre-debut players. The composite rebalances:

| Player type | buzz_score composite |
|---|---|
| Established pro | C × 0.45 + S × 0.25 + P × 0.15 |
| Rookie (debut season, < 20 games) | C × 0.55 + P × 0.20 (S downweighted) |
| Draft pick / college (pre-debut) | C × 0.60 + P × 0.40 (S excluded) |

Prospects often have the highest P-score of anyone in the product — draft buzz, combine momentum, mock draft movement. The absence of S-score doesn't mean low signal; it means different signal. Claude's Breakerz Sayz prompt should know which regime it's in and frame the analysis accordingly.

---

## Schema

### Deployed

```sql
-- player_products
buzz_score      FLOAT DEFAULT NULL  -- automated composite output (-0.9 to +1.0)
breakerz_score  FLOAT DEFAULT NULL  -- editorial B-score (-0.5 to +0.5)
breakerz_note   TEXT  DEFAULT NULL  -- reason note, required when breakerz_score is set
```

Migrations: `20260324180000_add_buzz_score.sql`, `20260324200000_add_breakerz_bets.sql`

### Still Needed

```sql
-- players
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_icon BOOLEAN DEFAULT FALSE;

-- player_products
ALTER TABLE player_products ADD COLUMN IF NOT EXISTS is_high_volatility BOOLEAN DEFAULT FALSE;

-- Risk flags (player-level, not product-specific)
CREATE TABLE player_risk_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- injury | suspension | legal | trade | retirement | off-field
  severity    TEXT NOT NULL,    -- low | medium | high
  note        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Architectural Gap: No Component Score Columns

Currently `buzz_score` is a single field. Once the automated pipeline runs, there's no way to audit what drove the composite — was it C-score? P-score? Both? Consider adding `c_score`, `s_score`, `p_score` as separate columns for transparency and debugging, then have the pipeline write the composite to `buzz_score`. Decision needed before Phase 4.

---

## Implementation Order

Sequenced by value delivered vs. build complexity. Each phase is independently shippable.

---

### Phase 1 — Wire Up What's Already in the DB
**Effort:** 1 day | **Value:** Breakerz Bets actually affects slot costs and Sayz output

The `breakerz_score` data is collected but inert. This phase makes it real.

**1a. Engine reads `breakerz_score`**
- `lib/engine.ts`: update formula to `hobbyWeight = hobbyEVPerBox × (1 + clamp(buzz_score + breakerz_score, -0.9, 1.0))`
- `app/api/pricing/route.ts`: add `breakerz_score, breakerz_note` to player_products select
- `app/api/analysis/route.ts`: same select update + pass to Claude prompt

**1b. Breakerz Sayz surfaces Breakerz Bets callout**
- When any player on the selected team has `breakerz_score != null`, show a distinct "Breakerz Bets" block in the result card
- Display the player name + reason note
- Pass to Claude prompt: `"Breakerz Bets on [player]: [note]"` so the AI narrative can reference it

**Files:** `lib/engine.ts`, `app/api/pricing/route.ts`, `app/api/analysis/route.ts`, `app/analysis/page.tsx`

---

### Phase 2 — Icon Tier
**Effort:** 1 day | **Value:** Correct handling of structurally anomalous players

**2a.** Migration: `is_icon BOOLEAN` on `players`
**2b.** Engine: `is_icon` guard — skip buzz multiplier when true
**2c.** Admin: `is_icon` checkbox on player management page (`/admin/products/[id]/players`)
**2d.** Breakerz Sayz: icon callout in result card + Claude prompt note
**2e.** `app/api/pricing/route.ts`: include `player.is_icon` in select

**Files:** migration, `lib/engine.ts`, `app/api/pricing/route.ts`, player management page, `app/analysis/page.tsx`, `app/api/analysis/route.ts`

---

### Phase 3 — Risk Flags + High Volatility
**Effort:** 2 days | **Value:** Consumer disclosure for events the model can't score

**3a.** Migrations: `player_risk_flags` table + `is_high_volatility` on `player_products`
**3b.** Admin: risk flag add/edit/clear UI on player management page
**3c.** Admin: `is_high_volatility` toggle on player management page
**3d.** Breakerz Sayz: risk flag banners (red ⚑) + high volatility advisory (⚡) in result card; pass flags to Claude prompt
**3e.** Break page Team Slots: flag icon on team row + player row tooltip

**Files:** 2 migrations, player management page, `app/api/analysis/route.ts`, `app/analysis/page.tsx`, `components/breakerz/TeamSlotsTable.tsx`

---

### Phase 4 — Consumer Buzz Indicators (Break Page)
**Effort:** 0.5 days | **Value:** Buzz signal visible on break page, not just Sayz

**4a.** Team Slots table: show up/down arrow on rows where effective score > 0.1 or < -0.1
**4b.** Team Slots table: show icon badge for icon-tier players
**4c.** Player table: buzz indicator badge, icon badge, high volatility ⚡ badge

**Files:** `components/breakerz/TeamSlotsTable.tsx`, `components/breakerz/PlayerTable.tsx`
**Dependency:** Phases 1–3 must be complete (needs the data to display)

---

### Phase 5 — C-score: CardHedger Top-Movers
**Effort:** 2–3 days | **Value:** First automated market signal — no external API key needed

**5a.** Add `top-movers` and `price-updates` endpoints to `lib/cardhedger.ts`
**5b.** Decide: store C-score in separate `c_score` column or write directly to `buzz_score`
**5c.** Vercel Cron job (daily): fetch `top-movers`, cross-reference against `player_product_variants.cardhedger_card_id`, compute normalized C-score per player, write to DB
**5d.** `price-updates` delta poll (every 6h): detect cards with price swing > threshold → create pending High Volatility review record
**5e.** Admin: pending High Volatility review queue

**Gap:** Need to confirm with Kyle whether `top-movers` includes enough volume data to normalize against a player's own baseline, or just gives a relative rank. If it's rank-only, normalization strategy changes.

**Files:** `lib/cardhedger.ts`, new cron route (`app/api/cron/update-scores/route.ts`), Vercel cron config

---

### Phase 6 — P-score: Reddit Sentiment
**Effort:** 2–3 days | **Value:** Hobby-specific social signal

**6a.** Reddit API integration — query r/sportscards + sport-specific subs for player mentions
**6b.** Mention extraction + volume count per player vs rolling 30-day baseline
**6c.** Normalize to P-score scale
**6d.** Combine with C-score into `buzz_score` composite in the cron job

**Gap:** Reddit API rate limits for a large roster scan need to be evaluated. May need to prioritize players (e.g., only score players in active products).

---

### Phase 7 — S-score: Player Stats API
**Effort:** 3–5 days (per sport) | **Value:** Performance trend signal; injury → Risk Flag automation

**7a.** NBA first: integrate balldontlie.io (free tier)
**7b.** Compute recent performance trend (last 7 days vs season avg) → S-score
**7c.** Injury status → auto-draft Risk Flag pending record → admin review queue
**7d.** Prospect/draft pick detection: if `is_rookie` and games < 20, downweight S-score in composite
**7e.** Add other sports as products expand

**Gap:** No `player_type` or `debut_date` field exists to distinguish "draft pick (pre-debut)" from "rookie (debut season)." Will need either a field on `players` or a heuristic based on game count from the stats API.

---

## Open Questions

1. **Score decay:** Should `buzz_score` auto-decay toward 0.0 between pipeline runs (e.g., -20% per day without a refresh)? Or persist until overwritten? Daily pipeline runs may make this moot.
2. **Component score columns:** Store `c_score`, `s_score`, `p_score` separately for auditability, or just write composite to `buzz_score`? Separate columns are better for debugging but add schema complexity. Decide before Phase 5.
3. **Breakerz Bets decay:** `breakerz_score` has no expiry. Should a B-score set today still be active in 3 months? Need a `breakerz_score_set_at` timestamp and a decay or expiry policy.
4. **Transparency to buyer:** When fair value is influenced by `buzz_score` or `breakerz_score`, should Breakerz Sayz show the "baseline" fair value (without adjustments) alongside the adjusted value? Lets the buyer see how much signal moved the number.
5. **Icon process:** Who decides icon status? What are the criteria? Suggest: admin-only designation, requires approval from both Brody and Kyle, reviewed once per product cycle.
6. **Risk flag style guide:** Notes appear on a consumer-facing product. Need to define: past tense, factual, no speculation, include source/date in parentheses. E.g., *"Suspended 80 games for PED violation (MLB, March 2026)."*
7. **Controversy vs. cold:** A scandal player may have negative Risk Flag but positive market demand (dark curiosity buying). How do we display when buzz and flag conflict? Likely: show both, let Claude contextualize in the narrative.
8. **`breakerz_score` in the pricing API:** The `/api/pricing` GET endpoint (used by the break page) should also include `breakerz_score` in the player data so the engine on the break page benefits, not just Breakerz Sayz.

---

## What We're Not Building

- A public social leaderboard or trending feed
- Real-time data — daily/6h refresh is sufficient; this is directional signal, not a ticker
- A pure sentiment product — sentiment is one input among four
- Icon status as a promotional feature — it's a model correction flag

---

## Success Criteria

- **Phase 1:** A Breakerz Bet set via the debrief UI visibly shifts that player's team slot cost on the break page and changes the Breakerz Sayz fair value.
- **Phase 3:** Admin can flag a player as injured in under 60 seconds. The flag appears in Breakerz Sayz output for that team.
- **Phase 5:** C-score updates automatically once daily. A player appearing in CardHedger's top-movers surfaces a measurable positive buzz_score within 24 hours.
- **Phase 7:** An NBA injury detected via stats API auto-drafts a Risk Flag for admin review within 24 hours.

---

## Key Files

| File | Role |
|---|---|
| `lib/engine.ts` | Pricing formula — reads `buzz_score` + `breakerz_score` |
| `app/api/pricing/route.ts` | Select includes `buzz_score`, `breakerz_score`, `breakerz_note` |
| `app/api/analysis/route.ts` | Breakerz Sayz — passes social signals to Claude prompt |
| `app/analysis/page.tsx` | Breakerz Sayz consumer UI |
| `app/admin/products/[id]/BreakerzBetsDebrief.tsx` | B-score conversational input ✅ |
| `app/api/admin/parse-bets-debrief/route.ts` | B-score Claude parser ✅ |
| `lib/cardhedger.ts` | CardHedger API client — needs top-movers + price-updates |
| `components/breakerz/TeamSlotsTable.tsx` | Break page team rows — needs buzz indicators |
| `components/breakerz/PlayerTable.tsx` | Break page player rows — needs buzz indicators |
| `supabase/migrations/` | All schema changes |

---

## Dependencies

- **Phase 1:** No new dependencies — all data already in DB
- **Phase 2:** No new dependencies
- **Phase 3:** No new dependencies
- **Phase 5:** Kyle to confirm `top-movers` response structure and whether volume normalization is possible; Vercel Cron enabled on project
- **Phase 6:** Reddit API key
- **Phase 7:** Sports stats API key (balldontlie.io for NBA is free; others TBD)
