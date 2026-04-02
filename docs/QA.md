# BreakIQ — QA Checklist

Manual test plan covering all shipped features. Work through each section on the live site at [breakerz.vercel.app](https://breakerz.vercel.app).

**Last updated:** 2026-03-25
**Covers:** Sessions 1–7 (all shipped features through Social Currency Phases 1–3)

---

## How to use this

- Work top to bottom — earlier sections are dependencies for later ones
- Mark each item ✅ pass / ❌ fail / ⚠️ partial
- Note the URL and exact steps when something fails
- Pre-existing known issue: `hobbyEVPerBox` reverts to `evMid` after first cache hit (odds weighting is only applied during live fetch, not cached). Don't flag this as a new bug.

---

## Round 1 Results (2026-03-25) — Summary

First full QA pass on the live site. Bugs found and fixed in commit `b61ca4c`. Items still needing re-test are marked **🔁 Re-test** below.

---

## 1. Homepage

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 1.1 | Load `/` | Product grid renders, grouped by sport | ✅ |
| 1.2 | BreakIQ Sayz promo strip | Full-width strip visible between header and product grid — "BreakIQ Sayz" red badge, tagline, "Check a deal →" button | ✅ |
| 1.3 | Click "Check a deal →" | Navigates to `/analysis` | ✅ |
| 1.4 | Click a product card | Navigates to `/break/[slug]` | ✅ Note: `/break/` URL is non-intuitive; consider `/products/[slug]` (backlog) |
| 1.5 | Dark mode (if applicable) | Layout holds, no blown-out colors | — No dark mode implemented |

---

## 2. Break Page (`/break/[slug]`)

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 2.1 | Load a break page | Team Slots tab shows by default; player data loads | ✅ |
| 2.2 | Slot costs sum check | Total of all team slot costs ≈ break cost × number of cases (not exact due to weighting, but in the right ballpark) | ✅ |
| 2.3 | Switch to Player tab | Player table renders with EV data | ✅ |
| 2.4 | Switch to Comparison tab | Comparison view renders | ✅ Note: low utility — consider removing (backlog) |
| 2.5 | Config panel — change case count | Slot costs recalculate in real time | ✅ |
| 2.6 | Config panel — change break type (hobby/BD) | Costs switch correctly | ✅ Note: BD slot cost shows $0 for hobby-only products — expected behavior |
| 2.7 | "Refresh live pricing" button | Triggers a POST to `/api/pricing`; spinner shows; costs update | ✅ |
| 2.8 | Pre-release product | Blue pre-release banner shows above the table; EV labeled as estimated | ✅ |
| 2.9 | Product with no pricing cache | Costs show as $0 until refresh is clicked — expected behavior | ✅ |

---

## 3. BreakIQ Sayz (`/analysis`)

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 3.1 | Load `/analysis` | Product dropdown populates with active products | ✅ |
| 3.2 | Select a product | Break type toggle and case count input appear | ✅ Note: BD toggle only appears if product has `bd_case_cost` set — by design |
| 3.3 | Change case count | Input accepts values 1–50; shows warning if >50 | ✅ Warning added in b61ca4c |
| 3.4 | Select a team | Team dropdown populates with teams from that product | ✅ |
| 3.5 | Enter an ask price | Price input appears after team selected | ✅ |
| 3.6 | Run analysis | Loading state shows, then result card appears with BUY/WATCH/PASS signal | ✅ |
| 3.7 | BUY signal | Green card, signal ≥ 30% below fair value | ✅ |
| 3.8 | WATCH signal | Amber card, 0–30% below fair value | ✅ |
| 3.9 | PASS signal | Red card, ask price above fair value | ✅ |
| 3.10 | AI narrative | 2–3 sentences, plain language, no bullet points or markdown | ✅ |
| 3.11 | Key players list | Up to 5 players shown with EV and upside figures; upside tooltip visible on hover | ✅ Tooltip added in b61ca4c |
| 3.12 | RC badge | Rookie players show red "RC" badge | ✅ |
| 3.13 | "View full break analysis →" link | Navigates to correct break page | ✅ |
| 3.14 | Enter $0 ask price | Should return PASS or handle gracefully — not crash | ✅ |
| 3.15 | Single case (cases = 1) | Fair value scales down correctly vs 10-case run on same team | ✅ |

---

## 4. Social Currency — Icon Tier

**Setup:** In `/admin/products/[id]/players`, mark one player as ★ Icon. Use a player who is in the top 5 by EV for their team (check the break page to confirm).

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 4.1 | Toggle ★ on a player | Button turns purple; page refreshes; state persists on reload | ⚠️ ~1s UI lag before state reflects — acceptable |
| 4.2 | Toggle ★ off | Returns to dim state; persists | ⚠️ Same lag |
| 4.3 | Run BreakIQ Sayz on a team with an icon player | Purple "★ Icon" badge appears next to that player in the key players list | 🔁 Re-test — icon players now always included in topPlayers even if outside top 5 |
| 4.4 | Icon player with high `buzz_score` | Slot cost should NOT be amplified — icon guard skips the multiplier | — Buzz score not yet a manual input (Phase 4) |
| 4.5 | AI narrative acknowledges icon player | Claude prompt includes icon context; narrative should mention the player's structural value | 🔁 Re-test alongside 4.3 |

---

## 5. Social Currency — High Volatility

**Setup:** In `/admin/products/[id]/players`, toggle ⚡ on one player.

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 5.1 | Toggle ⚡ on | Button turns amber; persists on reload | ⚠️ ~3s UI lag — acceptable |
| 5.2 | Toggle ⚡ off | Returns to dim; persists | ⚠️ Same lag |
| 5.3 | Run BreakIQ Sayz on a team with an HV player | Amber ⚡ advisory block appears below key players — shows player name, "EVs may shift significantly" language | ✅ |
| 5.4 | AI narrative acknowledges HV | Claude should note the uncertainty | ✅ |
| 5.5 | HV does NOT change fair value | The slot cost number itself should be identical whether HV is on or off — it's disclosure only | ✅ |

---

## 6. Social Currency — Risk Flags

**Setup:** In `/admin/products/[id]/players`, add a risk flag (⚑ Flag) to one player.

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 6.1 | Add a flag — Injury type | Flag type dropdown, note input, Add button; flag chip appears on player row after save | ✅ |
| 6.2 | Flag chip tooltip | Hovering the chip shows the full note text | ✅ |
| 6.3 | Add a second flag to same player | Both chips appear; both are independently clearable | ✅ |
| 6.4 | Clear a flag (×) | Chip disappears; cleared flag no longer shows in Sayz | ✅ |
| 6.5 | Flag persists on page reload | Cleared = gone, active = still there | ✅ |
| 6.6 | Run BreakIQ Sayz on flagged player's team | Flag banner shows with type-specific color (amber=injury, blue=trade, red=suspension/legal) | 🔁 Re-test — colors fixed in b61ca4c (was all-red) |
| 6.7 | Multiple players flagged | Multiple banners, one per flag | ✅ |
| 6.8 | Flag does NOT change fair value | Slot cost is identical whether a flag is set or not — disclosure only | ✅ |
| 6.9 | AI narrative mentions the flag | Claude prompt includes flag; narrative should name the player and the risk | ✅ |
| 6.10 | Add flag — Enter key submits | Pressing Enter in the note field triggers Add | ✅ |

---

## 7. Social Currency — BreakIQ Bets (B-score)

**Setup:** Go to `/admin/products/[id]`, scroll to BreakIQ Bets section.

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 7.1 | Textarea placeholder shows | Explains what to write | ✅ |
| 7.2 | "Parse Debrief →" disabled when empty | Button disabled with no text entered | ✅ |
| 7.3 | Enter a narrative and parse | Loading state shows; review table appears | ✅ |
| 7.4 | Player name matching | Named players matched correctly; no substitution of similar players not in the narrative | 🔁 Re-test — prompt hardened + name cross-validation added in b61ca4c |
| 7.5 | Score pills pre-selected | Claude's suggestion is pre-selected on the pill row | ✅ |
| 7.6 | Edit a score | Click a different pill; it becomes active | ✅ |
| 7.7 | Edit a note | Text field is editable | ✅ |
| 7.8 | Uncheck a player | Row goes to 40% opacity; excluded from save | ✅ |
| 7.9 | Low-confidence match | Amber "Review" badge appears on player row | 🔁 Re-test — now also triggers when returned name ≠ roster name |
| 7.10 | "Apply N updates →" saves | Button disabled until at least one row checked; success message shows saved count | ✅ |
| 7.11 | "Run another debrief" | Prominent button appears in success state; resets to idle | 🔁 Re-test — promoted from tiny text link to bordered button in b61ca4c |
| 7.12 | "← Edit narrative" | Goes back to textarea with narrative preserved | ✅ |
| 7.13 | Narrative with no recognizable players | "No players were identified" error shown, not a crash | 🔁 Re-test — JSON parse crash fixed in b61ca4c |
| 7.14 | BreakIQ Bets score affects Sayz fair value | After setting a positive B-score for a player, fair value is higher vs score=0 baseline | 🔁 Re-test after 7.4 fix — previous failure likely caused by wrong player matching |
| 7.15 | AI narrative references B-score note | If a note was set, Claude should mention it | 🔁 Re-test after 7.4 fix — same root cause |

---

## 8. Admin — Product Dashboard (`/admin/products/[id]`)

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 8.1 | Readiness summary tiles | Players count, CH match %, odds status, pricing count all correct | ✅ |
| 8.2 | Unmatched variants list | Shows up to 50 unmatched variants with player name, variant, card number | ✅ Note: CSV export of unmatched variants would be useful (backlog) |
| 8.3 | Import Odds — upload a Topps PDF | Processes and applies odds; "Odds imported" confirmation | ✅ Note: match rate was low; PDF parser may need improvement |
| 8.4 | Re-run Matching button | Chunked polling starts; progress updates; completion message | — Not tested in Round 1 |
| 8.5 | Quick Actions links | Manage Players, Import Checklist, View Break Page all navigate correctly | ✅ |

---

## 9. Admin — Player Management (`/admin/products/[id]/players`)

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 9.1 | Roster table | All players listed with team, RC, hobby sets, BD only, insert columns | ✅ Note: hobby/BD set counts may not add value — consider removing (backlog) |
| 9.2 | Player Flags & Settings section | Appears below roster for products with non-insert players | ✅ |
| 9.3 | Players sorted alphabetically in flags section | A-Z order | ✅ Note: should sort by last name; search field also needed (backlog) |
| 9.4 | Insert-only players excluded from flags section | Only eligible players appear | ✅ |
| 9.5 | Flag type resets to "Injury" on each new row expand | Open flag form for player A, change type, close. Open player B — type shows "Injury" | ✅ |
| 9.6 | Bulk player add | Enter players in the manual form; submit; roster table updates | ✅ |
| 9.7 | Checklist upload | PDF/CSV accepted; parsed results shown | ✅ |

---

## 10. Edge Cases & Error Handling

| # | Test | Expected | Round 1 |
|---|---|---|---|
| 10.1 | Sayz — product with no pricing cache | Analysis still runs (fetches live on the fly); may take longer | — Not tested |
| 10.2 | Sayz — team with only insert players | Should not crash; may return empty or a graceful error | — Not tested |
| 10.3 | Sayz — ask price of $0 | PASS signal; narrative handles $0 gracefully | — Not tested |
| 10.4 | Debrief — very long narrative (500+ words) | Parses successfully; no timeout | — Not tested |
| 10.5 | Debrief — narrative with no player names | "No players were identified" error, not a crash | — Not tested |
| 10.6 | Debrief — hallucinated player ID | Should not appear in results (hallucination guard filters it) | — Not tested |
| 10.7 | Flag note with special characters (`"`, `'`, `&`) | Saves and displays correctly, not escaped weirdly | — Not tested |
| 10.8 | Icon player with `breakerz_score = 0.5` | Fair value identical to same player with no scores — icon guard confirmed working | — Not tested |

---

## Known Issues (Do Not Flag)

- **`hobbyEVPerBox` reverts to `evMid` after first cache hit.** Odds-weighted calculation is only applied during a live pricing fetch, not stored in cache. After the 24h cache expires and refreshes, the first load from cache uses `evMid`. Expected behavior until `hobbyEVPerBox` is added to the cache schema.
- **Break page initial load shows $0 costs if no pricing cache exists.** User must click "Refresh live pricing" to trigger a live fetch. By design.
- **Sayz analysis can take 20–40 seconds** on first run for a product with no cache (live CardHedger fetches + Claude call). Expected.
- **BD break type toggle not shown for hobby-only products.** The BD toggle only appears when `bd_case_cost` is set on the product. By design.
- **BD slot cost shows $0 for hobby-only products.** Expected — BD weight calculation only applies when a product has BD cases.

---

## Backlog Items Surfaced in Round 1

- `/break/[slug]` URL is non-intuitive — consider `/products/[slug]`
- Comparison tab on break page has low utility — consider removing
- Unmatched variants: add CSV export for easier bulk analysis
- Player flags section: sort by last name (not first), add search/filter field
- Roster table: consider removing hobby/BD set count columns (low value, hard to maintain)
