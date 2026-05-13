# North Star Metric + Feedback Loop — Measuring Whether BreakIQ Actually Works

*Strategy doc. Audience: future-Brody, Kyle, any contributor joining the project. Meant to be re-read, debated, refined as understanding deepens.*

*First draft: 2026-05-12, prompted by a text thread between Brody and Kyle pressure-testing the question "how do we objectively quantify if something is a good deal or not?"*

---

## The honest problem statement

BreakIQ outputs slot prices, EV multiples, BUY/WATCH/PASS verdicts. The engine has dozens of tunable constants — prospect rank tiers, freshness premiums, market markups, cascade caps, per-sport multipliers. Every constant is a hypothesis about how the world works.

**We have no closed-loop way to know if those hypotheses are right.**

The output of our model is a price. The user pays a price. The break happens. Cards get pulled. And then the feedback ends — we never observe the actual cards, never compute "did our prediction match what came out of the box," never feed that signal back into the model. We are tuning a piano with the lid closed.

This isn't a small gap. It means every model-improvement we ship — Track A prospect_score, Track B cascading sentiment, freshness multiplier, anchor strategies, grade ratio value — has been **hypothesis-driven, not measurement-driven.** We can prove the engine is internally consistent. We cannot prove it is correct.

---

## Kyle's mental model (the right place to start)

In the 2026-05-12 thread, Kyle described how he personally evaluates whether to buy into a break:

> "I would objectively quantify buying into a break if I feel that I can make my money back, or at least make 50% back. I can gauge based on projected resale value of that player or team."

This is the right north star to chase, because:

1. **It's user-centric.** It measures whether the breaker walks away whole, not whether our model is internally pretty.
2. **It's quantifiable.** `total_pull_value ÷ ask_price = recovery_ratio`. Threshold values are conversation-able ("we hit ≥0.5 in 65% of breaks last month").
3. **It's testable against ground truth** — IF we can observe actual pulls. Which we can't, yet.
4. **It's the metric a breaker would describe in their own words.** No translation layer between user value and our success measure.

Kyle's "inherent risks" point in the same thread is equally important:

> "...subject to increase based on the level of gambling that you're doing by opening up a random pack."

He's pointing out that **the engine's point estimate is one sample from a distribution**. A slot we price at $245 might pull $400 of cards or $50 of cards depending on what cracks. No model output should be evaluated as "did this exact slot equal exactly its predicted value" — only as "did the predicted distribution capture the actual outcome over many breaks."

This means our success metric has to handle variance, not pretend it away.

---

## What we measure today, and why it's not enough

The current set of dashboards and tables measures **system health and engagement**:

- CH sales data quality (matched-variant rate, pricing-cache freshness)
- Variant matching coverage (% of checklist variants linked to a CH card_id)
- User engagement (pricing_feedback rows, my_breaks created, analyses run)
- Self-reported outcomes (`user_breaks.outcome` ∈ {Win, Mediocre, Bust})

These are useful for **operations**. They tell us if the pipeline is broken, if users are clicking around, if matches are coming in clean.

None of them tell us **if the model is right.**

Self-reported `outcome` comes closest, but:
- It's a 3-bucket subjective label, not a dollar quantity
- It's self-selected (only users who log breaks contribute)
- It conflates "the slot was correctly priced" with "I happened to pull well/poorly"
- There's no way to back into a recovery ratio or calibration error from it

We've been *acting* like these are success metrics because we have nothing else. They're not.

---

## Candidate metrics, ranked by honesty

Four reasonable candidates. Each is honest about a different thing. They're not mutually exclusive — a mature system tracks all four.

### 1. EV Calibration Error *(the model-honesty metric)*

For every slot we priced, when an actual outcome is observed, compute:

```
calibration_error = (observed_pull_value − predicted_ev) ÷ predicted_ev
```

**North-star form:** median |calibration_error| across all observed breaks, target ≤ 25% over a 6-month rolling window.

- **What it measures:** Is our model pricing reality?
- **Strength:** Pure model quality. Independent of user behavior.
- **Weakness:** A calibrated model can still recommend bad decisions if the price ranges users are paying are themselves above EV.

### 2. Recovery Rate Per User *(Kyle's mental model, operationalized — the recommended north star)*

For every break a user completes and logs:

```
recovery_ratio = total_pull_value ÷ ask_price
```

**North-star form:** % of logged breaks where `recovery_ratio ≥ 0.5` over a 6-month rolling window. Stretch goal: % at `≥ 1.0` (made-money-back).

