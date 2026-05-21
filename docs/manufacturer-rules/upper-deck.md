# Upper Deck / O-Pee-Chee — Manufacturer Rules

Covers Upper Deck-published products (UD Series, Artifacts, SPx, MVP, etc.) and the O-Pee-Chee sub-brand (OPC Platinum, OPC Premier, OPC base). Hockey is the dominant sport here — football and other sports also exist but aren't in the private-beta roster.

**Last updated:** 2026-05-21
**Products imported:** 2025-26 O-Pee-Chee Platinum (first UD-family import; rules will evolve as more products land)

---

## Two surface paths, one parser

Upper Deck doesn't ship per-product XLSX files the way Topps and Panini do. Instead the same per-card table is published in two places:

| Surface | Source | When to use |
|---|---|---|
| **XLSX (preferred)** | Beckett-published `2025-26-<product>-Checklist.xlsx`, `Master Card List` sheet | Whenever admin has the file. Deterministic, no Cloudflare, no JS rendering, one file = checklist + odds. |
| **URL scrape (fallback)** | `https://upperdeck.com/checklist/<slug>/` | When admin doesn't have the XLSX. Cloudflare-protected, JS-hydrated, GDPR consent overlay — handled via Firecrawl `proxy: 'stealth'` + `waitFor: 8000` + markdown extract. |

Both paths produce identically-shaped `RawRow[]` and route through a shared `rowsToResult` transform in [`lib/upper-deck-parser.ts`](../../lib/upper-deck-parser.ts). When a new surface lands (UD-API feed, partner data dump, etc.) it plugs in by producing the same RawRow shape.

---

## Shared row shape

Both surfaces expose the same 11-column structure:

| Column | RawRow field | Notes |
|---|---|---|
| `Set Name` | `setName` | One ParsedSection per unique value (e.g. `Base Set`, `Neon Yellow Surge Parallel`, `Path to Victory Rainbow Auto Parallel`) |
| `Card` | `cardNumber` | Number or code (e.g. `1`, `PV-2`, `R-DV`) |
| `Description` | `playerName` | Trailing comma + trademark symbols stripped |
| `Team City` | `teamCity` | Concatenated with `teamName` to populate ParsedCard.team |
| `Team Name` | `teamName` | |
| `Rookie` | `isRookie` | `true` when matches `xrc`, `rookie`, or bare `RC` |
| `Auto` | `hasAuto` | `true` when matches `auto` |
| `#'d` | `printRun` | Integer print run when present |
| `SPs` | `sps` | Stated print run fallback when `#'d` is absent |
| `Stated Odds` | `statedOdds` | Multi-format odds string — see normalization below |
| `Point` | `point` | Beckett scoring/value field — captured but unused today |

Card-level `parallels: [setName]` matches the Panini convention: each section IS a parallel, and the importer's `parallels.length > 0 ? expand : [section.sectionName]` fallback creates exactly one variant per card with `variant_name = sectionName`. This mirrors how CardHedger names these cards in its catalog so the matcher's exact-variant tier should land most rows on the first try.

---

## Stated Odds — 8 pack formats in one string

Upper Deck packs all sales-channel odds into a single comma-separated string per card:

```
"6:1 h, 6:1 e, 2:1 b"
"3:1 h, 3:1 e, 1:1 b"
"1:3 Blaster"
"2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"
```

Format token → BreakIQ key:

| Token | Format |
|---|---|
| `h` | hobby |
| `e` | epack |
| `r` | retail |
| `b` | blaster |
| `mega` | mega |
| `hanger` | hanger |
| `tin` | tin |
| `dollar` | dollar |

The parser dedupes unique odds strings across the import (typical product has 5–20 unique patterns) and sends them to Claude Haiku (`claude-haiku-4-5-20251001`) in a single batched call. Cost is ~$0.005 per import. Result is `OddsByFormat` (see [`lib/types.ts`](../../lib/types.ts)).

The engine reads `hobby_odds` today; the richer `oddsByFormat` payload is stored on the parsed odds row for future per-format pool support (`retail` / `blaster` / `mega` cases).

---

## Admin workflow

1. Go to `/admin/import-checklist` (or click "Legacy parser workflow" from a product dashboard).
2. Select a UD-family product from the dropdown (manufacturer is `Upper Deck` or `O-Pee-Chee`).
3. A cyan-bordered "Upper Deck importer" panel auto-renders inside Step 1 — non-UD products see only the standard PDF/XLSX/CSV upload below.
4. Two paths inside the panel:
   - **Beckett XLSX (preferred):** click Upload XLSX → pick the `Master Card List`-bearing file. One pass writes checklist + odds.
   - **URL scrape (fallback):** paste the upperdeck.com URL into Checklist URL → Import. Then paste the same URL into Odds URL → Import (5-min cache so the second call is free).

Both paths default to 1 hobby set / 0 BD per section. UD breakers overwhelmingly sell hobby slots; admin can override per-section via the legacy wizard's Step 2 review screen if needed.

---

## Known gaps + workarounds

### Engine reads only hobby_odds today

`oddsByFormat` captures all 8 pack formats but the slot-math engine only reads `hobby_odds` (single format). Per-format pool support (e.g. retail/blaster/mega cases) is queued — the data is already in the payload when it lands.

### URL scrape produces 800 KB+ of markdown

The full OPC Platinum checklist page renders to ~810 KB of markdown when fully loaded (6,322 rows × 112 sections). Firecrawl's LLM-based JSON extractor choked on that volume — the parser uses deterministic `|`-table parsing on the markdown instead. The XLSX path sidesteps this entirely.

### O-Pee-Chee manufacturer code

Products use either `manufacturer: 'Upper Deck'` or `manufacturer: 'O-Pee-Chee'` (OPC is owned by UD but ships under its own brand). The admin product page gates the import panel on both values; the parser doesn't care.

---

## Quick reference — relevant files

- [`lib/upper-deck-parser.ts`](../../lib/upper-deck-parser.ts) — `parseUpperDeckXlsx` (Beckett XLSX), `parseUpperDeckUrl` (Firecrawl scrape), shared `rowsToResult`
- [`app/api/admin/parse-upper-deck-xlsx/route.ts`](../../app/api/admin/parse-upper-deck-xlsx/route.ts) — multipart XLSX upload
- [`app/api/admin/parse-checklist-url/route.ts`](../../app/api/admin/parse-checklist-url/route.ts) — JSON URL POST, returns ParsedChecklist
- [`app/api/admin/parse-odds-url/route.ts`](../../app/api/admin/parse-odds-url/route.ts) — JSON URL POST, returns ParsedOdds (shares the URL cache)
- [`components/admin/UpperDeckImporter.tsx`](../../components/admin/UpperDeckImporter.tsx) — admin UI for both paths (XLSX upload + URL fallback); mounted on `/admin/import-checklist` when the selected product is UD-family
