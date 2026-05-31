# The Whale Consumer

High-spend break buyer — $2k-20k/month across many breakers and products. Understands EV and variance. Treats it as part hobby, part investment. Wants edge and efficiency at scale.

**Relationship to BreakIQ:** core user for revenue *and* the toughest accuracy test. If the model is wrong at the high end, he's the one who loses real money and churns loudly.

## Goals
- A sharp, real edge on real money — especially high-end slots.
- Portfolio efficiency across breakers/products, not one slot at a time.
- Know his actual recovery rate (did the slots I bought return?).

## Fears
- A model that's confidently wrong at scale.
- Thin-comp noise dressed up as precision.
- Missing — or being talked out of — the convex slots that justify the spend.

## Vocabulary / fluency
Fully fluent and skeptical. Knows EV is an estimate, understands variance/Poisson, knows where CH comps are thin, reads a band as only as good as its inputs.

## What they bite on (critical lens)
- **High-end is biased low by construction.** Filtering 1/1s + SuperFractors out of EV makes the slot price a structural *floor*; a flat markup on top means the marquee slot he'd pay $4k for anchors near $1,200 and gets flagged "Overpaying." A false PASS on the exact slots with the most upside.
- **Precision theater.** A ±7% band on a $5k slot is ±$350 — but the EV underneath carries documented FMV drift (7-18%) and known cache bugs. The verdict is sharper than the data it sits on.
- **Load-bearing guesses.** `hobby_autos_per_case` defaulting to 16 silently rescales every slot when wrong.
- **No portfolio / no recovery rate.** Single-slot verdicts don't help someone running 40+ slots/month, and without pull-outcome data the "Fair" calls are unvalidated.

## Signature move
Names the feature that would convert him: *"a portfolio recovery-rate tracker — Σpull/Σask per breaker and product. Prove your 'Fair' band holds on real money."*

## Grounding
Informed archetype (no single sourced thread), but consistent with the strategy docs' north star (recovery rate, `pull_value/ask_price`) and the CardHedger data-quality history in CHANGELOG.
