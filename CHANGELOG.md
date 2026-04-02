# Changelog

All notable changes to BreakIQ are documented here.
Format: newest first. Each entry covers what changed, why, and any important technical notes.

---

## 2026-03-31 — Auth, Waitlist, Staging Environment

### Admin auth — replaced cookie password with Supabase Auth

The previous admin auth (password cookie via `proxy.ts`) was replaced with a proper Supabase Auth session. Admins now log in with email + password via `signInWithPassword`. Role-based access control is enforced via a `user_roles` table.

**New tables (migration `20260331120000_auth_profiles_roles.sql`):**
- `profiles` — mirrored from `auth.users` (id, full_name, avatar_url); auto-populated on user creation
- `user_roles` — `(user_id, role)` where role is `admin` or `contributor`; admin must be seeded manually after creating a user in the Supabase dashboard

**Middleware (`middleware.ts`):** Cookie-aware Supabase client (via `@supabase/ssr`) refreshes the session on every request. Protects `/admin/*` (except `/admin/login`) and `/api/admin/*` — unauthenticated requests are redirected to `/admin/login?from=<path>`.

**`lib/supabase-server.ts`** (new): Cookie-aware server client for use in Server Components and Server Actions. Uses `@supabase/ssr`'s `createServerClient` with `cookies()` from `next/headers`.

**`lib/auth.ts`** (new): `getCurrentUser()`, `getUserRoles()`, `requireRole(...roles)` — server-side auth helpers. `requireRole()` redirects to `/admin/login` if no session or missing role.

**`app/admin/login/`**: Rewritten from password-only form to email + password form. `actions.ts` calls `signInWithPassword`, checks roles, redirects. `logout` server action calls `supabase.auth.signOut()`.

