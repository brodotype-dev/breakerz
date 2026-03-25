# Changelog

All notable changes to Card Breakerz are documented here.
Format: newest first. Each entry covers what changed, why, and any important technical notes.

---

## 2026-03-24 (5)

### Breakerz Sayz — rename + case count input + homepage CTA
- Renamed feature from "Breaker Says" → **"Breakerz Sayz"** everywhere (page title, header, nav links)
- Added **Cases in the break** input on the analysis page (default 10, range 1–50); fair value now scales correctly for single-case vs multi-case group breaks
- API (`POST /api/analysis`) accepts `numCases` param; feeds into `BreakConfig.hobbyCases` / `bdCases` — previously always assumed 10 cases
- Homepage: replaced buried text link with a full-width promo strip between header and products — red "Breakerz Sayz" badge, tagline, and prominent "Check a deal →" CTA button

---

## 2026-03-24 (4)

### Breakerz Sayz — AI break slot analysis page
- New public page at `/analysis` — "Is this break worth it?"
- Flow: select product → select team → enter break type + case count + what the breaker is charging → Run Analysis
- Calls Claude Haiku with full player context (EV, RC flags, fair value, ask price) → returns 2–3 sentence BUY/WATCH/PASS narrative
- Shows signal badge, % above/below fair value, AI reasoning, and top 5 players with EV data
- For uncached players, fetches live CardHedger pricing before running analysis — prevents $0 fair values on first run
- Linked from homepage promo strip and break page header
- New API route: `GET /api/analysis` (product list) + `POST /api/analysis` (analysis, accepts `numCases`)

### Product release date + pre-release banner
- Added `release_date DATE` column to products (migration `20260324190000_add_release_date.sql`)
- Admin product form (both ProductForm and edit pages) now includes a Release Date field
- Break page: when `release_date` is set and in the future, shows a prominent **blue banner** with the launch date and explanation that pricing is estimated from historical comps — not actual sales of this set. Replaces the smaller amber estimated-pricing notice when applicable.
- Set release date for Bowman 25-26 Basketball (~May 2026) to activate automatically

### Team Slots deal checker UX polish
- Renamed "Your $" column → **"Current Break Price"**, moved before Players column
- Column header highlighted in navy, input has blue border — visually distinct from other columns
- Signal badge (BUY/WATCH/PASS + %) still appears inline after input

---

## 2026-03-24 (3) — V2.1 MVP

### Consumer deal checker
- Added "Your $" input column to every team row in the Team Slots table
- User enters what they're being quoted for a slot → instant BUY/WATCH/PASS signal with % delta
- Thresholds: BUY ≥ 30% below fair value, WATCH within 30%, PASS above fair value
- Uses existing `computeSignal()` from `lib/engine.ts`; no backend required — pure client state
- Clicking the input does not expand/collapse the team row (`stopPropagation`)

### Pricing fallbacks for new releases
- When CardHedger returns no data (new product, no sales history), engine falls back through a chain instead of showing $0:
  1. **Search fallback** — `get90DayPrices(playerName + cardType)` — generic 90-day search using player name + "Auto RC" (rookies) or "Base" (veterans)
  2. **Cross-product** — looks up the same player's pricing from another product's cache (e.g., prior year same player)
  3. **Position default** — rookies: $15, veterans: $8
- `pricingSource` type extended: `'search-fallback' | 'cross-product' | 'default'` added alongside existing `'live' | 'cached' | 'none'`
- Player rows with estimated pricing show an amber "est" badge on evMid in the Player Slots table
- Break page shows an amber banner: "X players using estimated pricing" when any fallback sources are active
- Live pricing that returns evMid = 0 now also falls through to the fallback chain (previously showed as 'live' with $0)

### Social currency foundation (schema only)
- Added `buzz_score FLOAT DEFAULT NULL` to `player_products` via migration `20260324180000_add_buzz_score.sql`
- Engine weight formula updated: `hobbyWeight = hobbyEVPerBox × (1 + (buzz_score ?? 0))`
- When `buzz_score` is null/0: behavior identical to before. When populated: proportional boost to that player's slot weight
- No admin UI, no data source yet — column is reserved for future social/buzz pipeline

