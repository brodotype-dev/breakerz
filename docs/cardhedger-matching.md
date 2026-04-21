# CardHedger Matching — Architecture, Decisions & Manufacturer Knowledge

> **Current architecture (v2, 2026-04-21):** catalog pre-load. See [catalog-preload-architecture.md](./catalog-preload-architecture.md) for the canonical design doc. This file retains the v1 history for context and the evolving manufacturer rule catalogue.

## What This Is

This doc captures everything learned building the CardHedger auto-matching system — the architecture, failure modes, query construction rules, and the path toward a scalable descriptor-based approach for handling manufacturer-specific card catalog knowledge.

The core problem: we import product checklists from manufacturer XLSXs (Topps, Panini, Bowman) and need to link each variant row to a CardHedger `card_id` so we can pull live pricing. The XLSX data and CH's catalog use different terminology, abbreviations, and naming conventions. Bridging that gap is the matching problem.

---

## Architecture

### Components

```
match-cardhedger/route.ts
  ↓ builds query string per variant
  ↓ calls cardMatch() for each
lib/cardhedger.ts → cardMatch()
  ↓ searchCards(query, sport)         → CH /v1/cards/card-search
  ↓ claudeCardMatch(query, candidates) → Claude Haiku (semantic matching)
  ↓ tokenCardMatch(query, card)        → fallback: token overlap scoring
  → { card_id, confidence, topResult }
```

### Flow per variant
1. Build query string from: `year + player_name + set_name + card_number + cleaned_variant`
2. Search CH free-text (`/v1/cards/card-search`) → top 10 results
3. Claude Haiku sees: query + numbered candidate list → returns `{ card_id, confidence }`
4. If Claude fails/errors → token overlap fallback against top result
5. `confidence >= 0.7` → **auto** (write `cardhedger_card_id` to DB)
6. `confidence >= 0.5` → **review** (write `match_confidence` only, flag for human review)
7. `confidence < 0.5`  → **no-match**

### Chunked polling
The UI calls the API in chunks of 40 variants with a concurrency of 8 Claude calls per chunk. The frontend polls until `hasMore = false`, accumulating progress. This avoids Vercel's 60s function timeout on large products (500–1000+ variants).

---

## What CardHedger Is (and Isn't)

**CardHedger is a pricing and search API — not a product catalog.**

- `/v1/cards/card-search` is free-text search only. You must know what you're looking for.
- There is no endpoint to pull "all cards in a given set."
- It cannot replace XLSX imports as the source of truth for: full roster, all variants, card numbers, print runs, pull odds.

**CardHedger's role:** Enrichment only — match our imported checklist items to `card_id`s, then pull live pricing via `getAllPrices()`, `getComps()`, `batchPriceEstimate()`.

---

## Query Construction — Current Rules

The query is built in `match-cardhedger/route.ts` before calling `cardMatch()`.

```typescript
// Normal variants:
query = [playerName, productYear, shortSetName, card_number, cleanedVariant].filter(Boolean).join(' ')

// Card-code player names (see below):
query = [productYear, shortSetName, playerName_as_code].filter(Boolean).join(' ')
```

### Set name cleaning
Strip year prefix and sport suffix from product name — CH doesn't need them, they add noise:
- `"2025 Bowman Chrome Baseball"` → `"Bowman Chrome"`
- `"2025-26 Topps Chrome Basketball"` → `"Topps Chrome"`

Year is extracted separately and prepended to the query as a standalone token. This is critical for cross-vintage disambiguation (e.g. `BD-89` exists in 2016, 2020, and 2025 Bowman Draft).

### Variant name cleaning (`cleanVariant()`)
Strips terms that appear in XLSX data but that CH doesn't use or that pollute the search:

| Pattern | Rule | Why |
|---|---|---|
| `"Base - Retrofractor Variation"` | Strip `"Base - "` prefix | CH doesn't differentiate Retrofractors from Base in many entries |
| `"... Variation"` (trailing) | Strip `" Variation"` suffix | Generic noise term |
| `"Retrofractor"` | Strip entirely | Bowman-specific term; CH calls these "Base" or "Lazer Refractor" |
| `"2025 Draft Lottery Ping Pong Ball"` | Strip entirely | Insert set name stored as variant in XLSX |
| `"Bowman Spotlights"` | Strip entirely | Insert set name stored as variant in XLSX |

