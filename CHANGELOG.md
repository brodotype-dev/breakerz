# Changelog

All notable changes to Card Breakerz are documented here.
Format: newest first. Each entry covers what changed, why, and any important technical notes.

---

## 2026-03-22

### Claude-powered CardHedger matching
- **Replaced token-based `cardMatch()`** with a Claude semantic matcher in `lib/cardhedger.ts`
- Claude sees the top 5 CardHedger search results and reasons about which (if any) is the correct match — handling player name variations, set abbreviations, RC year alignment, variant synonyms (Auto = Autograph, RC = Rookie Card, etc.)
- Model: `claude-haiku-4-5-20251001` — fast and cheap enough for batch matching
- Token-based scorer kept as fallback if Claude call fails (rate limit, error, timeout)
- Claude prompt returns `{ card_id, confidence }` JSON; if no match, returns `null`; fallback returns token-matched top result
- Added `AbortSignal.timeout(10_000)` to all CardHedger API fetch calls to prevent zombie connections
- Added `{ timeout: 10_000 }` option to Anthropic SDK call
- Dynamic `import('@anthropic-ai/sdk')` (not `require`) required in Next.js server context
- Added `ANTHROPIC_API_KEY` to Vercel env vars

### Bug fix: matching silently skipped saves
- **Root cause:** `catch` block in the variant matching loop swallowed all errors and returned `'no-match'` — if `cardMatch()` threw for any reason (API timeout, Anthropic error), the Supabase update never ran and the failure was invisible
- **Also:** Supabase `.update()` result was discarded — write errors went undetected
- **Fix:** catch block now logs the error (visible in Vercel function logs) and returns an `error` field in the result; update result is checked and logged if it fails; added null guard on `card_id` before writing an auto-match

### Chunked polling for large-batch matching
- **Rewrote `app/api/admin/match-cardhedger/route.ts`** from streaming NDJSON to chunked polling
- Each POST processes one chunk (default 40 variants, `CONCURRENCY=8`), returns `{ results, total, processed, hasMore, nextOffset }`
- Client (`RunMatchingButton.tsx`) loops: sends offset → gets chunk → updates progress → pauses 300ms → repeats until `hasMore = false`
- Fixes Vercel serverless function timeout issue — each chunk runs in ~10–15s, well under the 60s `maxDuration`
- Writes both `cardhedger_card_id` (auto-matches ≥0.7 confidence) and `match_confidence` to `player_product_variants`

### Product dashboard (`/admin/products/[id]/`)
- **Standalone odds upload:** `OddsUpload.tsx` — upload a Topps odds PDF at any time, independent of the import wizard; shows matched/unmatched variant table after applying
- **Re-run Matching button:** `RunMatchingButton.tsx` — triggers chunked matching with live progress bar (completed/total), summary on completion (matched / low confidence / no match), retry on error
- **Unmatched variants list:** amber section showing up to 50 variants missing a CardHedger card ID (player name, variant name, card number)
- **Product readiness stats:** Players, CH Matched %, Odds status, Pricing cache count with status pills (green/amber/gray)

### Coordinate-aware odds PDF parser (rewrite)
- **Replaced** the text-line odds parser with a coordinate-aware extractor using `pdf2json`
- Old parser: relied on text order, grabbed wrong column (Distributor Jumbo), filled subset names with dash strings from N/A columns. Result: 19 matched / 263 unmatched.
- New parser: reads x/y positions per text token; detects Hobby Box column x-position dynamically (first row with ≥10 `1:` tokens, `colonItems[1]`); only emits rows with actual hobby odds
- Continuation rows (all-caps label, no column data) are appended to the previous emitted row's `subsetName` — handles multi-line subset names correctly
- Mixed-case rows (page titles like "2025 Topps Baseball Series 2") are skipped and reset the continuation target
- Result: 224 clean rows from Series 2 PDF with correct hobby odds

---

## 2026-03-18 (2)

### Break page UI cleanup
- **Hobby/BD toggle:** Added Hobby Case / Breakers Delight pill toggle at the top of the break page. Config, table columns, and totals all reflect the active type. `breakType` is UI state only — engine still computes both.
- **Removed seller fields:** eBay fee rate, shipping/card, and breaker margin commented out of DashboardConfig. Reserved for a future seller/breaker UI variant. Totals simplified to `cases × cost`.
- **Focused tables:** TeamSlotsTable and PlayerTable now show a single Slot Cost column for the active break type (was separate hobby + BD columns).
- **Alphabetical sort:** Teams A→Z in Team Slots; players A→Z in both Team Slots (expanded rows) and Player Slots. Previously sorted by cost descending.

### Admin entry point
- Created `app/admin/products/page.tsx` — product listing page that was missing, making `/admin` unreachable from the browser. Lists all products with links to player management and import wizard.

---

## 2026-03-18

