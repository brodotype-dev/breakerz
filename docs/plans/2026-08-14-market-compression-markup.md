# PRD — Market Compression Markup

**Status:** Implemented flag-gated (2026-08-14), `compression_markup_enabled` = OFF in prod. Flip on after live validation.
**Owner:** Brody · **Source:** 2026-08-14 Kyle calls + [docs/breaker-markup-validation.md](../breaker-markup-validation.md)

## Problem
Our slot prices allocate a break's cost across teams/players **in proportion to EV share**, then apply a **flat** markup (`MARKET_MARKUP_BY_LIFECYCLE`, e.g. 1.20× live) uniformly to every slot. But the live-break market doesn't price that way.

Validated against 10 full-break `/break-price` captures (7 products): the market prices slots **flatter than EV** in 8/10 breaks.

| Team size (by our EV) | Share of observed asks | Share of our EV | Asks ÷ EV |
|---|---|---|---|
| Big (top third) | 4.2% | 6.3% | **0.67×** |
| Mid | 2.3% | 1.5% | 1.49× |
| Small (bottom third) | 2.2% | 0.9% | **2.36×** |

Breakers **floor small spots** (they'll run a small team near break-even to move it) and **dampen the top** (it sells anyway), carrying the margin on the big spots. Kyle's Fanatics number: the floor for small spots ≈ **case-cost-share + ~10%**. Net effect: our flat markup is "close on big spots, materially over on small spots."

## The change
Replace the flat per-slot markup with a **compression curve** that reallocates the *same total* markup across a break's slots — small spots up, big spots down — so displayed slot prices match observed breaker behavior.

**Math (power compression, total-conserving).** For a break with slots of model cost `c_i`, let `s_i = c_i / Σc` be the EV share. Apply a per-slot effective markup:

```
perSlotMarkup_i = M · s_i^(γ − 1) / Σ_j s_j^γ
```

where `M` is the flat lifecycle markup and `γ` is the compression exponent.
- `γ = 1` → identity (exactly today's flat markup).
- `γ < 1` → compresses: small shares get lifted, big shares dampened.
- Conserves the total: `Σ (c_i · perSlotMarkup_i) = M · Σc`. **The break's overall ask (and margin) is unchanged — only the distribution shifts.**

**γ choice.** The data implies `γ ≈ 0.35` (from big Asks÷EV 0.67 vs small 2.36 across a ~7× EV-share spread). We ship **`γ = 0.5`** as a moderate starting point (less aggressive than the raw fit) and tune toward the data via Market Delta once live. Single tunable constant in [lib/market-markup.ts](../../lib/market-markup.ts).

## Scope (deliberately narrow + safe)
- **Display layer only.** Compression is a within-break reallocation on the `/break/[slug]` **Team Slots** and **Player** tables. It needs the full slot set, which only those tables have.
- **Unchanged:** the pricing engine, `pricing_cache`, the math-layer lifecycle EV multiplier, and the **bundle verdict** (`runBreakAnalysis` → `marketFairValue`). Because compression conserves each break's total, the bundle number is identical with the flag on or off — only per-slot prices move.
- **Flag-gated:** `feature_flags.compression_markup_enabled` (default OFF). Off → byte-for-byte identical to today (γ=1). Read server-side on the break page, passed to the tables as `compressionGamma`.

## Known limitation — player-drawer audit view
The "Why this price?" drawer (`PlayerDetailDrawer` / `WhyThisPriceCard`) keeps the **flat** markup in v1 — it decomposes a single slot's price and has no cross-slot set to compress against. So with the flag on, a player's price in the table (compressed) can differ slightly from the drawer's final number (flat). Acceptable while the flag is off; revisit when validating (pass the player's compressed markup into the drawer).

## Known limitation — premium-hoops exception
2 of 10 breaks (Cosmic Chrome Basketball, Cactus Jack) showed the **opposite** — the market slightly *amplifies* the top, driven by a singular marquee-rookie chase (Flagg/Wemby). A single global `γ < 1` mis-compresses those. Accepted for v1 (they're the minority and the effect is small); **per-product γ override** is the follow-up once we have more captures per product.

## Rollout
1. Ship flag-gated OFF (this PR). Zero consumer change.
2. Flip `compression_markup_enabled` on via SQL; eyeball a few break pages vs. known breaker asks.
3. Tune `COMPRESSION_GAMMA` toward the data (~0.35) using Market Delta Section 2 (`/break-price` captures) — the same source that validated the pattern.
4. Later: per-product γ (amplify for premium hoops with a singular chase).

## Risk
- Reallocation, not inflation — total ask per break is conserved, so no across-the-board price shift. Worst case if γ is mis-tuned: small spots slightly over/under, correctable by one constant.
- Kill switch is the feature flag (60s cache, no deploy).

## Downstream docs updated
- [CHANGELOG.md](../../CHANGELOG.md) — dated entry.
- [CLAUDE.md](../../CLAUDE.md) — Current State entry + docs index.
- [lib/market-markup.ts](../../lib/market-markup.ts) — the `compressionMarkups()` fn + `COMPRESSION_GAMMA` live here alongside the existing Plan B/C markup layers.
- [docs/breaker-markup-validation.md](../breaker-markup-validation.md) — the evidence this is built on.