---

## Card-Code Player Names

A recurring XLSX parsing artifact: in "Team Sets" insert sections of Bowman Draft checklists, the parser stores the card code as the player name instead of a real player name.

**Example:** DB row has `player_name = "BDC-170"`, `variant_name = "Base Set - Chrome Team Sets"`, `card_number = null`.

**These ARE matchable.** CardHedger indexes cards by card number and includes the player name in the result. Querying `"2025 Bowman Draft BDC-170"` uniquely identifies the card and CH returns the correct player.

**Detection regex:** `/^[A-Z]+-[A-Z0-9]+$/` — no spaces, letters-dash-alphanumeric (matches BDC-170, CPA-KC, AA-FA, BIA-GK, PDA-DM, etc.)

**Query for card-code variants:**
```
[productYear, shortSetName, cardCode].join(' ')
// e.g. "2025 Bowman Draft BDC-170"
```

The card code is passed as `cardNumber` to `cardMatch()` so the fallback retry also uses it.

---

## Failure Patterns Found (and Status)

| Pattern | Root Cause | Fix | Status |
|---|---|---|---|
| CH MATCHED showing 0/0 on dashboard | Supabase `.in()` URL limit silently fails with 900+ UUIDs | Rewrote all queries to use join-based `.eq('player_products.product_id', id)` | ✅ Fixed |
| "undefined · undefined" in CH column | CH API returns `player`/`set` fields, interface expected `player_name`/`set_name` | Added fallbacks: `top.player_name ?? top.player ?? ''` | ✅ Fixed |
| `console.table()` disappearing in <1s | `router.refresh()` in Next.js App Router wipes the console | Moved debug output to in-UI table stored in component state | ✅ Fixed |
| Low match rate (~15–29%) | Query too long/noisy; sport param missing; only 5 candidates shown to Claude | Shorter set name, sport param, 10 candidates, variant_name in query | ✅ Fixed |
| "Base - Retrofractor Variation" no-match | "Retrofractor" in query conflicts with CH's "Base" variant | Strip Retrofractor from query | ✅ Fixed |
| Card-code player names failing | Treated as skippable, no API call made | Query by card code; year anchors to correct vintage | ✅ Fixed |
| "Ping Pong Ball Autographs" no-match | XLSX stores insert set name as variant_name | Strip from cleanVariant() | ✅ Fixed |
| Cross-vintage false matches | No year in query; `BD-89` matches 2016, 2020, 2025 | Add productYear as standalone token | ✅ Fixed |
| Odds matching returning 0 | Exact substring match fails on plurals ("autograph" vs "autographs") | Token-overlap scoring with prefix matching (≥0.5 threshold) | ✅ Fixed |
| Wrong-year CH results (Paul Skenes 2024 in 2025 product) | Claude context insufficient; CH ranks by relevance not year | Hard programmatic year filter after CH results returned | ✅ Fixed |
| B25-*, FDA-*, QA-* codes not detected as card codes | CARD_CODE_RE required all-letter prefix (`[A-Z]+`) | Extended to `[A-Z][A-Z0-9]*` (allows digits after first letter) | ✅ Fixed |
| Bowman's Best insert set names in variant_name | XLSX uses "Top Prospects", "Stars of the Game", "Best Of 2025", "Base Teams" as section labels | Added to INSERT_SET_NAMES in BowmanKnowledge | ✅ Fixed |
| "Superfractor" / "Autographs" as section label noise | XLSX stores these as variant_name in BMA-/BPA-/BTA- autograph sections | Strip standalone "Superfractor" and "Autographs" in cleanVariant() | ✅ Fixed |
| Tier 2 player-name fallback never firing | `cards[0].player_name` was undefined at runtime — CH API returns `player` field, not `player_name`, for some result shapes | Use `player_name ?? player` fallback (matching topResult construction) | ✅ Fixed |
| Multi-player autograph cards (DA-/TA-/QA-) unmatched | Slash-delimited player names can't match any CH candidate; wrong cards returned | Reformulate to code-only query in reformulateQuery(); accept that variant won't match (structural) | ⚠️ Structural limit |
| Code-only duplicate rows unmatched (BMA-XX, BPA-XX as player_name) | CH doesn't expose `number` field for autograph sets; no playerName available for Tier 2 | No fix available within CH API constraints | ⚠️ Structural limit |

