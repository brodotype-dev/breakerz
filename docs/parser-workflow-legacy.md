# Legacy Parser Workflow (Fallback)

The default product flow is the **CH-Hydrate Workflow** on the product dashboard. This doc covers the older parser-driven workflow — still fully functional, hidden from the default UI during beta.

Use the parser workflow when:
- CardHedger doesn't have a set catalog yet (new release, obscure product)
- CH's catalog for the set is broken / incomplete and you need to drive variants from the manufacturer's checklist
- You're debugging a variant-name mismatch and want parser-generated names instead of CH-canonical names

The hydrator is non-destructive to the parser's code paths — `lib/checklist-parser.ts`, `/api/admin/import-checklist`, and `/api/admin/match-cardhedger` are all intact. You can also mix: run the parser first, then later "Hydrate Variants from CH" to replace the rows with CH-native ones.

---

## Steps

### 1. Add players

Manage Players → add every player on the product's checklist with name, team, rookie flag, insert_only flag. Auto-create only runs during CH-Hydrate, not during parser import.

Path: `/admin/products/<id>/players`

### 2. Import checklist (PDF / XLSX / CSV)

Upload the manufacturer's checklist file. Parser expands parallels per card and creates one `player_product_variants` row per (card × parallel).

Path: `/admin/import-checklist?productId=<id>`

- **XLSX** — Bowman / Topps checklists. Parallel expansion via `parseChecklistXlsx` in `lib/checklist-parser.ts`.
- **PDF** — Topps older formats. Uses `pdf2json` (not `pdf-parse` — canvas crash on Vercel).
- **CSV** — Panini and some legacy checklists.

**Known limitations:** the parser is the source of truth for what variants exist. Edge cases in parallel labeling or section-header leakage cause unmatched variants downstream. Example: on 2025-26 Topps Finest (pre-CH-Hydrate), 225 of 19,399 variants sat unmatched because the XLSX parser missed specific parallel blocks.

### 3. Re-run matching against CH

Runs the tiered local matcher against `ch_set_cache` plus Claude fallback. Writes `cardhedger_card_id` and `match_tier` onto each variant.

API: `POST /api/admin/match-cardhedger` with `{ productId }`
Button: previously on the product dashboard as "Re-run Matching" — still called from `/admin/import-checklist` page.

Tier ladder: `exact-variant → synonym → number-only → card-code → claude(in-set candidates) → no-match`.

Match rate targets: 80–95% depending on manufacturer naming cleanliness. Under 80% usually means a descriptor tweak is needed in `lib/card-knowledge/`.

### 4. Upload odds PDF

Same step as CH-Hydrate — no difference. The apply-odds token-fuzzy matcher works on parser-generated variant names just as well as CH-canonical names.

### 5. View break page

Verify pricing renders end-to-end: `/break/<product-slug>`.

---

## Reverting from Hydrate back to Parser

If CH hydration produces bad data for a product and you want to restore parser-driven rows:

1. Re-run Import Checklist for the product with the original file.
2. `player_product_variants` gets deleted-and-replaced with parser rows.
3. Re-run matching to re-establish `cardhedger_card_id` bindings.

No other product is affected. No CH catalog data is deleted — `ch_set_cache` persists, so you can switch back to Hydrate later without re-fetching.

---

## Re-enabling the UI

The parser workflow card was removed from `app/admin/products/[id]/page.tsx` in PR #12. To bring it back, restore the second `WorkflowCard` block (see PR #9 for the original markup) and add `RunMatchingButton` back to the imports.
