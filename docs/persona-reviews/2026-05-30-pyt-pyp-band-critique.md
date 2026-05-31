# Persona Review — PYT + PYP + Reasonable-Margin Band

**Date:** 2026-05-30
**Reviewed:** The newly shipped pricing work — per-player PYP (fair-value EV + P(0) chip), per-team PYT (fair-value EV mode), and the reasonable-margin band (steal/fair/overpaying with score-shift). All flag-off behind `fair_value_pyt_enabled`. PR [breakerz#176](https://github.com/brodotype-dev/breakerz/pull/176).
**Method:** 5 parallel `general-purpose` agents, each briefed with a fixed persona + the same product context + pointers to the real code/docs. Critique was of the product *as designed + documented* (agents read code/CHANGELOG/strategy/sentiment files; they did not use a live app).
**Panel:** The Breaker · The Novice Consumer · The Whale Consumer · The Product Manager · The Investor.

---

## Synthesis

The highest-signal findings are where personas **independently converged**.

### Convergent findings (trust these most)

1. **High-end slots are biased low by construction** — *Whale + Breaker.* Filtering 1/1s + SuperFractors out of EV makes `pypPure` a structural floor; a flat lifecycle markup sits on top. On the marquee slot a whale pays $4k for, the model anchors ~$1,200 and flags the correct buy "Overpaying." A false PASS on the most valuable slots. → BACKLOG P1.
2. **Validation circularity** — *PM + Investor.* The admin band calibrates against captured *breaker asks* — the population the thesis says is wrong. Plus the admin band runs `score=0` while the consumer band uses the real score-shift, so the moat coefficient (α=0.25) is never exercised by the validation surface. We'd flip believing we validated. → BACKLOG P1 + GATE on Pull-Data Capture.
3. **No outcome data = everything is a hypothesis** — *Whale + PM + Investor (all three).* The real north star (recovery rate, pull_value/ask_price) needs pull data that doesn't exist. Until My Breaks v2 captures pulls, the band is unfalsifiable. → already BACKLOG #4, now elevated to the flag gate.
4. **The moat is a coefficient on a rented feed** — *Investor + PM.* EV foundation is 100% CardHedger (a competitor who can build buyer tools). Only proprietary layer is a 0.25 sentiment shift; network effect asserted, not shown ("1 observation in prod").

### The one opportunity all roads led to

**Breakers as the distribution channel** — surfaced independently by Breaker ("let me claim the Fair badge — I'd put it in my stream title") and Investor ("the only wedge from feature to company"). The referee reframe makes a "BreakIQ-Fair Verified" overlay a trust signal breakers *want*. → BACKLOG strategic spike (discuss w/ Kyle).

### Recommended priority order

1. Don't flip the flag on herd-validation alone — pull-data capture (My Breaks v2) is the gate.
2. Fix the admin/consumer score divergence (cheap; it's a flaw in the same PR).
3. High-end EV bias (1/1 filter strips the ceiling) — distinct from the deferred 1/λ premium.
4. Novice copy pass — kill "P(0)"/"EV" labels, stop coloring desired players PASS-red, one primary verdict.
5. Spike the breaker "Fair badge" — the feature→company wedge.

---

## Verbatim persona critiques

### The Breaker

**Works:** The three-zone band is the first thing that doesn't treat me as the enemy — the FAIR zone says breakers deserve a margin, and the score-shift raises my reasonable ceiling on a hot rookie. That "Fair margin" badge is something I'd screenshot into my stream title.

**Critiques:**
- The EV model has no idea why I price what I do. I sell access and demand, not EV — a Wemby PYT goes for 4× "fair" because 200 people want one slot. Pricing a scarce thing at expected value is economically illiterate about live markets.
- The "Fair" band is computed on case cost I don't actually pay — it ignores Whatnot's ~8% cut, shipping every card, sales tax, my hours, and dead slots. Your "fair" isn't my breakeven.
- It ignores sell-through risk / cross-subsidy: cheap weak-team slots only sell because the star slots overcharge to cover the case. Per-team pricing in isolation has no concept of this — flag me "fleecing" on the Dodgers and you break the cross-subsidy that lets the break exist.
- A red "OVERPAYING — you're getting fleeced" chip mid-stream is a chat grenade; the liberal dials (α=0.25, ±7%) will cry wolf and *I* eat the argument in real time.
- P(0) is honest but weaponizable — a 60%-no-hit chip kills the impulse/lottery dopamine that is the product.

**Biggest risk BreakIQ runs:** False "Overpaying" calls on legitimate star-tax slots. The first time a buyer waves the screen and the slot still sells instantly to someone else, the credibility/moat is gone — you've taught the market you don't understand auctions.

**Opportunity missed:** Let me *claim* the Fair badge — a "BreakIQ-Fair Verified" overlay turns your accusation tool into my trust signal and me into your distribution channel.

### The Novice Consumer

**Helps:** The big BUY/WATCH/PASS badge + "Total Cost $X" right next to it — one glance, verdict color + what I pay. That's the one thing fast enough for a live break.

**Confusion / friction:**
- "PYP" and "P(0)" mean nothing to me. The column literally says `PYP`; the chip says `P(0) 65%`. I'd skip the column. The tooltip is a *paragraph* — homework, not help.
- The red P(0) 65% chip (same color as PASS) makes me feel dumb for wanting the player — the app flashes "danger" on the guy I'm excited about. I'd hesitate and trust the breaker's hype over the scary red number.
- "EV $1,000," "Reasonable margin band," "$1,116–$1,284" reads like a finance terminal (it's literally `font-mono`). Black box → I distrust it.
- The clearest copy (the steal/fair/overpaying tagline) is the *least* visible (small `text-xs`); the jargon is loudest.
- Two-to-three verdicts at once (badge + % + tagline). Which one is THE answer? Pick one for me.

**Most likely to make me ignore it:** I've watched this breaker for an hour; a website hands me "EV $1,000 · $1,116–$1,284" from a source I don't recognize ("CardHedger comps + SME signal" means nothing). I trust the guy I can see.

**Jargon that needs to die:** "P(0)" — say "1 in 3 chance you hit" (green, framed as upside). "EV" → "what the hits are usually worth." Lead with words, not symbols.

### The Whale Consumer

**Edge:** The P(0) Poisson chip is genuinely useful — separating a $1,500 slot with 5% no-hit from one with 60% is variance honesty no breaker gives me. That + the band shifting on risk flags is the one place you're doing something a CardHedger wrapper can't.

**Critiques:**
- You strip the exact upside I pay for. Filtering `print_run > 1` out of `hobbyEVPerBox` makes `pypPure` structurally a floor, marked up by a flat 1.20. On a Wemby/Ohtani slot I'd pay $4k for, the model anchors ~$1,200 and screams "Overpaying." That false PASS costs me the convex slots — the only ones worth chasing at scale.
- ±7% band is precision theater on a noisy floor — documented 7–18% FMV-vs-batch drift + a cache bug that nulled 97% of rows. The verdict band is sharper than the data it rests on.
- `hobby_autos_per_case` default of 16 is a load-bearing guess; a wrong case-anchor silently rescales every player's slot.
- No portfolio, no recovery rate. I run 40+ slots/month; this gives single-slot verdicts. The north star (pull_value/ask_price) isn't captured, so you can't tell me whether your "Fair" calls actually returned.

**Stop-trusting trigger:** The 1/1 EV filter + flat markup biases every high-end slot low by construction, then confidently flags my correct buys as overpays. One bad PASS on a $4k SuperFractor slot and I'm out.

**Feature that makes me a power user:** A portfolio recovery-rate tracker — log each slot's ask + actual pull value, roll up Σpull/Σask per breaker and product. Turns the single-slot referee into a calibration loop that proves the band holds on real money.

### The Product Manager

**Smart judgment:** Reframing the verdict from "BreakIQ vs breakers" to a referee on margin dodges the adversarial trap and makes the score-shifter the one thing CardHedger structurally can't replicate. Shipping flag-off with a written flip criterion is disciplined.

**Critiques:**
- The validation loop grades homework against the answer key you don't trust — the admin panel classifies captured breaker asks into your band zones, but the thesis is breaker asks are wrong. A "healthy mostly-FAIR split" only means the band agrees with the herd. Tautological.
- You're calibrating a different model than you ship — admin band uses `effectiveScore=0`, consumer uses real `bundleEffectiveScore`. The moat (score-shift) is literally absent from the validation surface; the admin panel can't tell you whether α=0.25 is right.
- The measurement apparatus is built for data that may never arrive — ~1 capture in prod, flip plan wants N>30 *per product*, captures depend on Brody manually watching streams. Months-to-never flywheel; the true north star needs pull data that doesn't exist.
- Liberal tuning + no feedback = confident wrongness. α=0.25 + ±7% makes confident calls with no ground truth to roll back from. A wrong "Overpaying — PASS" on a slot that hits trains users to distrust the verdict.
- Consumer value has stalled behind infra — PYP column, PYT rewrite, dual-Δ panel, band — all flag-gated/admin-only. The team is iterating the model, not the user's experience.
- "Steal/Fair/Overpaying" may be the PM's frame, not the buyer's — the sentiment file says validate the smart-buyer identity, don't shame the rip. "Overpaying — PASS" may read as scold.

**Biggest strategic risk:** You're building an internally-coherent model whose only validator is the population it claims is wrong, while the real validator (recovery rate) doesn't exist. The moat could be fictional and this loop would never reveal it.

**Do before flipping:** Stand up pull-data capture (My Breaks v2 → realized pull value) first, even crude. It's the only non-circular validator — it tells you whether "Overpaying" calls actually under-returned.

### The Investor

**Investable insight:** The referee reframe could become a business instead of a tool — repositioning from "stop overpaying breakers" to "breakers deserve a fair margin; we flag fleecing" can recruit the people who own the audiences as a distribution channel rather than enemies. Flips a CAC problem into a land-grab — *if* breakers adopt.

**Concerns:**
- The moat is a 0.25 coefficient (`centerMarkup = baseMarkup × (1 + 0.25 × effectiveScore)`). Everything else is CardHedger-derived and replicable. A moat you're tuning *down* from over-aggressive isn't a moat yet. *Fixable only if the SME network compounds.*
- No evidence of a data network effect — "1 observation in prod," repeated "once captures accumulate" hedging. Today the network is Brody-on-stream + Kyle. A content operation, not a compounding asset. *Fatal if unaddressed.*
- Total CardHedger dependence + they can build buyer tools (listed as a direct competitor); you pay ~$300/mo for the substrate and the CHANGELOG is a wall of data-integrity firefights. You own neither the data, the quality, nor the roadmap. *Fatal.*
- Market size / vitamin-vs-painkiller — target is a narrow slice (3+ breaks/mo, $500+ spend, Whatnot/Fanatics) of an already-niche hobby. Low-thousands-of-subs ceiling at $10–25/mo unless breakers become the channel. *Watch.*
- Reddit sentiment undercuts the original wedge ("collectors are equally to blame") — a rational-pricing tool fights the user's own impulse; willingness-to-pay unproven. *Watch.*
- Key-man (2-person team, Kyle splits w/ CardPulse) + platform/regulatory (Whatnot/Fanatics can absorb this; breaks are gambling-adjacent). *Watch.*

**Question before a check:** Will breakers actually embed BreakIQ's fair-margin band in their streams/listings — and does that drive net-new paying buyers?

**Feature or company?** Today a feature — a CardHedger wrapper with a sentiment coefficient, defensible only by execution speed. The wedge to a company: the referee reframe turning breakers into a two-sided network where the SME data compounds. Real thesis, but nothing in the repo proves the network compounds yet. *Pass now; re-engage on proof of breaker-side adoption.*
