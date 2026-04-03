# Bowman (Topps) — Manufacturer Rules

Covers all Bowman and Topps baseball products. Updated as new patterns are discovered during import and matching runs.

**Last updated:** 2026-04-02
**Products imported so far:** 2025 Bowman Draft, 2025 Bowman Draft Chrome, 2025 Bowman's Best Baseball, 2025 Bowman Chrome Baseball

---

## XLSX Structure Quirks

### Index sheets to skip (XLSX_SKIP_SHEETS)

Some Bowman/Topps XLSX files contain aggregate/index sheets that should not be imported as cards. These are in the `XLSX_SKIP_SHEETS` set in `lib/checklist-parser.ts`:

| Sheet name | Why skip |
|---|---|
| `Full Checklist` | Master index of all cards across all sheets — duplicates every row |
| `NBA Teams` | Team index sheet for basketball products — different column layout |
| `College Teams` | College index sheet — different column layout |
| `Teams` | MLB team index for Bowman Chrome Baseball — different column layout (player names land in `team` field if processed) |
| `MLB Teams` | Variant name for the Teams index sheet |
| `Topps Master Checklist` | Cross-product master checklist covering ALL Topps products — importing it bloats the players table with thousands of unrelated players |

**Discovered during 2025 Bowman Chrome Baseball import (2026-04-02):**
- The `Teams` sheet (857 rows) caused `players.team` to be populated with player names instead of MLB teams
- The `Topps Master Checklist` sheet (not specific to this product) added ~16,000 extra players before it was added to the skip list
- Recovery: delete all `player_products` for the affected product + orphaned players, then re-import

### XLSX column layout (Bowman Chrome Baseball)

Confirmed column order from 2025 Bowman Chrome Baseball XLSX:

| col | field | example |
|---|---|---|
| 0 | card number or code | `1`, `"BCP-153"`, `"CPA-AC"` |
| 1 | player name (no trailing comma) | `"Jacob Wilson"` |
| 2 | team or org | `"Athletics"`, `"San Francisco Giants"` |
| 3 | flag (optional) | `"RC"`, `"Rookie"` |

Note: Bowman Draft XLSX uses trailing commas on player names (`"Aaron Judge,"`); Bowman Chrome Baseball does not. The parser strips trailing commas from both player name and team fields defensively.

**Sheet names in 2025 Bowman Chrome Baseball:**
- `Base` — base set
- `Prospects` — Bowman Chrome Prospects
- `Variations` — short print / image variations
- `Autographs` — Chrome Autograph Relics
- `Inserts` — insert sets
- `Teams` ← skip
- `Topps Master Checklist` ← skip

### Team Sets inserts — card code stored as player name
In Team Sets insert sections of Bowman Draft checklists, the parser stores the **card number as the player name** instead of a real player name.

- DB row: `player_name = "BDC-170"`, `variant_name = "Base Set - Chrome Team Sets"`, `card_number = null`
- These ARE matchable — CardHedger indexes by card number with player name attached
- Detection regex: `/^[A-Z]+-[A-Z0-9]+$/` (no spaces, letters-dash-alphanumeric)
- Query strategy: `[year, shortSetName, cardCode]` — e.g. `"2025 Bowman Draft BDC-170"`
- CH will return the correct player; Claude must be told that card codes are unique identifiers (see Claude Context section below)

### Insert set names stored as variant_name
Some insert sets write the full insert set name into the `variant_name` field rather than a meaningful parallel descriptor.

