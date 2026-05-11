# 2026-05-11 — Full product audit (post-Bowman-Draft-Sapphire investigation)

**Context.** Today's Bowman Draft Sapphire investigation revealed mass mis-anchoring: 14 "Royals" players (vs. 8 actual in Topps' checklist), 6 contamination players from a completely different umbrella set. Suspected the pattern was broader. Audit confirms it is.

**Status:** Investigation complete; remediation pending per-product decisions.

---

## Audit signals examined

For every `is_active = true` product:
- Does `ch_set_name` exist in CH catalog? (verified via `/set-search`)
- Does the same `ch_set_name` back multiple products (duplicate / conflation)?
- Player count, variant count, unmatched-pp rate
- Card-number prefix distribution vs. expected for the product family
- Pricing freshness

Method: SQL aggregation + CH set-search probes. All 21 active products checked.

---

## 🚨 P0 — Live products with bad data right now

### 1. Duplicate products (one ch_set_name backing two product rows)

| `ch_set_name` | Product A | Product B | Note |
|---|---|---|---|
| `2025 Topps Baseball` | Topps Series 1 Baseball (`topps-series-1-baseball-2025`, 1,250 pps / 45,552 variants) | Baseball Series 2 (`baseball-series-2`, 1,196 pps / 37,666 variants) | Already captured as Q14 / PR #73; needs operational re-hydrate to land |
| `2025 Topps Finest Basketball` | 2025-26 Topps Finest Basketball (`2025-26-topps-finest-basketball`, 248/12,097) | Topps Finest Basketball (`topps-finest-basketball-2025-26`, 246/12,097) | Same data on both — one is a stale duplicate |
| `2025 Topps Midnight Basketball` | 2025-26 Topps Chrome Basketball Midnight (`2025-26-topps-chrome-basketball-midnight`, 232/6,152) | 2025-26 Topps Midnight Basketball (`topps-midnight-basketball-2025-26`, 232/6,152) | Same data on both — one is a stale duplicate |

**Action:** Decide which product slug is canonical, delete the duplicate. Two slugs serving the same data is a consumer-trust risk (admin sees stale stats, breakers can land on the wrong page from search engines).

### 2. Broken / unconfigured products

| Product | State | Severity |
|---|---|---|
| `2025 Donruss Football` (`2025-donruss-football`) | `ch_set_name=null`, `hobby_case_cost=null`, 151 player_products, 0 variants, 100 pricing_cache rows (meaningless without variants). Created 2026-03-17 (2 months ago). | **Live in production with no real data.** Either pre-CH-ingestion (like Bowman Draft Sapphire was) or never finished configuring. |
| `2024 Panini Prizm Football` (`2024-panini-prizm-football`) | Created 2026-05-06 (this week). `ch_set_name` set but 0 player_products, 0 variants. Empty shell. | Mid-setup or abandoned — needs decision: finish or delete. |
| `2025 Bowman Draft Baseball` (`2025-bowman-draft-baseball`) | 235 pps / 1,601 variants. Card-number prefix distribution: 0 BCP, 0 BDC, 1 CPA, 0 numeric. **None of the expected Bowman Draft prefixes are present.** Likely the same Sapphire-Draft pattern: wrong CH umbrella. | Suspected mis-anchored; needs the same investigation we ran on Sapphire-Draft. |

---

## ⚠️ P1 — Elevated unmatched rates worth investigating

| Product | Unmatched pps | Total pps | Rate | Likely cause |
|---|---|---|---|---|
| 2025 Panini Prizm Football | 173 | 592 | **29%** | Master Checklist multi-player rows + Panini-only insert subjects CH doesn't track |
| 2024 Panini Donruss Optic | 137 | 471 | **29%** | Same |
| Topps Series 1 Baseball | 49 | 1,250 | 4% | Already captured under PR #73 — productScope predicate will clean up after re-import |
| Topps Series 2 Baseball | 20 | 1,196 | 2% | Same |
| 2025 Topps Pristine Baseball | 2 | 344 | <1% | Likely fine |

