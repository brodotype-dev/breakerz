# Breaker Markup — Data Validation (Aug 2026)

**Question:** Kyle's call finding was that breakers *up-charge big spots and discount small ones* ("big spots subsidize small"). Does our data show it?

**Verdict:** The data shows the **opposite** in 8 of 10 breaks. The market prices team slots **flatter** than our EV model — small teams get a **floor** (charged *more* than their EV share), big teams get **dampened** (charged *less*). Our engine is too top-heavy vs. what breakers actually charge.

## What the data says
10 full-break captures (26–32 teams each), 7 products, May–Jun 2026, from `/break-price` competitor listings. For each break we compared each team's **share of observed asks** to its **share of our EV**:

| Team size (by our EV) | Share of asks | Share of our EV | Asks ÷ EV |
|---|---|---|---|
| **Big** (top third) | 4.2% | 6.3% | **0.67×** — under-charged |
| Mid | 2.3% | 1.5% | 1.49× |
| **Small** (bottom third) | 2.2% | 0.9% | **2.36×** — over-charged / floored |

Monotonic. Big teams are charged ~⅔ of what pure EV-share implies; small teams ~2.4×. The ask curve is compressed toward the middle.

## Consistency
- **8 of 10 breaks** show this compression — every baseball + Bowman capture, plus Chrome Basketball and Chrome Football.
- **2 exceptions** slightly *amplify* the top (Kyle's direction): **Cosmic Chrome Basketball** and **Cactus Jack** — both premium hoops with a singular marquee-rookie chase (Flagg/Wemby). The headline 1/1 likely pulls the top team up.

## What it means for the engine
Our slot price = EV-proportional allocation + a **flat** markup, so it over-weights big spots. The correction is **compression, not amplification**:
1. **Floor** small-team / small-player slots — the biggest, most consistent miss.
2. **Dampen** the top slightly.
3. *Optional:* a **marquee premium** only on premium basketball with a singular chase.

## Caveats (signal, not gospel)
- Baseline is **our** EV (current `pricing_cache`) vs. May–Jun asks — EV has drifted since; direction is solid, exact magnitudes are soft.
- "Market floors small spots" vs. "our model under-prices small spots" give the same residual — but the fix (raise small, lower big) is the same either way.
- n = 10 breaks / 7 products. Enough to see direction; re-run as captures grow.

## Recommendation
If we build a markup curve, model **compression** (floor + top-dampen) keyed on EV share — **not** the amplify-big curve the call assumed. Cheap to prototype in the display-markup layer (`lib/market-markup.ts`). Validate against fresh captures per product before hard-coding, since premium hoops may want the opposite tweak.
