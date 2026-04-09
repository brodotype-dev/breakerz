# Plan: Team Slots View + Config Simplification

## Context
User interview (Mar 17) surfaced a fundamental shift in how the break analysis tool should work. Breaks are sold by **team slot**, not individual player slots — buyers pay for a team and get all that team's cards from the break. The current app only shows a player list; the missing primary view is **team-level aggregation** showing which team is the best value to buy into.

The interview also clarified that eBay fee and shipping inputs add noise to the primary analysis UI and should be removed from view. The core question is simple: given a break's case count and case cost, which team slot should I buy and what should I pay?

**Parked for a future session:** Odds-based EV calculation (importing the Topps odds PDF to compute expected pulls × market value per card type). This requires a separate data model (card types, odds per product format) and is a significant standalone effort.

---

## What Changes

### 1. Team Slots view — new primary tab
The most important missing piece. Group already-priced players by team, sum their slot costs. No new DB data needed — `computeSlotPricing` already produces all weights; we just aggregate.

Tab order becomes: **Team Slots (default) → Player Slots → Breaker Compare**

### 2. Simplified DashboardConfig
Remove eBay Fee Rate and Shipping/Card from the UI. Per the interview: "you can get rid of that — it's secondary to what we're trying to achieve." Keep Breaker Margin since it directly affects slot cost math.

### 3. TeamSlotsTable component — expandable rows
Click a team row → inline player list expands, showing that team's individual players with their slot costs. This satisfies the "drill down into a team" requirement without adding a new navigation layer.

---

## Files

### New
- `components/breakiq/TeamSlotsTable.tsx` — team-level table with expandable player rows

### Modified
- `lib/types.ts` — add `TeamSlot` type
- `lib/engine.ts` — add `computeTeamSlotPricing()` function
- `components/breakiq/DashboardConfig.tsx` — remove eBay Fee Rate + Shipping/Card fields
- `app/break/[slug]/page.tsx` — add Team Slots tab (default), reorder tabs
