# Bowman (Topps) — Manufacturer Rules

Covers all Bowman and Topps baseball/basketball products. Updated as new patterns are discovered during import and matching runs.

**Last updated:** 2026-04-20
**Products imported:** 2025 Bowman Draft, 2025 Bowman Draft Chrome, 2025 Bowman's Best Baseball, 2025 Bowman Chrome Baseball, 2025-26 Bowman Basketball

---

## CardHedger Matching — Key Discoveries

### Set naming (confirmed by River @ CardHedger, 2026-04-20)

CH set names must match exactly — mismatch silently returns the full corpus (~2.9M cards).

**Use `/v1/cards/set-search` to discover canonical names** before importing a product. Store the result in `products.ch_set_name`. The matching route uses this directly in set-catalog mode.

Example:
```
POST /v1/cards/set-search { "search": "2025 Bowman Chrome", "category": "Baseball" }
→ "2025 Bowman Chrome Prospects Baseball"  ← canonical name
```

**Gotcha:** CH puts autograph cards (CPA-*, BMA-*, etc.) under the **parent set**, not a separate "Autographs" set. Don't search for "2025 Bowman Chrome Prospect Autographs Baseball" — it doesn't exist as its own set.

**2026+ note:** Bowman Chrome Prospects will merge into the parent Bowman Chrome set. `2026 Bowman Chrome Baseball` will contain base, prospects, and autos. Use `set-search` to verify canonical names for 2026 products.

### Autograph query pattern (confirmed by River, 2026-04-20)

For autograph card codes, always append **"Autograph"** to the search query. Without it, base BCP cards outrank the autograph in search results.

- ✅ `"2025 Bowman's Best Baseball BMA-JJW Autograph"` → returns Best Mix Auto
- ❌ `"2025 Bowman's Best Baseball BMA-JJW"` → base card wins

Implemented in `BowmanKnowledge.reformulateQuery()` via `AUTO_CODE_RE`.

### Number field (confirmed by River, 2026-04-20)

The `number` field IS populated for all auto prefixes in CH's catalog. If we get `number: null` from a search, it's a fuzzy fallback returning unrelated cards — not a missing data gap. Fix: use more specific queries or set-catalog mode for local matching.

### Set-catalog matching mode

New as of 2026-04-20. Pass `mode: 'set-catalog'` to `/api/admin/match-cardhedger` (now the default in RunMatchingButton).

1. Uses stored `products.ch_set_name` (or runs `set-search` if not set)
2. Paginates through all cards in set via `card-search?set=` (~94 calls for a 9,400-card set)
3. Builds `card_number → card_id` map locally
4. Matches variants by exact card number at confidence 0.95
5. Falls back to individual Claude matching for anything not found

**Result on 2025 Bowman's Best:** 88% → **96%** match rate.

---

## Card Number Prefix Reference

### Bowman Draft / Chrome

| Prefix | Full Name | Type |
|---|---|---|
| `BDC-XXX` | Bowman Draft Chrome | Base prospect |
| `BD-XXX` | Bowman Draft (paper) | Base prospect |
| `BCP-XXX` | Bowman Chrome Prospect | Base prospect (Chrome Baseball) |
| `CPA-XX` | Chrome Prospect Autographs | Auto insert |
| `AA-XX` | Achromatic Autographs | Auto insert |
| `PDA-XX` | Prospect Dual Autographs | Dual auto |
| `PPA-XX` | Prized Prospects Autographs | Auto insert |
| `BIA-XX` | Bowman In Action Autographs | Auto insert |
| `DPPA-XX` | Draft Ping Pong Ball Autographs | Lottery auto insert |
| `FD-XX` | Bowman Spotlights (Future Draft) | Insert |
| `PP-XX` | Bowman Spotlights | Insert |

### Bowman's Best

| Prefix | Full Name | Type | Confirmed by |
|---|---|---|---|
| `BMA-XX` | **Best Mix Auto** | Auto insert | River @ CH, 2026-04-20 |
| `BPA-XX` | **Best Performances Auto** | Auto insert | River @ CH, 2026-04-20 |
| `FDA-XX` | **Family Tree Dual Auto** | Dual auto | River @ CH, 2026-04-20 |
| `CA-XX` | **Chrome Auto** | Auto insert | River @ CH, 2026-04-20 |
| `BTA-XX` | Best of the Best Top Autographs | Auto insert | |
| `BSA-XX` | Bowman Stars Autographs | Auto insert | |
| `FTA-XX` | Family Tree Triple Auto | Triple auto | |
| `DA-XX` | Dual Autographs | Dual auto | |
| `TA-XX` | Triple Autographs | Triple auto | |
| `QA-XX` | Quad Autographs | Quad auto | |
| `B25-XX` | Best of 2025 | Prospect auto insert | |
| `TP-XX` | Top Prospects | Insert | |
| `SG-XX` | Stars of the Game | Insert | |
| `BP-XX` | Best Plays | Insert | |
| `[number]` | Base Teams (e.g. "22", "67") | Team insert — pure numeric | |

**Auto prefixes requiring "Autograph" appended to query:**
`BMA`, `CPA`, `BPA`, `FDA`, `BSA`, `BRA`, `CRA`, `CA`, `QA`, `DA`, `TA`

**Multi-player cards (DA-/TA-/QA-/FDA-/FTA-):** XLSX stores slash-delimited names (e.g. `"Dylan Crews/James Wood"`). Reformulated to code-only queries. CH doesn't reliably match these — structural limit.

---

## XLSX Structure Quirks

### Sheets to skip

