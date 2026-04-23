# PRD: Breaker Identity + Crowdsourced Case Pricing

**Status:** Backlogged — build after public beta when breaker volume makes crowdsourcing meaningful
**Last updated:** 2026-04-23

---

## Problem

Case pricing is currently a static admin field. There are two compounding issues:

1. **MSRP ≠ real cost.** After a product launches, secondary market prices can jump 2–10x. A breaker buying 2025 Bowman Chrome today pays the aftermarket rate, not $1,200. Slot costs calculated at MSRP are wrong for anyone who didn't get in at launch.

2. **No signal aggregation.** We have no visibility into what breakers across the market are actually paying per case. That aggregate is more useful than any single data point — it tells us the true market rate for a case at a given moment in time.

The admin-tracked AM price field (shipped 2026-04-23) solves issue #1 with manual input. This PRD solves both issues at scale.

---

## Users

**Breakers** — people who buy cases (or groups of cases) and run breaks, charging slot buyers for team access. Distinct from consumers (slot buyers). They care about:
- "What should I charge for this slot if I paid $X for the case?"
- "Am I overpaying for this case relative to what other breakers are paying?"
- Knowing their break will be profitable before they open cases

---

## Proposed Solution

### 1. Breaker Role

Add `breaker` as a first-class user role alongside `admin`, `contributor`, and the existing consumer.

A breaker signs up, opts into the breaker identity during onboarding, and gets access to:
- A **Breaker Dashboard** — case cost input, break profitability calculator, market rate visibility
- The same break page as consumers, but with the slot cost table oriented around *their margin*, not the buyer's fair value

**Role in DB:**
```sql
-- user_roles already exists; add 'breaker' to the role enum
-- profiles gets a breaker_opt_in boolean (self-designated, not admin-granted)
```

Breaker status is self-designated (low friction) rather than admin-granted. Not a trust or permission issue — it just changes what defaults and context they see.

---

### 2. Breaker Case Cost Input

When a breaker opens a break page, the "Your Cost / Case" field works the same as it does today (consumer can already edit it). The difference:

- **Breaker-specific UX:** Frame the question as "What did you pay per case?" with context showing the MSRP and current market rate (from crowdsourced aggregate — see below)
- **Persist the input:** Save the cost they entered, attached to `(user_id, product_id, break_type, entered_at)` — this is the crowdsource contribution
- **Opt-in language:** On first save: *"Your case cost helps us track the real market rate for this product. Your individual data is never shown publicly — only the aggregate."*

---

### 3. Crowdsourced Market Rate

Aggregate breaker-entered case costs per product to compute a rolling market rate.

**Schema:**
```sql
CREATE TABLE breaker_case_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  product_id UUID REFERENCES products(id),
  break_type TEXT CHECK (break_type IN ('hobby', 'bd')),
  case_cost NUMERIC NOT NULL,
  entered_at TIMESTAMPTZ DEFAULT now()
);
```

**Aggregation logic:**
- Use median (not mean) to resist outliers
- Rolling 30-day window — old data ages out as the market moves
- Minimum 3 data points before publishing a market rate; show "not enough data" below that threshold

**Where it surfaces:**
- On the break page (for all users): "Market rate: $4,200 (based on X breakers this month)" — replaces or supplements the admin-set AM price
- Admin product page: show market rate alongside MSRP and admin AM price

**Priority for break page default:**
1. Crowdsourced market rate (when ≥ 3 data points in last 30 days)
2. Admin-set AM price (`hobby_am_case_cost`)
3. MSRP (`hobby_case_cost`)

---

### 4. Equation Integration

The slot cost equation doesn't change. What changes is the default `hobbyCaseCost` that feeds into it.

Today (post AM pricing):
```
hobbyCaseCost = hobby_am_case_cost ?? hobby_case_cost
```

After crowdsourced pricing:
```
hobbyCaseCost = crowdsourcedMedian ?? hobby_am_case_cost ?? hobby_case_cost
```

This means slot costs on the break page automatically reflect what breakers are actually paying — without anyone maintaining a static field.

---

### 5. Breaker Profitability View

Optional Phase 2 of the breaker identity. Once a breaker has entered their case cost, show them:

- **Slot cost** (what they should charge for each slot to break even)
- **Target slot price** (slot cost × 1.3 — a 30% margin target, configurable)
- **Break at capacity** — if all slots sell at target price, what's the total revenue vs. case cost?
- **At-risk player warning** — if risk flags exist for top players in this product, flag that it may compress demand

This is a pre-break planning tool, not a post-break analysis (that's My Breaks).

---

## Scope / Phasing

### Phase 1 — Breaker Identity + Cost Capture
- Breaker opt-in during onboarding (or profile settings)
- Persist entered case costs to `breaker_case_costs`
- Opt-in copy + privacy language

**Effort:** ~1 day

### Phase 2 — Crowdsourced Market Rate
- Aggregation query (median, 30-day window)
- Surface on break page + admin product page
- Replace admin AM price as the default where enough data exists

**Effort:** ~1 day

### Phase 3 — Breaker Profitability View
- Slot cost → target price calculator
- Break capacity / revenue projection
- At-risk player warnings

**Effort:** ~1–1.5 days

---

## What This Unlocks

- **Breakers have a reason to use BreakIQ pre-break** (not just buyers) — doubles the use case and the user base
- **Self-updating market data** — case prices update automatically as breakers enter them, instead of requiring admin maintenance
- **Better defaults for all users** — slot costs on the consumer break page reflect real market dynamics
- **Eventual marketplace transparency** — breakers can see whether they're paying market rate or getting squeezed

---

## Open Questions

| # | Question |
|---|---|
| 1 | Do breakers need a separate onboarding path, or just an opt-in toggle in profile settings? |
| 2 | Should cost entries be tied to actual breaks (linking to `user_breaks`) or standalone? Standalone is simpler but doesn't validate that the case was actually purchased. |
| 3 | How do we handle outliers / bad-faith inputs? Median is resistant but not immune — consider a simple IQR filter. |
| 4 | Is "breaker" a self-designation or does it require some threshold of activity? Keep it self-designated for now. |

---

## Dependencies

- Admin AM case pricing (shipped 2026-04-23) — lays the groundwork, establishes the fallback chain
- Stripe subscription plans: breaker tier TBD — free to use as breaker? or premium feature? Recommend: free in beta, revisit at monetization.