| Variant in XLSX | What it actually is | Query action |
|---|---|---|
| `"2025 Draft Lottery Ping Pong Ball Autographs"` | Insert set name | Strip entirely |
| `"Bowman Spotlights"` | Insert set name | Strip entirely |
| `"Bowman In Action Autographs"` | Insert set name | Strip entirely |
| `"Base Set - Chrome Team Sets"` | Subsection label | Strip entirely |
| `"[auto set prefix] Autographs"` (after code stripped) | Leftover section label | Strip word "Autographs" after insert set stripping |
| `"Superfractor"` (Bowman's Best insert section label) | Section label for BMA/BPA/BTA/B25 sets | Strip "Superfractor" — CH uses parallel color names instead |
| `"Top Prospects"` | Bowman's Best insert section | Strip entirely |
| `"Stars of the Game"` | Bowman's Best insert section | Strip entirely |
| `"Base Teams"` | Bowman's Best team insert section | Strip entirely |
| `"Best Of 2025 [Autographs]"` | Bowman's Best insert section | Strip entirely |

### "Autographs" remaining after insert set stripping
Autograph inserts are named like `"DPPA-KW Autographs"` or `"CPA-DK Autographs"` in XLSX data. After the insert set regex strips the section name, `"Autographs"` may remain as the entire cleaned variant. This is NOT a CH variant descriptor — strip it. CH uses parallel color names for autograph cards (`"Base"`, `"Gold Ink"`, `"Red"`, `"Refractor"`, etc.).

### "Base - [Parallel] Variation" format
Bowman XLSX stores parallel names with a `"Base - "` prefix and `" Variation"` suffix.

- XLSX: `"Base - Retrofractor Variation"` → query should use: `"Retrofractor"` (or nothing if CH doesn't carry the term)
- XLSX: `"Base - Purple Refractor Variation"` → query should use: `"Purple Refractor"`
- Strip rule: remove `"Base - "` prefix and trailing `" Variation"`

---

## CardHedger Terminology Mismatches

These are terms Bowman uses in XLSX data that CardHedger does NOT use, and what CH calls them instead.

| Bowman/XLSX term | CardHedger equivalent | Notes |
|---|---|---|
| `Retrofractor` | `Base` or `Lazer Refractor` | Bowman-specific parallel name; CH doesn't distinguish it in many sets |
| `Base - [Parallel] Variation` | Just the parallel name | CH drops the "Base - " wrapper |
| `[anything] Variation` | [parallel name without "Variation"] | CH doesn't use "Variation" suffix |
| Print runs (`/50`, `/99`, `/25`) | Not in CH variant name | CH uses parallel name only; `/50` doesn't appear in CH's `variant` field |
| `2025 Draft Lottery Ping Pong Ball Autographs` | Not a CH variant | This is an insert set name, not a parallel |
| `Bowman Spotlights` | Not a CH variant | Insert set name |

---

## CardHedger Variant Naming (What CH Actually Uses)

Reference for what CH calls Bowman parallels so Claude can recognize them.

**Bowman Draft Chrome parallels (known):**
`Base`, `Refractor`, `Gold Refractor`, `Green Refractor`, `Blue Refractor`, `Purple Refractor`, `Sky Blue Refractor`, `Orange Refractor`, `Red Refractor`, `Gold`, `Green`, `Red`, `Orange`, `Superfractor`, `Lazer Refractor`, `Gold Ink`, `Gold Mini-Diamond`

**Bowman Draft (paper) parallels (known):**
`Base`, `Sky Blue`, `Green`, `Red`, `Orange`, `Gold`, `Superfractor`

**Autograph variant suffixes:**
CH appends variant color to autograph entries (e.g. `"Gold Ink"`, `"Refractor"`, `"Base"`). The autograph set prefix (CPA, AA, etc.) is part of the card number, not the variant.

---

## Card Number Format Guide

| Prefix | Full name | Type |
|---|---|---|
| `BDC-XXX` | Bowman Draft Chrome | Base (numbered) |
| `BD-XXX` | Bowman Draft (paper) | Base (numbered) |
| `CPA-XX` | Chrome Prospect Autographs | Auto insert |
| `AA-XX` | Achromatic Autographs | Auto insert |
| `PDA-XX` | Prospect Dual Autographs | Dual auto insert |
| `PPA-XX` | Prized Prospects Autographs | Auto insert |
| `BIA-XX` | Bowman In Action Autographs | Auto insert |
| `DPPA-XX` | Draft Ping Pong Ball Autographs (dual prefix) | Lottery auto insert |
| `FD-XX` | Bowman Spotlights (Future Draft) | Insert |
| `PP-XX` | Bowman Spotlights (another format) | Insert |
| `A-XX` | Axis inserts | Insert |

**Bowman's Best card code prefixes:**
| Prefix | Full name | Type |
|---|---|---|
| `B25-XX` | Best of 2025 | Prospect auto insert |
| `BMA-XX` | Bowman Masters Autographs | Auto insert |
| `BPA-XX` | Bowman Prospects Autographs | Auto insert |
| `BTA-XX` | Bowman Top Autographs | Auto insert |
| `TP-XX` | Top Prospects | Insert |
| `SG-XX` | Stars of the Game | Insert |
| `BP-XX` | Best Plays | Insert |
| `BSA-XX` | Bowman Stars Autographs | Auto insert |
| `CA-XX` | Champions Autographs | Auto insert |
| `DA-XX` | Dual Autographs | Dual auto insert |
| `TA-XX` | Triple Autographs | Triple auto insert |
| `QA-XX` | Quad Autographs | Quad auto insert |
| `FDA-XX` | Father/Son Dual Autographs | Dual auto insert |
| `FTA-XX` | Father/Son/Grandson Triple Autographs | Triple auto insert |
| `[number]` | Base Teams (e.g. "22", "67") | Team insert — pure numeric |

All letter-prefixed codes match `/^[A-Z][A-Z0-9]*-[A-Z0-9]+$/` (prefix may contain digits, e.g. B25-NK). Pure numeric codes (Base Teams) require `/^\d+$/`. Combined regex in code: `/^([A-Z][A-Z0-9]*-[A-Z0-9]+|\d+)$/`

**Multi-player autograph cards (DA-/TA-/QA-/FDA-/FTA-):** The XLSX stores slash-delimited player names (e.g. `"Dylan Crews/James Wood"`). These are reformulated to code-only queries (`[year, setName, cardCode]`) since CH can't match slash-delimited names. These cards will generally remain unmatched — CH doesn't reliably return them via code search either. **Known structural limit.**

---

## Claude Matching Context

This is the context block to inject into the Claude Haiku prompt for Bowman products. Tells Claude what it needs to know to match correctly.

```
Bowman/Topps-specific matching rules:
- Year must match exactly. If the query says 2025, reject any candidate from 2022, 2023, or 2024 even if the player name and set name are similar.
- Card numbers uniquely identify a player in a given set (both letter-prefixed codes like BDC-91, B25-SS, BMA-JG, TP-8 AND short numbers like 38, 1, 69). If a candidate's number field matches a number in the query AND the player name and set match, that IS the correct card. Assign confidence 0.9 or higher even if the variant differs — the exact parallel is not always known.
- Accented characters in the query match unaccented names in CardHedger: "Jesús" = "Jesus", "Rodríguez" = "Rodriguez", "José" = "Jose", "Agustín" = "Agustin". Do not reject a match because of accent differences.
- "Retrofractor" in the query = "Base" or "Lazer Refractor" in CardHedger. "Black" in the query = "Base" in CardHedger. Do not reject a match because the candidate says "Base" when the query says "Retrofractor" or "Black".
- Print runs (/50, /99, /25) appear in source data but NOT in CardHedger variant names — ignore them when comparing.
- Insert set names (Top Prospects, Stars of the Game, Best Of 2025, Bowman Spotlights, Draft Lottery Ping Pong Ball) and section labels ("Autographs", "Teams") may appear in the query but are not variant descriptors — focus on player, set, and card number.
- Parallel names appear without "Variation" suffix in CardHedger.
```

*(This is the live `claudeContext()` string from `lib/card-knowledge/bowman.ts` — keep in sync.)*

---

## Query Construction Rules

Applied in this order before calling `cardMatch()`:

1. **Year:** Extract from product name (`"2025 Bowman Draft Baseball"` → `"2025"`). Always include as standalone token.
2. **Set name:** Strip year prefix and sport suffix (`"2025 Bowman Draft Baseball"` → `"Bowman Draft"`).
3. **Card-code player names:** If player_name matches `/^[A-Z]+-[A-Z0-9]+$/`, build query as `[year, setName, playerName]` only. Do NOT include variant_name.
4. **Variant cleaning (normal cards):**
   - Strip `"Base - "` prefix
   - Strip trailing `" Variation"`
   - Strip `"Retrofractor"` (CH doesn't use it)
   - Strip known insert set names: `"Draft Lottery Ping Pong Ball"`, `"Bowman Spotlights"`, `"Bowman In Action Autographs"`
   - Strip standalone `"Autographs"` / `"Autograph"` remaining after insert set stripping
   - If cleaned variant is empty, omit from query entirely
5. **Final query (normal):** `[playerName, year, setName, cardNumber, cleanedVariant].filter(Boolean).join(' ')`

---

## Known Remaining Edge Cases / Structural Limits

| Case | Status | Notes |
|---|---|---|
| Print run in variant name | ✅ Fixed | Stripped in `cleanVariant()` via `/\s*\/\d+\s*/g` |
| Dual/triple/quad autograph cards (DA-/TA-/QA-/FDA-/FTA-) | ⚠️ Structural limit | Reformulated to code-only queries; CH doesn't reliably match these via code search. ~3-4% of Bowman's Best variants. See BACKLOG for future direction. |
| `CPA-*` Chrome Prospect Autographs in Bowman Chrome Baseball | ⚠️ Structural limit | CH returns `BCP-*` base card numbers for these players, not CPA codes. No match found via code query. Cards remain unmatched on the product dashboard. |
| Code-only duplicate rows (BMA-XX, BPA-XX as player_name) | ⚠️ Structural limit | CH doesn't expose `number` field for autograph sets; Tier 1 fails, Tier 2 has no playerName. ~20% of Bowman's Best variants, many are parallel duplicates of already-matched cards. |

---

## Match Rate History

### 2025 Bowman Draft

| Date | Change | Match Rate |
|---|---|---|
| 2026-03-30 | Initial run | ~15–29% |
| 2026-03-30 | Shorter set name, sport param, 10 candidates, variant_name in query | ~62–69% |
| 2026-03-30 | Strip "Base - " / "Variation", Retrofractor, card-code skip | ~72% |
| 2026-03-30 | Strip Ping Pong Ball, Bowman Spotlights | ~72% (same — skips were in denominator) |
| 2026-03-30 | Card-code → search by code, year added to all queries | ~88% |
| 2026-03-31 | Manufacturer knowledge system live; claudeContext() injected into Haiku prompt | **~95%** |

### 2025 Bowman Chrome Baseball

| Date | Change | Match Rate |
|---|---|---|
| 2026-04-02 | First import — discovered Teams + Topps Master Checklist sheets cause data corruption | — |
| 2026-04-02 | Added Teams + Topps Master Checklist to skip list; re-import with correct XLSX | TBD after matching run |

### 2025 Bowman's Best Baseball

| Date | Change | Match Rate |
|---|---|---|
| 2026-03-31 | First run (no Best-specific rules yet) | ~12% |
| 2026-03-31 | Pre-Claude card-code bypass (Tier 1); hard year filter; Bowman's Best insert set names added | ~63% |
| 2026-03-31 | CARD_CODE_RE extended for B25-* / FDA-* / QA-*; strip Superfractor + Autographs section labels | ~71% |
| 2026-03-31 | Multi-player reformulation (DA-/TA-/QA-) | ~71% (structural, no rate gain) |
| 2026-03-31 | Tier 2 first-name comparison; `player_name ?? player` runtime fallback fix | **~76% — practical ceiling** |

Remaining ~24% is structural: multi-player autos + code-only duplicate rows CH can't resolve.