---

## Manufacturer-Specific Knowledge (Known So Far)

This is the start of a knowledge base that needs to grow per manufacturer and product line.

### Topps / Bowman (baseball)

**Terminology mismatches (XLSX → CardHedger):**
- `Retrofractor` → CH uses `"Base"` or `"Lazer Refractor"` (not "Retrofractor")
- `Base - [Parallel] Variation` → CH uses just the parallel name or `"Base"`
- `Chrome Team Sets` → not a variant; it's a subsection of the XLSX indicating card-code player names

**XLSX structural quirks:**
- Team Sets insert sections store the card code (e.g. `BDC-170`) as the player name
- Some insert sets store the full insert set name as the variant_name (e.g. "2025 Draft Lottery Ping Pong Ball Autographs", "Bowman Spotlights")
- Numbered parallels may include print run in variant name (`"Gold Refractor /50"`) — CH usually has the parallel name without the print run

**Card number formats:**
- `BDC-XXX` = Bowman Draft Chrome numbered
- `BD-XXX` = Bowman Draft (paper)
- `CPA-XX` = Chrome Prospect Autographs
- `AA-XX` = Achromatic Autographs
- `PDA-XX` = Prospect Dual Autographs
- `PPA-XX` = Prized Prospects Autographs
- `BIA-XX` = Bowman In Action Autographs
- `DPPA-XX` = Draft Ping Pong Ball Autographs (double prefix)
- `FD-XX` = Bowman Spotlights (Future Draft)
- `PP-XX` = Bowman Spotlights (another prefix)
- `A-XX` = Axis inserts

**CH variant naming conventions:**
- Parallels: `"Base"`, `"Refractor"`, `"Gold Refractor"`, `"Green"`, `"Red"`, `"Orange"`, `"Superfractor"`, `"Lazer Refractor"`, `"Gold Ink"`, `"Gold Mini-Diamond"`
- Autographs add variant suffixes, not separate entries in most cases

### Panini / Donruss (basketball, football)

*To be documented as products are imported.*

---

## Path to Scale: Agent/Skill Architecture

### The Problem at Scale

As we add more products across more manufacturers, the query construction rules will multiply. Bowman Draft has different quirks than Topps Finest, which has different quirks than Panini Prizm. Right now all rules live in `cleanVariant()` and the query builder — a growing pile of regex.

What we really need is a **product-aware matching layer** that knows:
- What terms a specific manufacturer uses that CH doesn't
- What XLSX structural quirks to expect from a specific product type
- What confidence signals are strong vs weak for a given product

### Proposed Architecture

**Option A: Product Knowledge Skill for Claude**

Build a Claude Code skill (or system prompt injection) that provides manufacturer-specific knowledge to the Claude Haiku matching call. Instead of a generic prompt, Claude gets:

```
You are matching a 2025 Bowman Draft Chrome card.

Bowman-specific rules:
- "Retrofractor" in the query = likely a Base parallel; CH may call it "Base" or "Lazer Refractor"
- Card codes like BDC-XXX are card numbers, not player names
- Parallel colors: Base, Refractor, Gold, Green, Red, Orange, Purple, Superfractor
- CH year field should match "2025" for this product
- Autograph sets: CPA = Chrome Prospect Auto, AA = Achromatic Auto, PPA = Prized Prospects Auto

[then the standard candidate matching prompt]
```

This improves Claude's semantic matching without changing the scoring logic.

**Option B: Product Knowledge Config per Product**

Store per-product matching config in the DB or a JSON file:
```json
{
  "product_id": "...",
  "manufacturer": "Bowman",
  "year": "2025",
  "matching_hints": {
    "strip_variant_terms": ["Retrofractor", "Variation"],
    "strip_insert_names": ["Draft Lottery Ping Pong Ball", "Bowman Spotlights"],
    "card_code_pattern": "^[A-Z]+-[A-Z0-9]+$",
    "parallel_synonyms": {
      "Retrofractor": ["Base", "Lazer Refractor"]
    }
  }
}
```

