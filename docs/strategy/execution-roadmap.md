# BreakIQ — Strategy Execution Roadmap

*Third strategy document, completing the trilogy. The "what to actually ship, and in what order" version of the strategy. Living document.*

*Companions:*
- *[`north-star-and-feedback-loop.md`](north-star-and-feedback-loop.md) — how we measure success*
- *[`product-strategy-map.md`](product-strategy-map.md) — Reforge 6-dimension positioning*
- *This doc — execution sequence to make the strategy real in the product*

*First written: 2026-05-12, after a thread between Brody and Kyle that surfaced the herd-mispricing reframe.*

---

## What "solidifying the strategy" actually means

A user lands on `/break/2025-bowman-baseball` today. They see a slot price of $1,447 for Royals. They cannot tell:

- Whether that's a good or bad price vs. what other breakers are charging
- Where $1,447 came from
- Who said what to produce that number
- What variance is around it — could be $1,000 or $2,000 and both be "right"

**Until those questions have visible answers in the product, the strategy is words on paper.** Every shipping decision should be evaluated against: does it convert a strategic claim into something visibly true to a user in 30 seconds?

---

## The 4-thread test (from `north-star-and-feedback-loop.md`)

Every product decision should pull on at least one of these threads. Decisions that pull on three or four threads compound. Decisions that pull on zero are luxuries.

| Thread | What it operationalizes |
|---|---|
| **Differentiated voice** | We say something the market doesn't / can't. Not a CH wrapper, not a herd-copier |
| **Moment of decision** | We show up in the 8 seconds before user claims a slot, not the morning after |
| **Credible because of data infrastructure** | Track A + Track B + CH + cascade + audit — the work nobody else can replicate |
| **Market herds and we don't** | We measure, surface, and explain mispricing the herd creates by copying each other |

If a feature pitch doesn't activate at least one thread, it's likely operational/polish, not strategic.

---

## Gap analysis — strategic claim → product gap → required change

The strategy makes seven implicit claims. Three are partially supported by the product today; four are entirely paper. This table is the source-of-truth for "what's missing."

| Strategic claim | What user sees today | What user needs to see | Required product change |
|---|---|---|---|
| **Differentiated voice** | Our number alone | Our number side-by-side with observed breaker asks | **Live ask-price ingestion + side-by-side comparison UI** |
| **Moment of decision** | Web app, pre-break analysis | Verdict in Discord / browser / push during the stream | **In-stream delivery (Discord bot v1)** |
| **Multi-source pricing model** | Single price, no decomposition | Breakdown: CH base + variant rollup + prospect rank + SME contribution | **Track A + Track B implementation** |
| **Auditable verdicts** | Number with no provenance | Click → see every signal source with its decay clock + author | **Consumer-side audit trail UI ("Why this price?")** |
| **Loss avoidance with receipts** | No personal-savings metric | "BreakIQ saved you $3,400 in passed overpriced slots this month" | **Pull-data capture + personal savings dashboard** |
| **Real-time** | 24h-stale cache | Fresh-on-demand + variance bands shown explicitly | **Streaming refresh + confidence bands in UI** |
| **Market herds and we don't** | We don't observe the herd | Market Delta distribution — where breakers price vs. our number | **Market Delta Watch dashboard** |

---

## The 10-step execution sequence

Ordered by *strategic clarity per engineering day*, not by feature size. Each step makes one or more strategic claims visibly true.

| # | Change | Effort | Activates threads | Why this position |
|---|---|---|---|---|
| 1 | **Market Delta Watch dashboard** (admin) | ½ day | Market herds and we don't | Validate the herd-mispricing thesis BEFORE building product around it. If the delta distribution is centered on zero, we are a CH wrapper and the rest is moot. Cheapest highest-leverage move available |
| 2 | **Live ask-price ingestion** (admin-paste path v1) | 1-2 days | Foundation for steps 1, 3, 7 | Foundation. Without observed asks at scale, comparison surfaces have nothing to show, Market Delta runs on too-thin data, and in-stream verdicts can't reference market |
| 3 | **Side-by-side comparison UI on `/break/[slug]`** | 2-3 days | Differentiated voice + Market herds | Makes differentiation visible on the surface users already use. **Highest single user-perceived impact in the entire roadmap** |
| 4 | **Pull-data capture in My Breaks** | 1 week | Loss avoidance + enables measurement | The unblocker for north-star metric + the "saved you $X" narrative. Without it, every model improvement remains hypothesis-driven |
| 5 | **Track A — objective prospect attributes** (Phase 1 of prospect-attrs plan) | 1-2 days | Multi-source pricing + Credible infrastructure | Adds the next strategic input to the moat. Pair with #6 |
| 6 | **Consumer audit trail UI** ("Why this price?") | 2-3 days | Auditable verdicts + Credible infrastructure | Makes Track A's contribution visible. **Without this, Track A is invisible moat-building.** Pair shipping with #5 |
| 7 | **Discord bot — in-stream delivery v1** | 1-2 weeks | Moment of decision + Differentiated voice | Now we have something worth in-stream delivery for. Without #1-6 we'd be delivering an unclear number to Discord |
| 8 | **Track B — cascading sentiment** (Phase 2-3 of prospect-attrs plan) | 1-2 days | Multi-source pricing + Credible infrastructure | Adds SME layer. Audit-trail UI from #6 already supports the new contributions |
| 9 | **Confidence bands in UI** | 2-3 days | Auditable verdicts + variance honesty | After audit trail because the band display composes with the breakdown |
| 10 | **Streaming pricing refresh** | 1.5 days | Real-time | Operational scaling. Necessary but not strategically clarifying — hence late in the sequence even though it's been planned for a while |