| Sheet name | Why |
|---|---|
| `Full Checklist` | Master index — duplicates every row |
| `NBA Teams` | Team index — different column layout |
| `College Teams` | College index — different column layout |
| `Teams` | MLB team index — player names land in `team` field if processed |
| `MLB Teams` | Variant of Teams sheet |
| `Topps Master Checklist` | Cross-product master — adds ~16,000 unrelated players |

**Discovered during 2025 Bowman Chrome Baseball import (2026-04-02):** The `Teams` sheet caused `players.team` to be populated with player names. The `Topps Master Checklist` added ~16,000 extra players. Both are now in the skip list.

### Column layout (Bowman Chrome Baseball)

| col | field | example |
|---|---|---|
| 0 | card number | `1`, `"BCP-153"`, `"CPA-AC"` |
| 1 | player name | `"Jacob Wilson"` |
| 2 | team | `"Athletics"` |
| 3 | flag (optional) | `"RC"` |

Bowman Draft XLSX uses trailing commas on player names (`"Aaron Judge,"`); Bowman Chrome Baseball does not. Parser strips trailing commas from both fields defensively.

### Insert set names stored as variant_name

Strip these entirely — they are section labels, not CH variant descriptors:

- `"2025 Draft Lottery Ping Pong Ball Autographs"`
- `"Bowman Spotlights"`, `"Bowman In Action Autographs"`
- `"Base Set - Chrome Team Sets"`
- `"Top Prospects"`, `"Stars of the Game"`, `"Base Teams"`, `"Best Of 2025"`
- Standalone `"Autographs"` / `"Superfractor"` after insert set stripping

### Parallel name format

Bowman XLSX: `"Base - Purple Refractor Variation"` → strip `"Base - "` and `" Variation"` → query with `"Purple Refractor"`

---

## CardHedger Terminology Mismatches

| XLSX / Bowman term | CardHedger equivalent |
|---|---|
| `Retrofractor` | `Base` or `Lazer Refractor` |
| `Base - [Parallel] Variation` | Just the parallel name |
| `[anything] Variation` | [parallel without "Variation"] |
| Print runs (`/50`, `/99`) | Not in CH variant name |
| Insert set names | Not CH variant descriptors |

---

## Claude Context (injected into Haiku prompt)

```
Bowman/Topps-specific matching rules:
- Year must match exactly. Reject candidates from other years even if player and set match.
- Card numbers uniquely identify a player in a set (BDC-91, B25-SS, BMA-JG, TP-8, or pure numbers like 38, 1, 69). If a candidate's number matches and player+set match, confidence >= 0.9 even if variant differs.
- Accented characters match unaccented: "Jesús" = "Jesus", "Rodríguez" = "Rodriguez".
- "Retrofractor" in query = "Base" or "Lazer Refractor" in CH. "Black" in query = "Base" in CH.
- Print runs (/50, /99, /25) appear in source data but NOT in CH variant names — ignore when comparing.
- Insert set names (Top Prospects, Stars of the Game, Best Of 2025, Bowman Spotlights, Draft Lottery Ping Pong Ball) and section labels ("Autographs", "Teams") are not variant descriptors — focus on player, set, and card number.
- Parallel names appear without "Variation" suffix in CardHedger.
- CPA/BMA/BPA/FDA/BSA/BRA autograph cards live in the PARENT set in CH's catalog, NOT in a separate "Autographs" set.
- NOTE (2026+): Bowman Chrome Prospects merges into parent Bowman Chrome set.
```

*(Keep in sync with `lib/card-knowledge/bowman.ts` `claudeContext()`.)*

---

## Match Rate History

### 2025 Bowman Draft

| Date | Change | Match Rate |
|---|---|---|
| 2026-03-30 | Initial run | ~15% |
| 2026-03-30 | Shorter set name, sport param, variant in query | ~69% |
| 2026-03-30 | Strip "Base - " / "Variation", Retrofractor, card-code skip | ~72% |
| 2026-03-30 | Card-code → search by code, year in all queries | ~88% |
| 2026-03-31 | Manufacturer knowledge + claudeContext() | **~95%** |

### 2025 Bowman's Best Baseball

| Date | Change | Match Rate |
|---|---|---|
| 2026-03-31 | First run | ~12% |
| 2026-03-31 | Card-code bypass, hard year filter, insert set stripping | ~63% |
| 2026-03-31 | CARD_CODE_RE extended, Superfractor stripping | ~71% |
| 2026-03-31 | Multi-player reformulation, Tier 2 first-name comparison | ~76% |
| 2026-04-20 | Autograph query fix ("Autograph" appended for auto prefixes) | ~88% |
| 2026-04-20 | River @ CH adds BMA/BPA/FDA cards to catalog + set-catalog mode | **~96%** |

### 2025 Bowman Chrome Baseball

| Date | Change | Match Rate |
|---|---|---|
| 2026-04-02 | Fixed Teams + Topps Master Checklist sheet import | — |
| 2026-04-20 | Set-catalog mode + autograph query fix | TBD — re-run matching |

---

## Known Remaining Limits

| Case | Status | Notes |
|---|---|---|
| Multi-player autos (DA-/TA-/QA-/FDA-/FTA-) | ⚠️ Structural | CH doesn't reliably match slash-delimited names. ~2-3% of Bowman's Best. |
| 2025-26 Bowman Basketball CPA cards | ⏳ Pending | River adding to CH this week (2026-04-20). Re-run matching after. |
| 2026+ Bowman Chrome Prospects merge | ℹ️ Future | Will fold into parent Bowman Chrome set. Use `set-search` to get canonical name. |