Panini's ~29% unmatched rate is the same pattern across products — suggests a Panini-specific matching gap. Probably the Master Checklist multi-player rows + insert subjects whose Panini codes don't resolve cleanly. Track but don't block on.

---

## ⚠️ P2 — Awaiting CH ingestion (Q15 territory)

- `2025 Bowman Draft Baseball Sapphire` — already cleaned + parked (is_active=false, ch_set_name=`2025 Bowman Draft Chrome Baseball`). Revive when CH adds canonical Sapphire entry.

---

## 🟢 OK — products with clean signals

These 12 products have valid `ch_set_name`, reasonable player count, normal prefix patterns, and recent pricing. No action needed beyond ongoing maintenance:

- 2025 Bowman Chrome Baseball
- 2025 Bowman Basketball (2025-26)
- 2025 Bowman's Best Baseball
- 2025 Topps Chrome Basketball (2025-26)
- 2025 Topps Chrome Sapphire Basketball (2025-26)
- 2025 Topps Cosmic Chrome Basketball (2025-26)
- 2025 Topps 3 Basketball (2025-26)
- 2025 Topps Pristine Baseball
- 2026 Bowman Baseball (pre_release, no ch_set_name expected)

(Some of these may have minor issues uncovered by deeper investigation — but no obvious red flags at the audit-signal level.)

---

## Remediation order (suggested)

1. **Topps Finest Basketball duplicate cleanup** — confirm which slug is the canonical one (probably `2025-26-topps-finest-basketball` per the typical slug convention) and delete the other. ~5 min.
2. **Topps Midnight Basketball duplicate cleanup** — same approach. ~5 min.
3. **Topps Series 1 + Series 2** — already PR #73 plumbing landed; re-import checklists for both with `checklist_card_numbers` populated, then hydrate. The productScope predicate handles the rest. ~30 min.
4. **2025 Bowman Draft Baseball** — investigate. If it's the Sapphire-pattern mis-anchor, apply the same Option B cleanup (is_active=false, delete derived data, await CH coverage or correct the anchor to flagship). ~10 min once root cause confirmed.
5. **2025 Donruss Football** — investigate. Same Sapphire-pattern risk. ~10 min.
6. **2024 Panini Prizm Football** — decide: finish setup or delete the empty shell. ~5 min either way.
7. **Panini unmatched-rate investigation** — separate work item; lower priority than the above blockers. ~few hours.

Total to clear P0 list: ~1 hour.

---

## Why this audit was overdue

Three structural reasons for the accumulation:

1. **No automated coverage check.** Every product anchor was eyeballed at admin setup time. No mechanism flags "your `ch_set_name` produces a roster that disagrees with your imported checklist by N%." That's the right shape for a long-term safeguard (admin dashboard widget, or just a CLI script).
2. **The "Find on CH" search ranks by 30d sales volume** — so a stale 2022 entry can out-rank a missing 2025 entry, making the wrong choice look like the right one. Admin doesn't always catch this.
3. **Phase 3 auto-create in `hydrateVariantsFromCatalog`** silently expanded the player_product roster from CH catalog without verifying the players were actually in the imported checklist. PR #73 fixed this with the productScope predicate, but the historical data is still polluted on every product hydrated before that fix.

---

## Suggested follow-up automation (BACKLOG candidates)

- **Per-product audit widget** in the admin product page: shows the audit signals (variant count vs. expected, prefix distribution, unmatched rate, "products sharing ch_set_name") and flags anomalies.
- **Set-name validator** on the admin product form: when admin sets `ch_set_name`, immediately probe CH and warn if no exact match, or if multiple of our products would share that anchor.
- **Cron-driven nightly audit** that emails / Slacks anomalies (variant count jumped 50%, new unmatched pps appeared, duplicate ch_set_name detected).

None of these are needed to fix today's findings — they prevent the next round.
