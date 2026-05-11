# Card Ladder vs. BreakIQ — Pricing Methodology Comparison

**Source docs (this folder):**
- `cardladder-value-player-indexes-price-modeling.pdf` — core "Card Ladder Value" methodology
- `cardladder-grade-ratio-value.pdf` — fallback for stale cards using cross-grade ratios
- `cardladder-12-rules-search-queries.pdf` — user-facing search syntax (not pricing; ignore for algorithm work)

**Date:** 2026-05-09. Written after Kyle shared CL's public methodology docs.

---

## What Card Ladder is solving

CL is a sales-history database for individual cards. Their core deliverable is *"what is this single card worth today?"* — even if it hasn't sold in months. They have no concept of a break, slot pricing, pull odds, or social currency.

## What BreakIQ is solving

We're solving *"what should a Wemby slot in this product cost for a hobby/BD/jumbo break?"* That requires: per-card EV → variant-level EV via odds → sets-weighted player rollup → social-currency modulation → slot share of break cost.

The two products overlap on exactly **one** sub-problem: estimating a single card's value when sales data is thin. Everything else is parallel — they don't have to do, and we shouldn't copy.

---

## Card Ladder's three building blocks

### 1. Player Index (their "stock index" for a player)

```
Index = Σ(last_sold of every card of player) / (count_of_cards × divisor)
```

- Recalculated nightly.
- Cards excluded unless they have ≥2 sales in the last year AND ≥1 in the last 6 months.
- A "divisor" (S&P-style) absorbs the discontinuity when a new card prints its first sale, so the index doesn't jump for non-market reasons.
- Initial divisor normalizes day-1 value to $1,000.

### 2. Card Ladder Value (rolling individual cards forward via the index)

For a specific card that has at least one historical sale:

```
Ratio              = card_last_sold_price / player_index_on_that_date
Suggested_Price    = Ratio × today's_player_index
```

Confidence buckets, by age of `last_sold`:
- Level 5: ≤ 2 weeks
- Level 4: 2 weeks – 1 month
- Level 3: 1–3 months
- Level 2: 3–6 months
- Level 1: > 6 months

The bet: a card and its player's market move in sync, so even a stale card can be priced by riding the index.

### 3. Grade Ratio Value (cross-grade fallback)

When a card hasn't sold in over a year, look at the **same card in a different grade** that *did* sell recently:

```
Grade_Ratio        = old_PSA10_price / old_BGS9.5_price   (from when both sold within 6mo of each other)
Grade_Ratio_Value  = Grade_Ratio × recent_comp_grade_price
```

Tiebreak: prefer highest grade as the comparison anchor (less volatility, better liquidity).

---

## How BreakIQ does it today

We don't model individual card price histories. We pull live aggregate sales data from CardHedger and assemble it ourselves.

**Per-card EV (lib/pricing-refresh.ts):**
1. For each CH `card_id`, fan out three parallel `batchPriceEstimate` calls — Raw / PSA 9 / PSA 10.
2. Assemble:
   - `evMid  = psa9_price ?? raw_price`
   - `evLow  = raw_price ?? evMid × 0.35`
   - `evHigh = psa10_price ?? evMid × 2.5`
3. Cache in `ch_price_cache` by `cardhedger_card_id` (24h TTL, written incrementally per chunk so timeouts never blow away progress).

**Per-player rollup:**
- Variants weighted by `1/odds` (when present), aggregated as sets-weighted EV across priced variants.
- Variants with `print_run ≤ 1` excluded from the rollup so a single SuperFractor sale can't dominate the slot.
- Confidence: sales-weighted average of CH per-card confidence values across the player's priced variants. Surfaced as a `low conf` chip when < 0.5.

**Tier ladder (when batch-price-estimate returns nothing):**
1. `searchAndComputeEV` (CH search-cards rung)
2. `get90DayPrices` aggregate for the player
3. Hard-coded floor: `evMid = 15` for rookies, `8` for veterans

**Slot pricing (lib/engine.ts):**
```
effectiveScore = clamp(buzz + breakerz + risk_adj + hype_adj, -0.9, 1.0)   [0 if is_icon]
hobbyWeight    = hobbyEVPerBox × (1 + effectiveScore)
slotCost       = breakCost × hobbyWeight / Σ hobbyWeights
```

