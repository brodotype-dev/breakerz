# BreakIQ — Product Strategy Map

*Filled-out version of Reforge's 6-Dimension Product Strategy Map framework. Living document — meant to be re-read and revised as the product evolves. Sits alongside [`north-star-and-feedback-loop.md`](north-star-and-feedback-loop.md) as the second-and-companion strategy doc.*

*First draft: 2026-05-12, after a strategic thread between Brody and Kyle exposing the "breakers herd, the market is wildly mispriced, BreakIQ's role is the differentiated voice" reframe.*

---

## 1. Target Audience

| Step | Audience | Rationale |
|---|---|---|
| **Total Addressable Audience** | All sports card collectors | Broadest framing — anyone who buys cards |
| **Narrowed Audience** | Active break participants | Specifically people who buy slots in live breaks — the cohort where mispricing is the dominant problem, vs. solo buyers of singles |
| **Narrowed (further)** | PYT-style break participants on live-stream platforms | Within breaks, "Pick Your Team" is where slot-by-slot pricing variance matters most. Random / Mixer formats have less mispricing exposure |
| **Target Audience** | Serial PYT break participants — 3+ breaks/month, $500+ monthly spend, primarily on Whatnot / Fanatics Live | Volume + spend high enough to feel the pain of being fleeced AND to justify a subscription. Active enough to engage with real-time tooling |

---

## 2. Problem You're Solving

| Step | Notes |
|---|---|
| **Outcome** | Walk away from a break having gotten fair (or better) value for money spent. Avoid the "I just paid $6k for $2k of cards" experience |
| **Motivation** | Cards-as-hobby + cards-as-investment, plus the emotional pull of teams/players. There's a "don't be the sucker" social dimension — getting fleeced in a public stream stings beyond the dollars |
| **Gaps** | 1. Breakers price slots by copying each other → systematic over- and under-pricing<br>2. User has ~8 seconds to decide when a slot comes up — no time to research<br>3. Pricing data exists (CardHedger) but isn't accessible at the moment of decision<br>4. Hobby SME knowledge (prospect intel, player buzz) lives in scattered Discord conversations — not aggregated<br>5. Pull variance is huge; breakers sell point prices as if they're certain |
| **Problem Statement** | Help break participants know the real-time fair value of every slot — with data they can trust, reasoning they can audit, in time to make a confident decision |

---

## 3. Value Proposition

**Core:** *Stop overpaying breakers. BreakIQ catches market mispricings in real time, before you claim the slot.*

| # | Sub-benefit | Details |
|---|---|---|
| 1 | **Multi-source pricing model** | Sales data (CardHedger) + prospect rankings (MLB Pipeline, ESPN Big Board, etc.) + SME observations from real hobby experts. A single fair value no breaker, no platform, and no calculator can match |
| 2 | **Real-time decision support** | Meets you in the stream, not the morning after. Verdicts in seconds — not after the break ends |
| 3 | **Auditable verdicts** | Every BUY / WATCH / PASS is sourced. See exactly what data and which observations drove the call. No black box |
| 4 | **Insider intel without insider access** | The hobby's best minds contribute observations through BreakIQ Insights. You get the benefit of their knowledge without needing to know them |
| 5 | **Loss avoidance with receipts** | "BreakIQ saved you $3,400 in passed-on overpriced slots last month" — concrete dollar savings tracked over time |

---

## 4. Strategic Differentiation

| Step | Competitor / Market | Notes |
|---|---|---|
| **Direct competitor** | CardHedger consumer-facing tools, Card Ladder, shared breakerz_data spreadsheets in Discord | Other tools producing pricing estimates for break decisions |
| **Indirect competitors** | Card-buying advice in hobby Discords, YouTube prospect rankings, individual breakers' reputations | The default today: ask around, trust the streamer, hope you didn't get fleeced |
| **Adjacent markets** | PSA price guide, eBay sold comps, Beckett, general card investment platforms | Pricing data exists, but not aggregated for break-decision use |
| **Unique attribute** | **Real-time, multi-source, auditable pricing with SME provenance.** The only voice in the market that disagrees with the herd, with data + receipts to back it. Everyone else either copies the herd (breakers) or publishes raw data (CardHedger) — nobody else combines them into a defensible mispricing detector | This is the moat. Track A (objective rankings) + Track B (Discord-attributed SME sentiment) + CH data are the components no competitor can assemble |