**Deleted:** `proxy.ts` — old cookie-password protection. Was conflicting with `middleware.ts` (Next.js doesn't allow both simultaneously).

---

### Waitlist — public signup + admin approval + Resend invite

Private beta gating via a waitlist. Visitors sign up at `/waitlist`; admins approve from `/admin/waitlist`; approved users receive a Resend invite email with a pre-filled invite link.

**New table (migration `20260331130000_waitlist.sql`):**
```
waitlist (id, email, full_name, use_case, status, invite_code, invite_sent_at, converted_at, notes, created_at)
```
Status enum: `pending → approved → converted` (or `rejected`). `invite_code` is a 12-char hex string generated at approval time. `UNIQUE` on email.

**New routes and files:**
- `app/waitlist/page.tsx` — public signup form with success / already-on-list states
- `app/admin/waitlist/page.tsx` — server component, calls `requireRole('admin')`, renders `WaitlistTable`
- `app/admin/waitlist/WaitlistTable.tsx` — client component with tabs (pending / approved / converted / rejected), "Approve + Invite →" button with optimistic update
- `app/api/waitlist/route.ts` — public POST; handles `23505` unique constraint as `already_on_list`
- `app/api/admin/waitlist/[id]/approve/route.ts` — generates `randomBytes(6).toString('hex')` invite code, updates waitlist record, sends Resend email. Returns `{ ok: true, emailError: true }` if email fails but code was saved.
- `lib/email.ts` — `sendInviteEmail()` using Resend SDK. Lazy `new Resend(key)` inside `getResend()` — avoids build failure when `RESEND_API_KEY` is not set.
- `app/auth/signup/page.tsx` — Phase 3 placeholder (consumer signup coming in next cycle)
- `app/admin/AdminNav.tsx` — added Waitlist nav link

**New env vars:** `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`

---

### Consumer route gating

Unauthenticated visitors on `/break/*` or `/analysis/*` are now redirected to `/waitlist`. Admins (who have a Supabase session) pass through.

Added to `middleware.ts`:
```typescript
const isConsumerRoute = pathname.startsWith('/break') || pathname.startsWith('/analysis');
if (isConsumerRoute && !user) redirect('/waitlist');
```
Matcher updated to include `/break/:path*` and `/analysis/:path*`.

---

### Staging environment

Separate Supabase project (`isqxqsznbozlipjvttha`) for Preview and Development Vercel environments. Production (`zucuzhtiitibsvryenpi`) remains unchanged.

- **Initial schema migration** (`20260101000000_initial_schema.sql`) created — base tables (`sports`, `products`, `players`, `player_products`, `pricing_cache`) were previously applied manually to production. This migration makes staging reproducible and marks the baseline for future migration tracking. On production: marked as already-applied via `supabase migration repair --status applied`.
- All subsequent migrations applied to staging via `supabase db push`.
- Vercel Preview and Development env vars updated to point to staging Supabase.
- `staging` git branch created and pushed — Vercel auto-deploys preview builds from this branch.

---

### CardHedger matching — manufacturer knowledge system + Bowman's Best ceiling

**Manufacturer knowledge system (`lib/card-knowledge/`)** — extracted all manufacturer-specific matching logic from the route into a typed module system:
- `types.ts` — `ManufacturerKnowledge` interface (`matches()`, `cleanVariant()`, `reformulateQuery()`, `claudeContext()`)
- `default.ts` — no-op fallback (identity transforms, empty context)
- `bowman.ts` — all Bowman/Topps logic: variant cleaning (strips "Base -", "Retrofractor", insert set names), card-code detection, multi-player reformulation (slash-delimited names → code-only query)
- `panini.ts` — stub (matches returns false until Panini XLSX files have been analyzed)
- `index.ts` — registry + `getManufacturerKnowledge(productName)`

`lib/cardhedger.ts`: `claudeCardMatch()` and `cardMatch()` now accept an optional `context` string injected into the Claude Haiku prompt. `lib/supabase.ts` pattern used for `??` fallback.

**Tier 2 player-name fallback fix:** The pre-Claude bypass in `cardMatch()` for autograph card codes (BMA-/BSA-/CA-) was comparing against `cards[0].player_name`, but the CH API returns a `player` field at runtime (not `player_name`). Fixed with `c0.player_name ?? c0.player ?? ''`. Also fixed Tier 2 to compare first name only (not all name parts) — avoids false negatives on accented/middle names.

**Multi-player reformulation:** Slash-delimited player names (DA-/TA-/QA-/FDA-/FTA- card codes) now reformulate to a code-only query `[year, setName, cardCode]` — no player name in the query, which CH handles correctly for these sets.

**Bowman's Best — practical ceiling analysis:** After iterative query tuning through CSV 1–10, match rate reached ~76%. Remaining ~24% is structural:
- ~24 multi-player dual/triple/quad auto cards — CH doesn't index under combined names
- ~173 code-only duplicate rows — CH doesn't expose a `number` field for autograph sets, so duplicate code rows (same code, different player) can't be disambiguated without manual intervention

Calling ~76% the practical ceiling for automated matching on Bowman's Best. Full analysis documented in `docs/cardhedger-matching.md` and `docs/manufacturer-rules/bowman.md`.

**New files:** `lib/card-knowledge/types.ts`, `lib/card-knowledge/default.ts`, `lib/card-knowledge/bowman.ts`, `lib/card-knowledge/panini.ts`, `lib/card-knowledge/index.ts`
**Modified:** `lib/cardhedger.ts`, `app/api/admin/match-cardhedger/route.ts`, `docs/cardhedger-matching.md`, `docs/manufacturer-rules/bowman.md`

---

## 2026-03-27 — Card Lookup Tool

### New feature: `/admin/card-lookup`

Personal auction bidding aid — screenshot any graded card listing, get instant pricing from CardHedger before bidding.

**Flow:**
1. Drop a screenshot of an auction listing (eBay, Goldin, PWCC, etc.)
2. Claude Haiku (vision) extracts: player name, set, year, card number, variant, grading company, grade, cert number
3. Cert lookup via `POST /v1/cards/prices-by-cert` — confirms card identity
4. If cert has no price history (common), auto-falls back to name-based search
5. Grade-level price estimates (all PSA/BGS/SGC grades) + 90-day comps displayed
6. Max bid calculator: enter your margin % → ceiling updates live

**Key technical decisions:**
- `prices-by-cert` returns sale history for the specific physical slab, not aggregate market data. Most certs return empty `prices[]`. Grade-level pricing (`all-prices-by-card`) and `comps` are the primary signals.
- When cert lookup returns empty prices, the client automatically retries with name-based search using the extracted fields; an amber notice explains the fallback.
- Card name search returns `player`/`set` field names (not `player_name`/`set_name`) — the route maps both.
- Top-level try/catch in the route handler prevents empty 500 bodies; any crash returns structured `{ error }` JSON.
- `comps` API returns `null` (not `[]`) when no results — all null guards added.

**UI:**
- Two-panel layout: left = screenshot + editable extracted fields; right = results
- Extracted fields are editable — if Claude misreads a field, correct it and re-run
- Card image shown when available from CardHedger
- Grade Prices table: all available grades, matched grade highlighted in blue
- Recent Comps table: sale price, grade, date, platform (when 90-day data exists)
- "Last Sale (Exact Cert)" label clarifies this is cert-specific, not aggregate

**New files:** `app/admin/card-lookup/page.tsx`, `app/admin/card-lookup/error.tsx`, `app/api/admin/card-lookup/route.ts`, `docs/card-lookup/prd-card-lookup.md`
**Modified:** `lib/cardhedger.ts` (added `pricesByCert()`), `app/admin/layout.tsx` (Card Lookup nav link)

---

## 2026-03-26 (2)

### Fix: Admin UI buttons invisible after design system update

Figma Make theme import had set shadcn semantic vars to light values (`--primary: #030213`, `--input: transparent`, `--border: rgba(0,0,0,0.1)`), making all shadcn-based admin buttons and inputs invisible. Remapped all shadcn vars (`--primary`, `--background`, `--card`, `--border`, `--input`, `--muted`, etc.) to terminal design system values in `globals.css`.

**Modified:** `app/globals.css`

---

## 2026-03-26 (1)

### Terminal Design System + Full Consumer UI Redesign

Major visual overhaul — "Bloomberg terminal for card breaks" direction applied across all consumer-facing pages. The design system is now codified in the repo and sourced from Figma Make.

**Design system (`components/breakerz/ds/`)**
- New DS component library: `ElevatedCard`, `StepHeader`, `FormLabel`, `SegmentedControl`, `CounterInput`, `LargeCTAButton` — all using terminal CSS custom properties
- Design tokens stored at `design-assets/design-system-tokens.json`; component specs at `design-assets/DESIGN_SYSTEM_EXPORT.md`
- All DS components exported from `components/breakerz/ds/index.ts`
- Workflow: Figma Make → export source zip → copy CSS/components → adapt for Next.js (Link href, useParams from next/navigation, real data)

**`app/globals.css`**
- Added terminal design system CSS custom properties: `--terminal-bg`, `--terminal-surface`, `--terminal-border`, `--terminal-border-hover`, `--accent-blue`, `--signal-buy/watch/pass`, `--gradient-blue/hero`, `--glow-blue/green`, `--badge-icon`, sport-specific color tokens, etc.
- Defined as non-layered `:root` rules so they override Tailwind's `@layer base` body styles — intentional, do not move into a layer
- Added `.terminal-label`, `.terminal-surface`, `.signal-buy/watch/pass` utility classes

**`app/layout.tsx`**
- Switched fonts to Inter + JetBrains Mono (via `next/font/google`)

**`app/page.tsx` — Homepage**
- Full redesign: sticky terminal status bar (live count, pre-release count, version), hero section with cards photo background, gradient title, CTA buttons ("Analyze a Break" / "Browse Products"), feature pills
- Products section: terminal-bordered card grid with sport-specific gradient accents, pre-release state, last updated timestamp
- BreakIQ Sayz promo card at bottom of hero area
- Hero background: Unsplash sports card image at 20% opacity as base layer under gradient/dot overlays

**`app/break/[slug]/page.tsx` — Break analysis page**
- Redesigned with terminal aesthetic: dark header, tabbed TeamSlots/PlayerSlots with SegmentedControl-style tabs, DashboardConfig panel

**`app/analysis/page.tsx` — BreakIQ Sayz**
- Full redesign to match Figma Make two-column layout
- Hero header: dark gradient with dot pattern, TrendingUp icon, gradient title, Instant Analysis / Market Intelligence / Social Signals feature pills
- Left column: "1 Configure Your Break" — `ElevatedCard` with `SegmentedControl` (Hobby/BD), `CounterInput` for cases, styled native selects for product/team, large price input, `LargeCTAButton`
- Right column: "2 AI Analysis" — `ElevatedCard` with empty state or full result panel
- Result panel: signal verdict card (color-coded border/bg by BUY/WATCH/PASS), fair value vs asking price grid, AI narrative, key players table, HV advisory, risk flags
- All existing data logic preserved (API calls, Supabase team fetch, result types)

**`components/breakerz/DashboardConfig.tsx`**
- Rebuilt using DS components: `ElevatedCard`, `FormLabel`, `CounterInput`

**`components/breakerz/TeamSlotsTable.tsx`, `PlayerTable.tsx`**
- Restyled with terminal design system vars, Social Currency badges updated

**`components/breakerz/ProductCard.tsx`**
- New component matching Figma Make product card design

**New files:** `components/breakerz/ds/` (6 DS components + index), `components/breakerz/SignalBadge.tsx`, `components/breakerz/SocialBadges.tsx`, `design-assets/DESIGN_SYSTEM_EXPORT.md`, `design-assets/design-system-tokens.json`
**Modified:** `app/analysis/page.tsx`, `app/break/[slug]/page.tsx`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/breakerz/DashboardConfig.tsx`, `components/breakerz/PlayerTable.tsx`, `components/breakerz/TeamSlotsTable.tsx`

---

## 2026-03-24 (6)

### Social Currency — BreakIQ Bets Debrief (B-score input)

- New admin section on `/admin/products/[id]` — **BreakIQ Bets Debrief**: conversational B-score input for the editorial scoring layer
- Flow: admin pastes a free-form market narrative ("Wemby is running hot, Cade's been quiet…") → Claude Haiku parses against the product's full player roster with fuzzy name matching → returns suggested scores (-0.5 to +0.5) and drafted reason notes → admin reviews in a table, edits scores/notes, unchecks any players to skip → clicks "Apply" → writes to DB
- Review table: pill-selector for score (−0.5, −0.25, 0, +0.25, +0.5), editable reason note, include/exclude checkbox; low-confidence matches (< 0.7) flagged amber "Review"
- Hallucination guard: API validates all returned `player_product_id`s against the actual roster — any IDs Claude fabricated are filtered out before returning to the client
- `saveBreakerzBets` server action writes `breakerz_score` + `breakerz_note` to `player_products`
- Migration `20260324200000_add_breakerz_bets.sql`: added `breakerz_score FLOAT` and `breakerz_note TEXT` to `player_products`
- **Note:** data was collected in this session but `breakerz_score` was not yet wired into the engine — that shipped in session (7) Phase 1

**New files:** `app/admin/products/[id]/BreakerzBetsDebrief.tsx`, `app/api/admin/parse-bets-debrief/route.ts`, `supabase/migrations/20260324200000_add_breakerz_bets.sql`
**Modified:** `app/admin/products/[id]/page.tsx`, `app/admin/products/actions.ts`

---

## 2026-03-24 (7)

### Social Currency — Phase 1: BreakIQ Bets wired into engine; Phase 2: Icon tier; Phase 3: Risk flags + high volatility

**Phase 1 — BreakIQ Bets live**
- `lib/engine.ts`: engine now reads both `buzz_score` (automated composite) and `breakerz_score` (editorial), combining them as `effective_score = clamp(buzz_score + breakerz_score, -0.9, 1.0)` before applying the slot cost multiplier. Data was already being collected; now it affects actual prices.
- `app/api/analysis/route.ts` + `app/api/pricing/route.ts`: both select `breakerz_score` from DB; Sayz passes editorial notes to Claude prompt when set
- Migration `20260324200000_add_breakerz_bets.sql` was already applied in session (6)

**Phase 2 — Icon tier**
- `players.is_icon BOOLEAN` added (migration `20260324210000_icon_and_risk_flags.sql`)
- Engine skips buzz multiplier entirely for icon-tier players — their structural demand is already reflected in market EV; applying a multiplier would double-count demand
- Admin toggle on `/admin/products/[id]/players` — purple ★ button per player
- Sayz result card shows purple "★ Icon" badge next to icon players in the key players list; icon context passed to Claude prompt

**Phase 3 — Risk flags + high volatility**
- `player_risk_flags` table: `(id, player_product_id, flag_type, note, created_at, cleared_at)` — soft-delete pattern, cleared flags preserved for audit
- `player_products.is_high_volatility BOOLEAN` added
- Admin UI at `/admin/products/[id]/players` — per-player flag add/clear (⚑ button), HV toggle (⚡ button)
- Flag types: injury, suspension, legal, trade, retirement, off_field
- Sayz result card: red ⚑ banner per active flag with player name + note; amber ⚡ high volatility advisory block; both passed to Claude prompt with explicit instruction to mention flagged players
- Engine math unchanged — flags are disclosure-only, not a score input

**New files:** `app/admin/products/[id]/players/PlayerFlagsManager.tsx`, `supabase/migrations/20260324210000_icon_and_risk_flags.sql`
**Modified:** `lib/types.ts`, `lib/engine.ts`, `app/admin/products/actions.ts`, players admin page, `app/api/analysis/route.ts`, `app/analysis/page.tsx`

---

## 2026-03-24 (5)

### BreakIQ Sayz — rename + case count input + homepage CTA
- Renamed feature from "Breaker Says" → **"BreakIQ Sayz"** everywhere (page title, header, nav links)
- Added **Cases in the break** input on the analysis page (default 10, range 1–50); fair value now scales correctly for single-case vs multi-case group breaks
- API (`POST /api/analysis`) accepts `numCases` param; feeds into `BreakConfig.hobbyCases` / `bdCases` — previously always assumed 10 cases
- Homepage: replaced buried text link with a full-width promo strip between header and products — red "BreakIQ Sayz" badge, tagline, and prominent "Check a deal →" CTA button

---

## 2026-03-24 (4)

### BreakIQ Sayz — AI break slot analysis page
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