- **What it measures:** Are users walking away whole when they follow our recommendations?
- **Strength:** Speaks the breaker's language. Directly measures product-market value.
- **Weakness:** Requires pull data. Self-selected (users who log are not the average breaker). Doesn't isolate our influence from luck.

### 3. Verdict Accuracy Rate *(decision-quality metric)*

For every BUY signal, when an outcome is observed, did the recovery_ratio beat the threshold? Same for WATCH (neutral) and PASS (would have lost money if taken).

**North-star form:**
- BUY signals → recovery_ratio ≥ 0.5 in ≥ 70% of observed breaks
- PASS signals → recovery_ratio < 0.5 in ≥ 60% of breaks where the user broke anyway despite the PASS

- **What it measures:** Is following our advice better than not?
- **Strength:** Most direct measure of recommendation usefulness.
- **Weakness:** Counterfactual problem — can't observe what would have happened without BreakIQ. Requires the user to share their decision PLUS their outcome.

### 4. Confidence-Calibrated Outcome Coverage *(the sophisticated variance-honest metric)*

We predict a recovery RANGE with a confidence band (e.g., "expected recovery 60-95%, 80% confidence"). For every observed break, did the actual recovery fall within the predicted band?

**North-star form:** % of observed recoveries falling within the 80% confidence band, target ≥ 75% (slightly below the band's nominal coverage because tails are messy).

- **What it measures:** Are we communicating uncertainty honestly?
- **Strength:** Addresses Kyle's "level of gambling" point head-on. Forces us to publish ranges, not point estimates.
- **Weakness:** Harder to explain to users. Requires the engine to output ranges, which we don't today.

---

## The recommended framing

### North star: **Recovery Rate Per User** (Metric 2)

This is the metric that means something to a breaker. It's what Kyle said in his own words. It's the version of "is BreakIQ working?" that doesn't require a translator. Every other metric is in service of moving this one.

### Operational metric: **EV Calibration Error** (Metric 1)

This is the metric we can compute fastest once pull data starts flowing. It tells us if the model is converging on reality regardless of user behavior. It's the engine team's daily dashboard.

### Communication metric (deferred): **Confidence-Calibrated Outcome Coverage** (Metric 4)

The right way to talk to users honestly. Not the day-one goal, but the right destination for the UI. Move from point estimates to ranges.

### Diagnostic metric: **Verdict Accuracy Rate** (Metric 3)

The investor / collaborator pitch metric. "When we say BUY, here's what's happened in observed breaks." Powerful but data-intensive, so it follows the others.

---

## The data gap that has to close

All four metrics depend on observing what cards were actually pulled. Without that data, we can compute none of them.

There are three plausible paths to get this data, in increasing order of leverage:

### Path A — Self-reported pull capture in My Breaks *(near-term, cheap, biased sample)*

Extend the existing My Breaks UI: when a user marks a break as `completed`, prompt them to log what they pulled. Could be:

- Manual entry (player name + variant) — slowest, most accurate
- Photo upload + Claude OCR — friction-light, error-prone, fixable
- Bulk paste from breaker's "card list" message — works for some platforms

Each logged pull gets CH-priced; we sum to a total `pull_value`; we compute `recovery_ratio`.

The dataset is self-selected (only the users who care enough to log), but it's a real first dataset. The bias is knowable — we'd compare logged-user demographics to all-user demographics and adjust.

### Path B — Breaker partnership *(medium-term, scaling)*

Convince 2–3 breakers to share their pull logs in exchange for analytics insights or co-branding. Whatnot and Fanatics Live may not have public APIs, but breakers themselves keep manifest spreadsheets. A partnership-level data feed gives us unbiased pulls at scale.

### Path C — Computer-vision break replays *(long-term, ambitious)*

Stream-replay analysis: feed the YouTube/Whatnot replay of a break, OCR the pulls visible on camera, match to checklist, CH-price. Hardest engineering, biggest leverage. Probably not for v1 but worth knowing it exists as a horizon.

**The right near-term move is Path A** — it requires no external relationships, costs one feature-shipping cycle, and gives us months of useful data before we run out of self-selected users.

---

## Variance honesty is part of the strategy

Kyle's point about gambling-level variance isn't a footnote. Every observed pull is one draw from a distribution; comparing a single observation to a point estimate will look like "our model is wrong" when actually the variance is doing what variance does.

This implies two design changes that should be on the roadmap regardless of which metric we pick:

1. **Publish confidence bands, not just point estimates.** Where we show `EV $245` today, we should show `EV $245 (likely $160-340)`. The engine math to derive these bands exists — variant-level EV variance is computable from CH sales-count distribution and odds-weighted sums.

2. **Aggregate before evaluating.** Never publish a "our prediction was off" claim based on N=1. Roll up to a player's-worth of breaks, a team's-worth of breaks, a product's-worth of breaks. Aggregate observations average out the random part and isolate the systematic part — which is what we're trying to measure.

If we don't do these two things, we'll either oversell our accuracy (point estimates that look uncalibrated) or undersell our value (variance gets credited to bad models).

---

## What this means for current and future work

### For the prospect_score / cascading sentiment work in flight (docs/plans/2026-05-12...)

It's still good work. It's adding inputs to the model. But until pull data exists, we can't measure whether adding those inputs improves the model's accuracy. Treat each tuning constant as a hypothesis with a documented expected-effect. When pull data lands in 60-90 days, we'll go back and verify.

**Document hypotheses next to constants.** Instead of `PROSPECT_RANK_TIERS = [{ maxRank: 10, bump: 0.60 }]`, write `bump: 0.60 // hypothesis: a Top 10 prospect's EV should be 60% above baseline in fresh prospect products. Validate against pull data when available.`

### For the model layers we've already shipped (Plan A/B/C, productScope, etc.)

Same posture. They're working hypotheses. The freshness multiplier of 1.15 for pre-release products is a guess — a real-data feedback loop would let us tune it. Same for market markup defaults per lifecycle, anchor strategy parameters, all of it.

### For My Breaks Phase 2

This is the unblocker for every meaningful success metric in this doc. **It deserves elevated priority** — not because it's a flashy consumer feature, but because it's the single shipping change that lets us actually measure whether BreakIQ is working.

The decision of "do we elevate this to P1" is a strategic call to make explicitly, not silently defer.

### For Discord-attributed sentiment (Track B)

Kyle's intuitions captured in Track B observations become tunable parameters in their own right. When pull data exists, we can answer: "When Kyle's team_sentiment said GREAT, what was the actual recovery rate vs. when he said BAD?" Kyle's instincts become measurable, and either get rewarded with more weight or revised downward. Same audit-loop applies to Pipeline rank, hype tags, every other input.

---

## What this doesn't change

- The current model isn't broken — it's unmeasured. There's a difference. Don't gut and rebuild because we lack evidence; tune and validate as evidence accrues.
- Engagement metrics (pricing feedback, my_breaks created, analyses run) remain useful operationally. They just aren't success metrics.
- CH calibration matters separately — even before we close the loop on user outcomes, we should still track "does CH's predicted price for a card match observed eBay sales for that card?" That's a CH-quality metric, upstream from our model.

---

## Open questions to revisit

These don't have answers yet. Revisit when we have more signal:

1. **Threshold values for the north star.** Why 0.5 recovery, why not 0.7? Kyle picked 0.5 as "made at least half back." Is that the right line, or should it be 1.0 (made all money back)? The honest answer depends on what we observe — set a low bar first, watch the distribution, then move the threshold.

2. **Time window.** "6-month rolling" is a guess. Could be 90-day, could be 12-month. Depends on the velocity of breaks logged per user.

3. **Per-product vs all-product aggregation.** Should we report recovery rate per-product (so a Bowman lover knows Bowman-specific accuracy), per-user (their average), or globally? Probably all three, but the headline matters.

4. **What to do with PASS users who break anyway.** If we say PASS and they pay anyway, observing their outcome is high-signal — it directly tests whether our PASS was right. But it requires logging the user's decision relative to our advice, not just the outcome.

5. **How to handle confidence-band fitness.** Should we backtest existing breaks (with known prices) against the model retroactively to estimate what the calibration error WOULD look like, before pull data exists? Probably yes — gives a synthetic baseline.

6. **Subscription / pricing implications.** If we can demonstrate "Pro users who follow BUY signals hit 75% recovery vs. 45% for free users who don't," that's a sales pitch. The metric becomes a growth lever. But we don't get there without the data.

---

## A line that's worth keeping

From the Brody-Kyle thread:

> "I'm just going to keep pressure testing that what is in YOUR head is actually correct."

That is the entire feedback loop in one sentence. Every model constant, every tier definition, every multiplier, every cascade weight — they're all things in someone's head right now. The question is whether they're correct. Until we have data, we don't know. The work between now and "we know" is the work that defines whether BreakIQ becomes a real product or a sophisticated guessing engine.
