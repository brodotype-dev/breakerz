# Plan: Checklist Import for Admin Dashboard

_Date: 2026-03-17_

## Context

Currently, populating a product's player/card data requires manual Supabase dashboard entry. After reviewing six real-world checklists and one odds sheet across Topps, Panini/Donruss, and Upper Deck, three distinct input types exist. This plan covers a multi-format admin import tool that handles all of them with a shared review/confirm step and auto-matching to CardHedger.

---

## Input Formats

### 1. Topps numbered PDF (Heritage, Finest base)
- `# Player Name[*]  Team®  [Rookie]  [*Back Variation]`
- Sections = ALL-CAPS headers; variants = separate section names

### 2. Topps code-based PDF (Finest autos, Midnight)
- `CODE-XX  Player Name  Team®`
- Insert set embedded in code prefix (SM = Stroke of Midnight, RJA = Rookie Jersey Auto)

### 3. Panini/Donruss CSV (Select, Optic, Donruss)
- Columns: `SPORT, YEAR, BRAND, PROGRAM, CARD SET, ATHLETE, TEAM, POSITION, CARD NUMBER, SEQUENCE`
- `CARD SET` = variant name; `SEQUENCE` = print run limit

### 4. Topps Odds PDF (separate from checklist)
- Three columns: `Subset Name | Hobby Odds (1:N) | Breaker Odds (1:N)`
- Imported separately after checklist; matched to variants by subset name

### 5. URL (Upper Deck) — Parked
- JS-rendered, requires browser automation. Parked for now.

---

## Schema Changes

```sql
alter table player_product_variants
  add column card_number  text,
  add column is_sp        boolean default false,
  add column print_run    integer,
  add column hobby_odds   text,
  add column breaker_odds text;
```

---

## New Files

| File | Purpose |
|---|---|
| `lib/checklist-parser.ts` | PDF + CSV + odds parsers |
| `app/api/admin/parse-checklist/route.ts` | File upload → ParsedChecklist |
| `app/api/admin/parse-odds/route.ts` | Odds PDF upload → ParsedOdds |
| `app/api/admin/import-checklist/route.ts` | Create players + variants in DB |
| `app/api/admin/match-cardhedger/route.ts` | Auto-match variants to CardHedger IDs |
| `app/admin/import-checklist/page.tsx` | 3-step admin wizard |

---

## Data Source Coverage

| Data point | Source |
|---|---|
| Player name, team, rookie | Checklist (PDF or CSV) |
| Card number, subset/variant name | Checklist (PDF or CSV) |
| SP flag | PDF (`*` suffix on player name) |
| Print run | CSV `SEQUENCE` field |
| `cardhedger_card_id` | CardHedger `card-match` API |
| `hobby_sets` / `bd_only_sets` | User input in review step |
| `hobby_odds` / `breaker_odds` | Odds PDF (optional) |

---

## Admin Wizard Flow

1. **Upload** — select product, choose PDF or CSV, upload file
2. **Review** — per-section card counts + hobby/BD set inputs; flagged lines editable
3. **Import** — DB records created; "Match CardHedger IDs" + optional odds sheet upload

---

## Parked

- URL import (JS-rendered sites)
- Pull-rate weighted EV in pricing engine
- Variant breakdown UI in expanded player rows on break page
