# Bowman (Topps) — Manufacturer Rules

Covers all Bowman and Topps baseball products. Updated as new patterns are discovered during import and matching runs.

**Last updated:** 2026-04-01
**Products imported so far:** 2025 Bowman Draft, 2025 Bowman Draft Chrome, 2025 Bowman's Best Baseball

---

## XLSX Structure Quirks

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
| `DA-XX` | Dual Autographs | Dual auto insert |
| `TA-XX` | Triple Autographs | Triple auto insert |
| `[number]` | Base Teams (e.g. "22", "67") | Team insert — pure numeric |

All letter-prefixed codes match `/^[A-Z]+-[A-Z0-9]+$/`. Pure numeric codes (Base Teams) require `/^\d+$/`. Combined regex: `/^([A-Z]+-[A-Z0-9]+|\d+)$/`

---

## Claude Matching Context

This is the context block to inject into the Claude Haiku prompt for Bowman products. Tells Claude what it needs to know to match correctly.

```
Bowman-specific matching rules:
- Card codes (BDC-91, CPA-KK, AA-FA, BD-35, etc.) are unique per player in a given set. The query may contain ONLY the card code with no player name — this is intentional. If CardHedger returns ANY candidate whose card number matches the code in the query, that IS the correct card. Assign confidence 0.9 or higher. Do NOT require a player name in the query to confirm a match.
- "Retrofractor" in the query = "Base" or "Lazer Refractor" in CardHedger. Do not reject a match because the candidate says "Base" when the query says "Retrofractor".
- Print runs (/50, /99, /25) appear in source data but NOT in CardHedger variant names — ignore them when comparing.
- Insert set names (Bowman Spotlights, Draft Lottery Ping Pong Ball) and the word "Autographs" may appear in the query but are not variant descriptors — focus on player, set, and card number.
- Parallel names appear without "Variation" suffix in CardHedger.
```

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

## Known Remaining Edge Cases

| Case | Status | Notes |
|---|---|---|
| Steele Hall BDC-20 | Unresolved | CH returns "Lazer Refractor" variant; Claude rejects because query has no player name (card-code case). Manufacturer context injection should fix this. |
| Franklin Arias AA-FA (Ping Pong Ball) | Partially resolved | CH finds correct player but returns "Gold" variant; confidence borderline. May need `review` status accepted. |
| Print run in variant name | Not handled | `"/50"` still appears in some variant strings. CH doesn't include print run in variant field — strip it. |
| Dual-player entries (`"Malachi Witherspoon/Kyson Witherspoon"`) | Unresolved | Player name contains two names for dual autograph cards. CH indexes these under the first player only. Need to test whether splitting on `/` and querying each helps. |

---

## Match Rate History (2025 Bowman Draft)

| Date | Change | Match Rate |
|---|---|---|
| 2026-03-30 | Initial run | ~15–29% |
| 2026-03-30 | Shorter set name, sport param, 10 candidates, variant_name in query | ~62–69% |
| 2026-03-30 | Strip "Base - " / "Variation", Retrofractor, card-code skip | ~72% |
| 2026-03-30 | Strip Ping Pong Ball, Bowman Spotlights | ~72% (same — skips were in denominator) |
| 2026-03-30 | Card-code → search by code, year added to all queries | ~88% |
| 2026-03-31 | Manufacturer knowledge system live; claudeContext() injected into Haiku prompt | 95% |
| 2026-04-01 | Strip "Autographs" after insert-set stripping; strengthen card-code Claude context | TBD (target: 97%+) |
| 2026-04-01 | **Bowman's Best first run:** baseline 12% → running with updated knowledge (strip Superfractor, Top Prospects, SG, Base Teams, Best Of 2025; numeric card-code detection; year-match Claude rule) | TBD |
