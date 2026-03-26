# Card Breakerz — Figma Make Design Prompt

**Last updated:** 2026-03-25

---

## Concept

Bloomberg Terminal meets modern sports tech. Think: the data density and authority of a financial terminal, but with the energy and visual language of a premium sports analytics product — DraftKings' data tools, The Athletic's presentation, Robinhood's clean signal UI. This is a tool for serious collectors who want to make smarter buying decisions, not a card shop storefront.

**Vibe references:** Bloomberg Terminal (data density, authority), Robinhood (clean signal callouts), Linear (tight UI, dark surfaces), Vercel dashboard (monospace + clean hierarchy), ESPN Analytics (sport credibility). Dark-first. Numbers should feel precise and live.

---

## Color Direction

- **Primary surface:** very dark navy or near-black (not pure black — slightly warm or slightly blue-shifted)
- **Accent 1:** a precise electric blue or cobalt — used for interactive elements, the "live data" feel
- **Accent 2:** Topps red — brand anchor, used sparingly for signals and badges
- **Signal colors:** green (BUY), amber (WATCH), red (PASS) — muted/desaturated versions that feel analytical, not traffic-light garish
- **Type:** mostly white/off-white on dark, muted gray for secondary data

---

## Typography

- **Numbers:** monospace, tabular figures — non-negotiable. Prices, EVs, slot costs should feel like a ticker
- **Headings:** tight, confident, slightly condensed — not display/decorative
- **Labels:** small, all-caps, tracked out — terminal-style column headers

---

## Screen 1 — Homepage / Product Grid

**Current state:** product cards grouped by sport, basic grid layout.

**Redesign direction:** Make it feel like a trading desk watching multiple markets. Each product card is a "ticker block" — compact, information-forward. Show sport, year, key signal at a glance (pre-release / active / pricing status). A slim horizontal status bar at the top ("3 products live · 1 pre-release · Last updated 2h ago"). Dark surface, cards with a subtle border — not white cards on white background.

**Key elements to show:**
- Product name, sport pill, year
- A "readiness" signal — is pricing live?
- Hint of the slot cost range (e.g., "$45–$380 per slot")
- "Breakerz Sayz" promo element — make it feel like a featured signal, not a banner ad

---

## Screen 2 — Break Page / Team Slots

This is the core experience. A user is browsing slot prices before a break, comparing teams, checking if a price is fair.

**Redesign direction:** Full terminal layout. The main table is the hero — dense, scrollable, every column earns its place. Team rows feel like ticker rows. The "Current Break Price" input field should feel like entering a live order — maybe a highlighted input with a real-time BUY/WATCH/PASS signal that updates inline. When you expand a team, the player sub-rows feel like drilling into a position.

**Key elements to show:**
- Sticky header with product name, sport, break type toggle (Hobby / BD), case count config
- A tight data table with columns: `#` · `Team` · `[price input + live signal]` · `Players` · `RC` · `Slot Cost` · `/Case` · `Max Pay`
- Social Currency indicators inline in the team name cell: `★` (icon player), `↑↓` (buzz signal), `⚡` (HV), `⚑` (risk flag) — small, precise badges
- Expanded team row: player sub-rows with same badge system
- Tab bar: Team Slots · Player Slots — clean, minimal

---

## Screen 3 — Breakerz Sayz (Analysis Tool)

A single-page deal analyzer. The user picks a product, team, break type, case count, and enters the price they're being quoted. The result is a verdict card.

**Redesign direction:** Two-panel feel. Left/top: the inputs — clean form, progressive disclosure (each field unlocks the next). Right/bottom: the result — a strong, full-width verdict card. The signal (BUY / WATCH / PASS) should feel like a Bloomberg alert — bold, immediate, authoritative. The key players list feels like a positions summary. Risk flag banners and HV advisories are disclosure blocks, not afterthoughts.

**Key elements to show:**
- Product selector, break type toggle, case count stepper, team selector, price input
- The BUY/WATCH/PASS verdict — large signal label, percentage below/above fair value, fair value figure
- AI narrative — 2–3 sentences, styled like an analyst note (slightly indented, maybe a subtle left border)
- Key Players section — compact player rows: name · RC/★ badges · EV · Upside
- HV advisory block (amber) and risk flag blocks (type-colored) below players

---

## Component Library to Include

| Component | Notes |
|---|---|
| Signal badge | BUY / WATCH / PASS — 3 states, compact pill style |
| Social currency badges | ★ icon (purple) · ↑ bullish (green) · ↓ bearish (red) · ⚡ HV (amber) · flag chip (type-colored: amber=injury, blue=trade, red=legal/suspension) |
| Data table row | Team row, expanded player sub-row |
| Price input with inline deal signal | Highlighted column, updates BUY/WATCH/PASS in real time |
| Verdict card | BUY / WATCH / PASS variant |
| Product card / ticker block | Compact, data-forward |
| Analyst note text block | Slightly indented, subtle left border |
| Advisory banner | HV variant (amber), risk flag variant (type-colored) |

---

## What NOT To Do

- No bright white backgrounds with drop-shadow cards — that's a retail storefront, not a terminal
- No gradient hero banners or marketing-speak CTAs
- No oversized type that wastes vertical space — this is a data tool, buyers are scanning fast
- Don't make it look like a fantasy sports app or a sports betting site — the authority comes from precision and restraint, not energy and color

---

## Deliverable

Generate 2–3 UI concept directions for the homepage, break page, and Sayz analysis screen. Show dark-first.

- **Direction A — Pure Terminal:** very dense, near-monochrome accents, maximum information per pixel
- **Direction B — Modern Fintech:** dark but with more breathing room and color, closer to Robinhood or Linear
- **Direction C — Middle Ground:** data density of A with the visual polish of B