---

## 5. Channel Strategy

**Primary: Content + Viral**

| Strategy | Primary? | How we improve product-channel fit |
|---|---|---|
| **Viral** | ✓ | Network effects in Discord — when one user follows BreakIQ verdicts in a break, others notice and ask why. Word-of-mouth among serial break participants is strong. Build social-share moments ("BreakIQ said pass and they pulled $50 of junk") |
| **Content** | ✓ | BreakIQ Insights → public-facing posts. "Market Watch" reports on systematic mispricings. SME-driven content (Kyle's analyses, prospect updates) drives organic discovery |
| Paid | | Likely high CAC; defer until retention is proven. Could test Whatnot / Discord-server ad targeting once organic loop is healthy |
| Sales | | Long-term: partnership integration with Whatnot / Fanatics Live to surface BreakIQ verdicts natively in the live UI. Not near-term — requires market position first |

---

## 6. Monetization Strategy

**Primary segment: Prosumer (~$100–300 ARPPU)** — Pro tier at $24.99/mo ≈ $300/year ARPPU lands here

| Segment | Primary? | How we improve product-model fit |
|---|---|---|
| Mass Market (~$10 ARPPU) | | Free tier (3 lifetime analyses) is virality fuel, not the revenue model. Encourages first-pass usage that converts via "saved $X" moments |
| **Prosumer (~$100–300 ARPPU)** | ✓ | Build casual-contact virality via Discord-shareable verdicts. Onboard with the first "you would have overpaid $X on that break" moment. Win retention via in-stream presence (Discord bot / browser extension / mobile push) |
| SMB | | Potential B2B motion: serving the BREAKERS themselves — "use BreakIQ's pricing to win customer trust." Different audience, different motion. Not the v1 focus |
| Mid-Market | | N/A |
| Enterprise | | N/A |

---

## What filling this out actually reveals

The strategy map is supposed to be a forcing function — fill it in, and the strategic tensions become visible. Three things this exercise surfaces:

1. **The target audience is sharper than initial framing suggested.** Not "card collectors." Not even "break participants." **Serial PYT participants on Whatnot/Fanatics Live with $500+ monthly spend.** That's a specific human you can describe — and likely the audience our marketing copy, product surface, and pricing tier should all be tuned for.

2. **Channel and Product are linked.** "Content + Viral" only works if the verdicts show up where the community already talks (Discord). The web app alone doesn't fit the channel strategy. Either the channel changes or the product surface needs to extend into Discord / browser extension / mobile push. The herd-insight conversation made this obvious; the strategy map confirms it.

3. **The moat is real but invisible to users today.** The "Unique Attribute" cell (multi-source + auditable + SME provenance) is what we've been building for months — but a casual user on the consumer surface sees a price, not the moat. To MONETIZE the moat we have to surface it: show users the sources, show them the SME attribution, show them why this number is different from the breaker's number. The audit-trail UI from the strategy doc isn't just a nice-to-have — it's the visible form of the differentiator.

---

## Open questions to revisit

- **Is "$500+ monthly spend" the right cut for target audience?** Might be too low (most serial break participants spend well above this) or too high (could exclude valuable mid-volume users). Validate against actual `user_breaks` data once we have enough.
- **Is the "free tier as virality fuel" assumption right?** 3 lifetime analyses might be too stingy. Watch conversion rate from free → Hobby vs. free → churn.
- **B2B / SMB breaker-facing motion** — is this a future revenue line, or a distraction from the consumer focus? Worth a separate thought exercise once consumer product-market fit is clearer.
- **Per-sport positioning** — does the target audience differ meaningfully per sport (baseball/PYT-heavy vs. basketball/random-heavy vs. football/RC-driven)? Probably yes, but resolving that may require shipping into one sport's segment first and learning.
- **What's the actual "moment of decision" surface in v1?** Discord bot, browser extension, or mobile push — the choice cascades into engineering priority and channel strategy. Worth picking explicitly.