---

## 2026-03-24 (2)

### Infrastructure: permanent repo location
- Moved repo from `/tmp/breakerz-next` to `~/Documents/GitHub/breakerz` — `/tmp` was wiped on every reboot, corrupting git state and losing context between sessions
- Preserved Vercel project link (`.vercel/project.json`) so deploys still target the same project
- Updated CLAUDE.md and README to reflect the new path and correct production URL (`breakerz.vercel.app`)

### Admin login fix
- Auth route was checking `ADMIN_SECRET` (not set) instead of `ADMIN_PASSWORD`; cookie was `admin_token` instead of `admin_session`
- Proxy was checking `admin_session` against `ADMIN_SESSION_SECRET` — mismatch caused silent auth failures
- Fixed auth route to use correct env vars and cookie names
- Fixed login page: replaced `router.push + router.refresh()` with `window.location.href` to avoid RSC navigation race that caused the hang

### Odds-weighted EV in pricing engine
- Engine now weights the hobby pool by `hobbyEVPerBox` = `Σ(variantEV × 1/hobby_odds)` instead of flat `evMid`
- A $50 card at 1:6 odds gets 8× the weight of a $50 card at 1:48 — reflects actual pull frequency per box
- Added `hobby_odds` to variant select in pricing route; POST path computes per-player `hobbyEVPerBox` from variant data
- GET/cached path falls back to `evMid` when odds data is absent

### CardHedger comps fix
- `/v1/cards/comps` started requiring `count` and `grade` fields — was returning 422
- Fixed `getComps()` to always pass `grade = 'Raw'` and `count = 10` as defaults

### XLSX checklist support (Bowman-style)
- Added `parseChecklistXlsx()` to `lib/checklist-parser.ts` — handles multi-sheet XLSX files
- Each sheet becomes a section (Base, Variations, Prospects, Autographs, Inserts); skips aggregate sheets (Full Checklist, NBA Teams, College Teams)
- Row format: `[card_code, "Player Name,", team_or_college, optional "RC"]` — trailing commas on player names are cleaned automatically
- `parse-checklist` API route detects `.xlsx`/`.xls` and routes accordingly
- Import wizard file input now accepts `.pdf`, `.csv`, `.xlsx`, `.xls`

### Import pipeline: batch DB operations + unique constraint
- Rewrote `import-checklist` API route from ~1500 sequential inserts to ~5 bulk operations — eliminated Vercel function timeouts on large checklists
- Players upserted in one batch; player_products in one batch; variants in chunks of 500
- Fixed `ON CONFLICT` error: added `players_name_sport_id_unique` constraint via migration (`supabase/migrations/20260324145748_players_unique_name_sport.sql`); migration also deduplicates any existing duplicate rows first
- Fixed `ON CONFLICT DO UPDATE affects row a second time`: same player appearing across multiple XLSX sheets was creating duplicate rows in the upsert batch — fixed by deduplicating `playerRows` by name before upserting
- Fixed `total_sets generated column` error: removed `total_sets` from insert payload (it's a Postgres generated column)

### Multi-league products (decision)
- Bowman Basketball mixes NBA, WNBA, and college players in one product
- Decision: treat as "Basketball" sport; player `team` field holds whatever string (NBA team, WNBA team, or college). Break page groups by team/school — correct behavior for a Bowman break.
- No schema change needed.

### Jumbo break type (deferred)
- Jumbo boxes have different odds from Hobby and Breaker's Delight
- Deferred until there's an actual Jumbo product to break — would require `jumbo_case_cost` on products, `jumbo_odds` on variants, third pool in engine

### Admin / product creation fixes
- New product page now redirects to product dashboard after save (was silently succeeding with no navigation)
- Fixed build errors: missing `updateProduct` server action, nullable field type mismatches in `createProduct`, undefined error string in `ProductForm`
- Removed deprecated `middleware.ts` — Next.js 16 uses `proxy.ts`; both files existing caused a startup error

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
