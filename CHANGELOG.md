# Changelog

## [Unreleased] — 2026-03-17

### Next.js migration
- Migrated from Vite + React to Next.js 15 App Router (TypeScript, Tailwind CSS, shadcn/ui)
- Replaced client-side only rendering with server components and API routes
- Added Supabase backend replacing hard-coded prototype data

### Schema (`supabase/schema.sql`)
- Tables: `sports`, `products`, `players`, `player_products`, `pricing_cache`, `player_product_variants`
- `player_products.total_sets` is a generated column (`hobby_sets + bd_only_sets`)
- `player_products.insert_only` flag excludes insert-only players from slot pricing
- `player_product_variants` supports multiple distinct card types per player per product (e.g., Base Auto + XRC Auto), each with its own CardHedger ID, set counts, card number, SP flag, print run, and odds

### Break page (`app/break/[slug]/page.tsx`)
- Loads live pricing from `/api/pricing` (Supabase + CardHedger)
- **Team Slots** is now the default tab — aggregates player EV by team, shows slot cost, RC count, and expandable player list
- Tabs: Team Slots → Player Slots → Breaker Compare
- Removed eBay Fee Rate and Shipping/Card fields from DashboardConfig UI

### Pricing engine (`lib/engine.ts`, `app/api/pricing/route.ts`)
- Added `computeTeamSlotPricing()` — groups priced players by team, aggregates slot costs
- Pricing route now loads variants per player, batch-prices all uncached card IDs in one CardHedger call, then computes total-set-weighted EV across variants before caching
- Falls back to `player_products.cardhedger_card_id` if no variants exist
- 24-hour TTL cache in `pricing_cache`

### CardHedger client (`lib/cardhedger.ts`)
- Added `batchPriceEstimate()` — up to 100 card/grade combos per call, used by pricing route
- Added `cardMatch()` — scores top search result by token overlap, returns confidence 0–1; used by admin matching route
- Added `computeLiveEV()` — derives EV low/mid/high from all-prices + comps fallback

### Admin: checklist import (`app/admin/import-checklist/page.tsx`)
Three-step wizard for seeding product rosters from manufacturer checklists:

**Step 1 — Upload**
- Product selector (populated from `/api/admin/products`)
- File upload: Topps PDF (numbered or code-based) or Panini/Donruss CSV
- Calls `/api/admin/parse-checklist` → returns `ParsedChecklist`

**Step 2 — Review & Configure**
- Section table: section name, card count, flagged line count, Hobby Sets/Case, BD Sets/Case, include toggle
- Expandable rows: card-level preview (card number, player, team, RC, SP, print run)
- Flagged lines (parse failures) shown inline for manual review
- Calls `/api/admin/import-checklist` → upserts players, player_products, variants

**Step 3 — Result**
- Import summary: players created, player-products, variants
- CardHedger matching: runs `/api/admin/match-cardhedger`, displays confidence table grouped by auto / needs review / no match
- Optional odds upload: parses Topps odds PDF, calls `/api/admin/apply-odds` to attach pull rates to variants

### Admin API routes
| Route | Method | Purpose |
|---|---|---|
| `/api/admin/products` | GET | List all products for import wizard dropdown |
| `/api/admin/parse-checklist` | POST | Parse PDF or CSV checklist → `ParsedChecklist` |
| `/api/admin/parse-odds` | POST | Parse Topps odds PDF → `ParsedOdds` |
| `/api/admin/import-checklist` | POST | Upsert players, player_products, variants from parsed sections |
| `/api/admin/match-cardhedger` | POST | Auto-match unlinked variants to CardHedger card IDs |
| `/api/admin/apply-odds` | POST | Write hobby/breaker odds to variants by fuzzy name match |

### Checklist parser (`lib/checklist-parser.ts`)
- `parseChecklistPdf()` — handles Topps numbered format (`# Player Team®`) and code-based format (`SM-AB Player Team®`); auto-detects format from first card-like line; groups by ALL-CAPS section headers; flags unparseable lines
- `parseChecklistCsv()` — handles Panini/Donruss CSV (`SPORT, YEAR, BRAND, CARD SET, ATHLETE, TEAM, CARD NUMBER, SEQUENCE`); groups by `CARD SET`; maps `SEQUENCE` to `printRun`
- `parseOddsPdf()` — extracts `1:N` tokens per line; everything before first token = subset name; second token = breaker odds

### Format coverage
| Format | Example products |
|---|---|
| Topps PDF — numbered | Heritage Baseball, Finest Basketball (base) |
| Topps PDF — code-based | Finest Basketball (autos), Midnight Basketball |
| Panini/Donruss CSV | Select Football, Optic Football, Donruss Football |
| Topps odds PDF | Finest Basketball odds sheet |
| URL (parked) | Upper Deck (JS-rendered — needs browser automation) |

---

## Earlier work (pre-migration)

### [0.2.0] — 2025
- Breaker Comparison tab with hobby vs BD breakeven analysis
- Player table with EV tiers (hot / warm / cold)
- DashboardConfig for case counts, costs, and fee inputs

### [0.1.0] — 2025
- Initial prototype: static player data, Vite + React + Tailwind
- Break pricing engine: slot cost = `breakCost × (evMid × sets / totalWeight)`