CL has nothing analogous. This layer is purely BreakIQ's domain.

---

## Side-by-side on the shared problem (single-card valuation)

| Dimension | Card Ladder | BreakIQ |
|---|---|---|
| Source of truth | Their own scraped sales DB (10+ years) | CardHedger (live API) |
| Refresh cadence | Nightly index recalc | 24h TTL per CH card; nightly cron + on-demand admin button |
| Stale-card handling | Roll forward via player index OR cross-grade ratio | Fall through to `evMid × 2.5` (PSA 10) / `× 0.35` (raw), or $8/$15 floor |
| Confidence model | 5 buckets by `last_sold` age | 0..1 sales-weighted average from CH |
| Per-grade model | Tracks every grade independently; ratios are observed | Synthesizes Raw/PSA 9/PSA 10 via real prices when CH has them; multipliers ONLY as last resort |
| Treatment of 1/1s | Included in index (with divisor adjustments) | Excluded from per-player rollup (kept at variant level only) |

---

## Should we adopt anything?

### ❌ Player Index (don't build)

We'd duplicate what CardHedger already does internally. We don't have 10 years of vetted sales history; CH does. Adding a derived index on top of CH would just smear CH's signal without adding our own. The pre-release surface is the only place we currently lean on player-aggregate data, and CH's `total-sales-by-player` already covers that need.

### ⚠️ Index-rolled-forward pricing for stale cards (worth a small experiment)

The genuine insight: *when a single card hasn't sold in months but its player's aggregate market has moved, our `× 2.5` and `$8 / $15` fallbacks are crude.* CL's approach — pin a stale card's price ratio against the player index, then roll it forward — would be measurably better than a flat multiplier.

**Practical implementation (P2/P3, not now):**
- Pull CH's player-level price history (we already use `get_top_movers` and `get_total_sales_by_player`).
- Insert a new tier in `lib/pricing-refresh.ts` between the search rung and the hard-coded floor: if CH gave us a stale-but-real price for this card_id at some point, multiply that price by `today_player_aggregate / past_player_aggregate` instead of falling to `$8`.
- Keep the floor as the very last resort.

This is a tier ladder addition, not a rewrite. Self-contained. Reverts cleanly if it doesn't pan out.

### ✅ Grade Ratio Value (genuinely better than what we do — investigate)

Our `evHigh = evMid × 2.5` and `evLow = evMid × 0.35` are population averages. They're often wrong: low-end commons have flatter grade curves, chase parallels and rookies have steeper ones. CL's idea — use the *card's own* historical PSA 10:Raw ratio when available — directly fixes this.

**The unknown:** does CardHedger expose pair-wise per-grade history for a single card in one call? `get_comps` and `get_price_history` are candidates. If yes, this is a real, low-risk improvement. If no, the data engineering cost may not justify it.

**Action:** add to `docs/cardhedger-questions.md` and `docs/plans/2026-05-06-cardhedger-data-audit.md` punch list. Probe `get_comps` + `get_price_history` for what they return per grade, then decide.

The dollar improvement is biggest on chase parallels — which is exactly where wrong slot pricing hurts most.

### 🟡 Confidence display polish (cheap)

CL's 5 named buckets are easier for collectors to reason about than our 0..1 number. We have the data; we just don't bucket it. Worth bucketing into ~3 named tiers (Strong / Solid / Stale) and surfacing on the player drawer + analysis result.

### ❌ Divisor adjustments

Solves a problem we don't have (index discontinuity when constituent cards record their first sale). Skip.

---

## Verdict

CL's methodology is well-suited to their product (card-by-card sales tracking) and bad-fit to ours (break slot pricing). But two ideas transfer cleanly:

1. **Grade Ratio Value** is the most actionable take-away. Worth investigating whether CH exposes the per-card cross-grade history we'd need. If yes, ship it as a P1 alongside the rest of the data audit.
2. **Index-rolled-forward stale-card pricing** is a nice-to-have improvement on our hard-coded multiplier fallbacks. Lower priority — only matters when CH has no recent data for a card, which is a small fraction of variants.

Everything else (player indexes, divisor math, named confidence tiers) is either cosmetic or duplicative. Don't get drawn into building infrastructure CL had to build because they don't have access to CardHedger.