### Deployment fixes
- **Vercel build fix — pdf-parse:** `pdf-parse` evaluates canvas bindings at module load time and crashes the build with `DOMMatrix is not defined`. Fixed by moving `require('pdf-parse')` inside the handler function and adding `export const dynamic = 'force-dynamic'` to affected routes (`parse-checklist`, `parse-odds`).
- **GitHub sync:** Vercel builds from the GitHub repo, not local uploads. Commits must be pushed to `origin/main` before deploying or the build uses stale code.
- **Rebase + merge:** Local branch (team slots, checklist import) was rebased onto `origin/main` (Heritage UI redesign, CardHedger auth fixes). All conflicts resolved; both feature sets now live together.

### CLAUDE.md
- Created `/CLAUDE.md` — project context file loaded automatically by Claude Code each session
- Covers: stack, deploy command, env vars, two known build gotchas (Supabase + pdf-parse), key file map, schema overview, pricing model, checklist format table, MCP config
- Added reference links in README pointing to CLAUDE.md and CHANGELOG.md

### Infrastructure restored
- `scripts/map-cards.mjs` — interactive CLI for manually mapping CardHedger IDs to players; was on GitHub but missing from local
- `.mcp.json` — Supabase MCP server config (project ref: `zucuzhtiitibsvryenpi`); connects Claude Code directly to live Supabase

---

## 2026-03-17

### Checklist import admin wizard
3-step wizard at `/admin/import-checklist` for seeding product rosters from manufacturer checklists.

**Step 1 — Upload:** product selector, file upload (PDF or CSV), parse
**Step 2 — Review & Configure:** per-section table with hobby/BD set inputs, expandable card previews, flagged-line review
**Step 3 — Result:** import summary, CardHedger auto-matching (confidence bands: auto / needs review / no match), optional odds PDF upload

New admin API routes:
| Route | Method | Purpose |
|---|---|---|
| `/api/admin/products` | GET | Product list for import wizard dropdown |
| `/api/admin/parse-checklist` | POST | PDF or CSV → `ParsedChecklist` |
| `/api/admin/parse-odds` | POST | Topps odds PDF → `ParsedOdds` |
| `/api/admin/import-checklist` | POST | Upsert players, player_products, variants |
| `/api/admin/match-cardhedger` | POST | Auto-link variants to CardHedger card IDs |
| `/api/admin/apply-odds` | POST | Write pull rates to variants by fuzzy name match |

### Multi-format checklist parser (`lib/checklist-parser.ts`)
- `parseChecklistPdf()` — Topps numbered (`# Player Team®`) and code-based (`SM-AB Player Team®`); auto-detects format; groups by ALL-CAPS section headers; flags unparseable lines
- `parseChecklistCsv()` — Panini/Donruss CSV; groups by `CARD SET`; maps `SEQUENCE` → `printRun`
- `parseOddsPdf()` — extracts `1:N` tokens per line; subset name = everything before first token

Supported formats:
| Format | Example products |
|---|---|
| Topps PDF — numbered | Heritage Baseball, Finest Basketball (base) |
| Topps PDF — code-based | Finest Basketball (autos), Midnight Basketball |
| Panini/Donruss CSV | Select Football, Optic Football, Donruss Football |
| Topps odds PDF | Finest Basketball odds sheet |
| URL (parked) | Upper Deck — JS-rendered, needs browser automation |

### Player product variants model
- Added `player_product_variants` table: multiple distinct card types per player per product (e.g., Base Auto + XRC Auto), each with its own CardHedger ID, set counts, card number, SP flag, print run, hobby/breaker odds
- Pricing route updated: batch-prices all uncached variant card IDs in one CardHedger call, computes total-set-weighted EV before caching
- Falls back to `player_products.cardhedger_card_id` if no variants exist

### Team Slots view
- Team Slots is now the default tab on the break page
- Aggregates player EV by team: per-team slot cost, RC count, expandable player list
- Added `computeTeamSlotPricing()` to `lib/engine.ts`
- Tab order: Team Slots → Player Slots → Breaker Compare

### CardHedger client additions (`lib/cardhedger.ts`)
- `batchPriceEstimate()` — up to 100 card/grade combos per call
- `cardMatch()` — token-overlap confidence scoring (0–1) for admin auto-matching
- `computeLiveEV()` — EV low/mid/high from all-prices + comps fallback

### Heritage UI redesign
- Topps Heritage-inspired card aesthetic: cream backgrounds, serif type, red accent bar
- Redesigned homepage, break page header, and component styling

### Next.js migration
- Migrated from Vite + React to Next.js 15 App Router (TypeScript, Tailwind, shadcn/ui)
- Added Supabase backend; replaced hard-coded prototype data with live DB
- Schema: `sports`, `products`, `players`, `player_products`, `pricing_cache`, `player_product_variants`

---

## Earlier (pre-Next.js, 2025)

### 0.2.0
- Breaker Comparison tab — hobby vs BD breakeven analysis, top 20 BUY/WATCH/PASS signals
- Player table with EV tier badges (hot / warm / cold)
- DashboardConfig: case counts, costs, eBay fee, shipping inputs

### 0.1.0
- Initial prototype: static player data (2025-26 Topps Finest Basketball), Vite + React + Tailwind
- Break pricing engine: `Slot Cost = Break Cost × (evMid × sets) / Σ(evMid × sets)`
