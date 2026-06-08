# Topps Motif — Manufacturer Rules

Covers **Topps Motif Basketball** and any other Topps/Beckett-published checklist that uses the **parenthetical-odds parallel** dialect (parallels with pack odds glued onto the label). This is a *variant* of the generic Beckett multi-sheet XLSX format the standard `parseChecklistXlsx` already walks — not a separate parser.

**Last updated:** 2026-06-07
**Products imported:** 2025-26 Topps Motif Basketball (first; rules will evolve as more Motif / odds-parallel products land)
**CardHedger status:** ⚠️ catalog gap — CH does not carry Topps Motif yet (ask River). The checklist imports clean, but CH matching won't land until the set is in CH's catalog.

---

## Format — Beckett multi-sheet XLSX with odds-in-parallel-labels

Motif ships the same repeating-block layout as other Beckett-published Topps checklists (Series, Chrome Football). Each subset is a block:

```
<Subset Title>                          ← e.g. "Base", "Splatter Signatures"
<N> cards.                              ← prose metadata (trailing period) — skipped
Parallels                              ← structural label — skipped
<parallel 1>                           ← see below
<parallel 2>
...
<card_num>, <player>, <team>           ← data rows
...
```

Sheets: `Base`, `Rookie Relic Autographs`, `Autographs`, `Relics`, `Full Checklist`, `Teams`. `Full Checklist` + `Teams` are in `XLSX_SKIP_SHEETS` so cards aren't double-counted.

### The quirk: parallels carry their pack odds

Unlike Series/Chrome (plain parallel labels like `Refractor`, `Gold /50`), Motif glues the pack odds onto each parallel label:

```
Platinum (Hobby - 1:157; FDI - 1:157)
Pastel Pink (No odds given)
Quin Gold (Hobby - 1:50; FDI - 1:50)
```

Before this was handled, every odds-parallel line failed the `isParallelLabel()` test, fell through to "new base section header," and **overwrote the real subset title** — the parser produced ~15 garbage odds-named sections (`"Platinum (Hobby - 1:157…"`) instead of the real subsets.

### Parsing rules (in [`lib/checklist-parser.ts`](../../lib/checklist-parser.ts))

| Rule | Regex / helper | Behavior |
|---|---|---|
| Parenthetical-odds parallel | `PAREN_ODDS_PARALLEL_RE` + `parenOddsParallelName()` | Recognizes `(Hobby…/FDI…/Retail…/Jumbo…/No odds given)` parentheticals and strips the odds → clean parallel name (`"Platinum (Hobby - 1:157; FDI - 1:157)"` → `"Platinum"`). |
| Bare odds line | `BARE_ODDS_RE` | A standalone odds row (`"Hobby - 1:17; FDI - 1:11"`) is metadata — skipped, never a section or parallel. |
| **Malformed paren** | `PAREN_ODDS_PARALLEL_RE` closing `)` is **optional** | The Motif source file has at least one truncated line missing its closing paren (`"Platinum (Hobby - 1:949; FDI - 1:633"`). The optional `)` keeps it from leaking as a section; its cards stay with their real subset (`Still Life Signatures`). |

These rules are **format-general**, not Motif-hardcoded — any Topps/Beckett checklist with odds-in-parallel-labels routes through them automatically. No new detection branch, no migration.

### Card rows

Same as the generic Beckett walker: `<num>, "Name,", "Team"`. Alphanumeric subset codes (`SS-AB`) supported; trailing commas stripped; the block's collected `parallels` are carried onto each card so the importer expands one variant per parallel.

---

## Regression test

[`scripts/verify-motif-parser.mjs`](../../scripts/verify-motif-parser.mjs) asserts against the real fixture (default `~/Downloads/2025-26-Topps-Motif-Basketball-Checklist.xlsx`, `FIXTURE=` to override):

```
npx tsx scripts/verify-motif-parser.mjs
```

Locks in: 0 odds-named sections, 769 total cards, real subset titles present, Base parallels captured (incl. trailing `Platinum`), and the malformed-paren `Platinum` line not leaking as a section.

**Verified 2026-06-07:** 23 sections, 769 cards, 0 stray.

---

## Known gaps

- **No rookie flag / no odds in engine** — Motif data rows don't carry an RC flag; odds live in the parallel labels (informational only — the engine reads `hobby_odds` from the odds-import path, which Motif doesn't publish separately). Engine is null-safe.
- **CardHedger catalog gap** — see status above. Matching is blocked on CH adding the set.
