# Panini — Manufacturer Rules

Covers Panini Prizm, Donruss, Optic, Select, Mosaic, and other Panini-published products.

**Last updated:** 2026-05-06
**Products imported:** 2025 Panini Prizm Football (first Panini import; rules will evolve as more products land)

---

## XLSX format — fully different from Topps/Bowman

Panini ships a single fully-denormalized **`Master Checklist`** sheet that is the canonical record of every (parallel × athlete) row in the product. The other sheets (`Base`, `Inserts`, `Autographs`, `Memorabilia`, `Teams`) are descriptive metadata — they list section names and parallels in a layered text format, but only cover ~10% of the actual parallels in the product.

**For 2025 Panini Prizm Football:**
- `Master Checklist`: 34,723 rows × **316 distinct CARD SETs** ← canonical
- Metadata sheets combined: ~24 detected sections, ~1,595 cards ← incomplete, ignore

The parser detects Panini format by looking for the `Master Checklist` sheet with header row `CARD SET / CARD NUMBER / ATHLETE / TEAM / SEQUENCE`. When detected, [`parsePaniniXlsx`](../../lib/checklist-parser.ts) routes there and skips the Bowman/Topps logic entirely.

### Section model

- One **CARD SET** (e.g. `Base Prizm Pink Wave`, `All Purpose Prizms Black Finite`) becomes one `ParsedSection`.
- Each row in that CARD SET becomes one `ParsedCard` (one variant = one parallel × one athlete).
- Cards have **no `parallels` array** — the parallel IS the section name. The importer's `parallels.length > 0 ? expand : [section.sectionName]` fallback creates exactly one variant per card with `variant_name = sectionName`.
- This shape mirrors how CardHedger names these cards in its catalog, so the matcher's exact-variant tier should land most rows on the first try.

### Column mapping

| XLSX column | ParsedCard field | Notes |
|---|---|---|
| `CARD SET` | `section.sectionName` | Used as `variant_name` at import time |
| `CARD NUMBER` | `cardNumber` | Number for plain ints, string for codes (`CB-1`, `AU-PM`) |
| `ATHLETE` | `playerName` | Trailing comma stripped; trademark symbols stripped |
| `TEAM` | `team` | Trailing comma stripped |
| `SEQUENCE` | `printRun` | Print run; `null` for unnumbered base parallels |

---

## Known gaps + workarounds

### No rookie flag

`Master Checklist` doesn't carry an RC indicator on individual rows. The metadata sheets DO have a `Base — Rookie` subset section, but we don't consume them. Every Panini player imports as `is_rookie: false`.

**Workaround:** backfill rookies admin-side, or add a Panini rookie-overlay parser (consult metadata sheets, build a Set of player names known to be rookies, set the flag during the parser pass).

### No pull-rate odds

Panini doesn't publish hobby odds the way Topps does. Every `player_product_variants.hobby_odds` will be `null` for Panini products.

**Engine behavior is already correct** (audit confirmed 2026-05-06):
- [lib/analysis.ts:137](../../lib/analysis.ts) filters `v.hobby_odds != null && > 0` and falls back to sets-weighted `ev.evMid`.
- [lib/admin/pricing-breakdown](../../app/api/admin/pricing-breakdown/[productId]/route.ts) uses the same null-safe guard.
- The cached read path (`/api/pricing`) returns `evMid` directly — same behavior for Panini and Topps.

**Known UX gap (P2 backlog):** the admin Chase Cards Manager picks "rarest variant" by lowest `hobby_odds`, so it's empty for every Panini product. Needs a print-run fallback. See `docs/BACKLOG.md` for the entry.

### Card numbers are reused across parallels

Saquon Barkley appears as `#1` in `Base Prizm Pink Wave`, `#1` in `Base Prizm Black Finite`, etc. — same card number across 100+ different parallels. This is expected: the dedupe-on-`(player_product_id, variant_name, card_number)` only fires within a single `variant_name`, and these are all different parallels. Result: ~111 distinct variants for Saquon in 2025 Prizm.

---

## CardHedger matching

### Variant naming alignment

Panini's CARD SET strings (`Base Prizm Pink Wave`, `All Purpose Prizms Mojo`) are also what CH uses in its catalog `variant` field. The exact-variant tier in [`lib/card-knowledge/match.ts`](../../lib/card-knowledge/match.ts) should land most rows directly without falling through to Claude.

If a product's match rate comes in low, first check whether CH's set-catalog has those exact strings — there may be edge cases where CH normalizes slightly (e.g. `&` vs `and`, or capitalization quirks).

### Descriptor

[`lib/card-knowledge/panini.ts`](../../lib/card-knowledge/panini.ts) is the active descriptor. Trigger pattern: `/panini|donruss|prizm|select|mosaic|optic/i`. Will likely need refinement once a few more Panini products are imported and the actual variant string distribution becomes visible.

---

## Verification

When importing a new Panini product, check:

1. Section count matches the unique CARD SET count in the XLSX (Python: `len(set(row[0] for row in ws.iter_rows()))`).
2. A spot-checked star player appears the expected number of times (e.g. Saquon Barkley → 111 variants in 2025 Prizm Football).
3. Print runs from `SEQUENCE` map to `printRun` correctly (numeric values preserved, `null`/blank → undefined).
4. Player names have no trailing commas or trademark symbols.

A throwaway verifier lives at [`scripts/verify-panini-parser.mjs`](../../scripts/verify-panini-parser.mjs) — point it at any Panini XLSX in `~/Downloads/` and it'll dump the parsed shape.

---

## Future work

- Rookie-overlay parser (consume `Base — Rookie` from metadata sheets)
- Chase Cards print-run fallback (P2 backlog item)
- Refine `paninidescriptor.stripPatterns` and `variantSynonyms` once we have CH match-rate data