The route reads this config and applies it to query construction. Easier to maintain than hardcoded regex, and admins could edit it from the UI.

**Option C: Web Search Enrichment (for unknown card codes)**

For card-code player names where CH returns 0 results (the code doesn't exist in CH's catalog), fall back to a web search:
1. Search `"2025 Bowman Draft BDC-170 baseball card"`
2. Extract player name from search result
3. Re-query CH with `"Player Name 2025 Bowman Draft"`

This handles the edge case where CH's card number indexing doesn't cover a specific code format.

### Current State (2026-03-31)

Option A is built and live as `lib/card-knowledge/`. `BowmanKnowledge` handles all Bowman/Topps products. `PaniniKnowledge` is a stub. `DefaultKnowledge` is a no-op fallback.

**Practical ceiling for Bowman's Best:** ~76%. The remaining ~24% breaks down as:
- **Multi-player cards** (~3-4%): DA-/TA-/QA-/FDA-/FTA- autographs with slash-delimited player names. CH can't match these by player name, and code-only queries return wrong results. Structural limit.
- **Code-only duplicate rows** (~20%): Variants where the XLSX stored the card code as the player name, AND CH doesn't expose the `number` field in autograph search results. Can't be resolved without CH API changes.

### Recommended Next Steps

1. **Panini products:** Fill in `PaniniKnowledge` once we have real Panini XLSX files to analyze.
2. **Option B (per-product config):** Only worth building if 3+ manufacturers with distinct quirks exceed what TypeScript modules can handle cleanly.
3. **Code-only matching (Option C):** If the code-only duplicate rate becomes a pricing problem, a Tier 3 initials-matcher could recover ~10-15% of those rows by comparing code suffix (e.g., `MT`) against CH candidate initials. Risk: ambiguous codes (JW = James Wood or JJ Wetherholt).

---

## CHANGELOG

| Date | Change | Impact |
|---|---|---|
| 2026-04-21 | **v2 — catalog pre-load architecture.** Persistent `ch_set_cache` + tiered local matcher (exact-variant → synonym → number-only → card-code → Claude with in-set candidates). Descriptor-based `lib/card-knowledge/`. Daily cron refresh. [Full design](./catalog-preload-architecture.md) | Expected lift over 96% Bowman's Best ceiling — and Claude now gets in-set candidates instead of fuzzy-fallback noise. Scales cleanly to Panini / Upper Deck / Topps Finest. |
| 2026-04-21 | River @ CardHedger confirmed: autograph `number` fields ARE populated, CPA-* Prospect Autos ARE in catalog, `/v1/cards/set-search` + `card-search?set=` exist. Earlier 76% ceiling diagnosis was wrong. | Re-architected around catalog pre-load (v2 above). |
| 2026-03-30 | Initial matching implementation | ~15–29% auto-match (Bowman Draft) |
| 2026-03-30 | Shorter set name, sport param, 10 candidates, variant_name in query | ~62–69% |
| 2026-03-30 | Card-code detection (skip), Retrofractor strip, "Base - " strip | ~72% |
| 2026-03-30 | Ping Pong Ball / Bowman Spotlights strip | ~72% (same — skipped rows stayed 0) |
| 2026-03-30 | Card-code search instead of skip, year added to all queries | ~88% |
| 2026-03-30 | Manufacturer knowledge system (`lib/card-knowledge/`) built; Claude context injection | ~95% Bowman Draft |
| 2026-03-31 | Bowman's Best first run | ~12% (new product baseline) |
| 2026-03-31 | Pre-Claude card-code bypass (Tier 1 + Tier 2); hard year filter; insert set name expansion | ~63–71% Bowman's Best |
| 2026-03-31 | CARD_CODE_RE extended to `[A-Z][A-Z0-9]*` (handles B25-*, FDA-*, QA-*) | ~71% |
| 2026-03-31 | Multi-player reformulation (DA-/TA-/QA-/FDA-/FTA- slash-delimited names → code-only query) | No rate change (structural) |
| 2026-03-31 | Tier 2 first-name comparison + `player_name ?? player` fallback fix | ~76% Bowman's Best — **practical ceiling** |
