# Topps Chrome × Cactus Jack — Manufacturer Rules

Covers **Topps Chrome × Cactus Jack** (the Travis Scott / Cactus Jack collab) and any Topps/Beckett checklist that uses the **bare-ratio parenthetical-odds** dialect (every parallel label is `"<Name> (1:N)"`). Sibling of [topps-motif.md](./topps-motif.md) — same "odds glued onto the label" family, different odds syntax.

**Last updated:** 2026-06-09
**Products imported:** 2025-26 Topps Chrome × Cactus Jack Basketball
**Product line:** `topps_cactus_jack` (see [lib/product-lines.ts](../../lib/product-lines.ts))

---

## Format — Beckett multi-sheet XLSX with bare-ratio odds

Standard Beckett layout (sheets: `Base`, `Autographs`, `Inserts`, `Full Checklist`, `Teams`; the last two are in `XLSX_SKIP_SHEETS`). Each block:

```
Base Set                          ← (consumed by STRUCTURAL_LABEL_RE; section name falls back to the sheet name)
100 cards                         ← count metadata
Parallels                         ← structural label
White (1:7)                       ← parallels — EVERY label carries (1:N) odds
Refractor (1:10)
LogoFractor (1:20)
Lasers (1:44)
Cactus Jack Refractor (1:184)
... Superfractor (1:7,575)
1  | Jayson Tatum  | Boston Celtics   ← base cards, numeric #1-100
```

Autograph / insert sheets additionally put the **section pull rate on its own line**:

```
Base Autographs
49 cards
1:208 packs                       ← bare ratio-led odds line (NOT a section/parallel)
Parallels
Orange Refractor (1:1,064)
...
BV-AB | Ace Bailey | Utah Jazz
```

## Three quirks that broke the parser (all fixed in [lib/checklist-parser.ts](../../lib/checklist-parser.ts))

| Quirk | Symptom before fix | Fix |
|---|---|---|
| **Bare-ratio odds on parallels** — `"White (1:7)"`, `"Cactus Jack Refractor (1:184)"` | The Motif fix (#194) only recognized **keyword**-led parens (`(Hobby - …)`). Bare `(1:N)` labels failed `isParallelLabel`, leaked into the section name, and overwrote the real `Base Set` header. | `PAREN_ODDS_PARALLEL_RE` extended with a bare-ratio alternative (`(1:184)`, `(1:1,509)`); `parenOddsParallelName()` strips it → clean parallel name. |
| **Ratio-led odds lines** — `"1:208 packs"`, `"1:8 packs"` | Became garbage sections (the parser's earlier output literally had a section named `"1:8 packs"`). | `BARE_ODDS_RE` extended to skip `N:N packs` lines (ratio-led, in addition to keyword-led). |
| **Leading-space sheet name** — the base sheet ships as `" Base"` | (a) dodged `XLSX_SKIP_SHEETS`; (b) when used as the fallback section name it failed `isBaseSectionName`'s `^Base` anchor → **every player flagged `insert_only`** → "No players found for this product" on the debrief, and no base slots in pricing. | Trim the sheet name (`cleanSheetName`) before the skip check and before using it as the section name. |

The combined effect of #1/#3: the base section name was destroyed, `isBaseSectionName` failed, and all 141 players imported as `insert_only = true`. After the fix the base section is `"Base"`, the 100 numeric base cards register, and base players come back.

## Regression expectations (verified 2026-06-09)

Parsing `2025-26-Topps-Chrome-x-Cactus-Jack-Basketball-Checklist.xlsx`:
- **8 sections** (`Base`, `Base Autographs`, `Cactus Ink`, `Utopia Highlights`, `Jacked Up`, `La Flame Legends`, `Astrovision`, `Cactus Mode`), **338 cards**, **0 odds-named sections**, **0 parallels with odds in the name**.
- `Base` section = 100 numeric cards → **100 base-eligible players** (`insert_only = false`); 41 autograph/insert players stay `insert_only = true`.

## Known gaps

- **No odds applied to the engine** — the pull rates live in the parallel labels (informational); the odds-import path isn't wired for this format, and it's not a CardHedger-priced product yet. Engine is null-safe.
- **CardHedger** — collab products like this are likely a CH catalog gap; matching is blocked until CH carries the set.