---

## Order-of-operations principles

Three rules that emerge from this sequence. Worth holding to even when the rest evolves.

### Principle 1: Build the moat AFTER you've surfaced it
Track A and Track B (steps 5, 8) come *after* the audit-trail UI (step 6). If you ship sophisticated SME-cascade architecture without a way for users to see the contributions, you've built invisible moat = no strategic clarity = no perceived differentiation.

This is also the same mistake we'd make if we shipped Phase 1 of the prospect-attrs plan before items 1-3 of this roadmap. The plan is good; the **order** of shipping it matters.

### Principle 2: Validate the thesis cheaply before investing in it
Step 1 (Market Delta Watch) is half a day of admin work. It exists to answer "is BreakIQ actually saying something different from the breaker market, at scale?" If the answer is no, every downstream investment is misallocated. If the answer is yes, the strategic foundation is proven and every downstream investment compounds.

### Principle 3: Measurement-driven > hypothesis-driven, but ship hypothesis-driven if measurement's blocked
Pull-data capture (step 4) gates north-star measurement (recovery ratio). That's a multi-week dependency. We don't pause everything waiting for it — we ship hypothesis-driven model work (steps 5, 8) with the hypothesis documented inline. When pull data lands, we go back and tune.

**Document hypotheses next to constants.** Instead of `PROSPECT_RANK_TIERS = [{ maxRank: 10, bump: 0.60 }]`, write `bump: 0.60 // hypothesis: a Top 10 prospect's EV should be 60% above baseline in fresh prospect products. Validate against pull data when available.`

---

## Session continuity — read order for picking this thread up cold

A new Claude session (or new human contributor) joining this work should be able to grok the strategic posture in under 30 minutes. Recommended order:

1. **[CLAUDE.md](../../CLAUDE.md)** — "Product Strategy" section at top (1 min)
2. **[`north-star-and-feedback-loop.md`](north-star-and-feedback-loop.md)** — how we measure success and why pull data matters (5 min)
3. **[`product-strategy-map.md`](product-strategy-map.md)** — Reforge 6-dimension positioning (3 min)
4. **This doc** — execution sequence + gap analysis (5 min)
5. **[`docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md`](../plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md)** — only if implementing Track A/B (10 min)
6. **[`docs/BACKLOG.md`](../BACKLOG.md)** P0 + P1 sections — current priorities (3 min)

Total cold-start time: ~27 minutes. After that, any contributor should be able to pick up implementation work without re-deriving strategy.

---

## What this roadmap doesn't claim

Things this roadmap is *not* deciding:

- **Whether to pursue the SMB / B2B breaker-facing motion** (sell to breakers themselves, not just slot-buyers). Captured as an open question in `product-strategy-map.md`. Decide when consumer side has demonstrated retention
- **Whether browser extension or mobile push beats Discord bot for in-stream delivery** in v2. Discord bot is the v1 pick; we evaluate v2 after seeing engagement data
- **The pricing-tier structure** (Hobby vs. Pro vs. higher). Today's $9.99 / $24.99 is fine; revisit when we have NPS + retention signal from the post-execution-roadmap product
- **Sport-prioritization order** (baseball-first vs. multi-sport simultaneously). The model layers are sport-agnostic; the ingestion + tuning per sport is the variable. Likely baseball-first because that's where Kyle is and where Bowman is fresh, but defer the explicit decision until Track A imports are loaded

---

## Anti-goals — what we are explicitly NOT building, even though tempting

- ❌ **A "free fair-value calculator" public landing page.** Free + commoditized = no moat, no monetization path
- ❌ **Card-by-card individual-buy recommendations** for non-break scenarios. Different audience, different motion; muddies the slot-pricing positioning
- ❌ **Generic card investment tools** (portfolio tracking, watchlists outside of breaks). Adjacent market, not our wedge
- ❌ **Streamlining the breaker's job** (slot pricing tools for breakers themselves) — at least not as the v1 motion. That's a different B2B path. Today's focus is the slot-buyer
- ❌ **AI-generated content marketing** decoupled from real data. Our content edge is "Market Watch" reports backed by actual delta distributions, not LLM blog posts

---

## When to revisit this doc

- After step 1 lands and Market Delta data exists for a couple weeks (validate the thesis)
- After step 3 ships and we have user feedback on side-by-side comparison
- After step 7 ships and we have early signal on in-stream conversion vs. web-app conversion
- Quarterly minimum even if no triggering event
