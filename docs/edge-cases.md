# Edge Cases — Known, Documented, Deferred

Running log of edge cases we've hit, decided on, and chosen *not* to handle in v1. Each entry: what the case is, what we ship today, what we'd want to revisit, and the trigger that should make us revisit.

Add entries as we discover them. Don't delete — when an edge case gets handled properly, move it to a "Resolved" section at the bottom with the commit/PR that closed it.

---

## `/break-price` — multi-team breaks (deferred)

**The case.** A live-break listing covers multiple teams in one bundle ask — e.g. "Yankees + Red Sox + Dodgers, $2,400 hobby." The slot ask is for the *bundle*, not any one team.

**What v1 does.** `/break-price` only captures single-team asks. If the SME drops a screenshot showing a multi-team bundle, Claude flags it (`needs_human_review`) and replies "Multi-team breaks aren't supported yet — try logging each team's slot separately if the listing breaks out individual slot prices, otherwise skip."

**The hunch (Brody, 2026-05-13).** The real answer is probably a new `break_config_id` concept on `market_observations` that ties multiple team-rows together as one bundle. That preserves the per-team granularity for Market Delta math (we can ask "what does the herd think Yankees go for in 3-team baseball breaks?") while keeping the bundle identity intact.

**Revisit trigger.** When SMEs start dropping enough multi-team screenshots that the `needs_human_review` queue becomes annoying — or when step #3 (side-by-side comparison UI) is ready and needs bundle-level deltas to render correctly.

**Related work.** Break Analysis v2 (2026-04-29) already handles multi-team breaks on the *user-facing analysis* side via `runBreakAnalysis({ teams: string[] })`. The observation-capture side is the gap.

---

## `/break-price` — multi-format bundles (deferred)

**The case.** A listing bundles multiple formats — e.g. "$5,000 for 1 hobby case + 2 BD cases of 2026 Bowman." The ask covers a mix; splitting it cleanly by format requires knowing the format-cost split a priori (which is exactly what BreakIQ's job is, so we can't use it as an input).

**What v1 does.** Single-format only. Multi-format screenshots get the same `needs_human_review` flag as multi-team. Claude's prompt explicitly tells it: if you see two or more format counts > 0 in a listing, reject the parse.

**The clean answer (later).** Either (a) store as one row per format with a cases-weighted price split (requires picking a split rule — naive proportional-to-case-cost would inherit MSRP/AM-pricing assumptions and bias the comparison), or (b) store as a single `bundle` observation with `formats: { hobby, bd, jumbo }` in the payload, schema-extended so Market Delta can sum the model fair values across formats before comparing. Option (b) is cleaner; defer it until we have enough multi-format observations to make the schema change worth it.

**Revisit trigger.** Same as multi-team — when the `needs_human_review` queue gets noisy, or when step #3 needs multi-format bundle deltas.

---

## `/break-price` — price ranges in screenshots (handled)

**The case.** Whatnot and Fanatics sometimes show `$600-700` for a slot. Schema already supports `price_low` + `price_high` separately.

**What v1 does.** Claude extracts both numbers when a range is shown; fills `price_low === price_high` when a single price is shown. No special-case logic needed — the schema absorbs it natively.

---

## Future entries go here

(seed examples for future-us; delete this section when populated)
