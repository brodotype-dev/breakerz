# Handoff — Upper Deck checklist parser + WaxStat box-pricing scraper

Self-contained doc for a fresh Claude Code session. Drop this whole file into a new session if needed.

## TL;DR

Three-commit ship to land:
1. ✅ **Firecrawl foundation** (already on `main` as `e471a11`)
2. 🟡 **Upper Deck URL parser** — Hockey sport setup, UD product taxonomy already exists, new `lib/upper-deck-parser.ts`, two new admin routes, inline UI on `/admin/products/[id]`
3. 🟡 **WaxStat box-pricing scraper** — schema migration, scraper lib, importer, weekly cron, admin panel. Full plan: prior session's "Waxstat box-pricing scrape + weekly importer" (search vault if not pasted into the new session).

**Blocker right now:** `FIRECRAWL_API_KEY` is not set in `.env.local` or any `.claude/settings.local.json`. Brody needs to run the 4-step env flow below before commit 2 can be tested end-to-end.

## Operational prerequisite (Brody, before fresh session starts)

```bash
# 1. Add FIRECRAWL_API_KEY to Vercel — all three scopes (Production / Preview / Development)
vercel env add FIRECRAWL_API_KEY        # or via dashboard

# 2. Pull down to local
cd /Users/brody/Documents/GitHub/breakerz && vercel env pull .env.local

# 3. Propagate to all 4 .claude/settings.local.json (overwrites the empty placeholders)
node scripts/sync-claude-env.mjs

# 4. Cmd+Q + relaunch Claude Code Mac app so MCP children pick up the new env
```

After step 4 the fresh session should see a populated `FIRECRAWL_API_KEY` in:
- `.env.local` (what Next.js / Vercel functions read)
- `.claude/settings.local.json` × 4 (what the firecrawl MCP entry's `${FIRECRAWL_API_KEY}` interpolation resolves to)

Verify with: `grep -c "^FIRECRAWL_API_KEY=" .env.local` (should print `1`).

## What's already on `main`

Commit `e471a11` — `chore(deps): Firecrawl foundation`:
- `@mendable/firecrawl-js` v4.24.2 installed
- `firecrawl` MCP entry in `.mcp.json` (HTTP remote, key interpolated from env)
- `FIRECRAWL_API_KEY` added to `scripts/sync-claude-env.mjs` whitelist
- CLAUDE.md Stack + env-vars list updated
- CHANGELOG entry under 2026-05-21
- Placeholder slots pre-populated in 4 settings.local.json files (gitignored — local only)

Zero behavior change in app code. Foundation only.

## Design decisions locked (Brody, 2026-05-21)

For UD parser:
- **Extraction strategy:** Claude Haiku via Firecrawl. Hybrid pattern — Firecrawl extracts the HTML table to clean structure, Claude normalizes the multi-format `Stated Odds` column.
- **Checklist + odds:** keep them as SEPARATE imports. Two URL fields, two parsers, two API routes. Even though UD ships them on the same page, BreakIQ's downstream importers are already split (`parse-checklist` + `parse-odds`).
- **Format mapping:** UD encodes 8 pack formats in the `Stated Odds` column (`h` hobby, `e` e-pack, `r` retail, `b` blaster, `mega`, `hanger`, `tin`, `dollar`). Store all 8 in the payload for future flexibility; engine only reads hobby (`h`) for slot math. Matches existing `hobby_odds` / `bd_odds` / `jumbo_odds` pattern.
- **UI placement:** inline on `/admin/products/[id]` — new "Import from URL" affordances in Quick Actions, alongside the existing "Upload odds PDF" button.

For private beta:
- **Football product = `2025 Topps Chrome Football`.** Per Brody 2026-05-21. This product does NOT exist in the DB yet — needs to be created via admin form before flipping `is_active=true`. Update `docs/private-beta-scope.md` to put `2025 Topps Chrome Football` in the Football row of the In-Scope table.

For Discord parsers:
- **No changes needed for hockey.** Audit confirmed there's no hardcoded sport list in `lib/insights-parser.ts` or `app/api/discord/interactions/route.ts`. Players + products flow from DB via `sports(name)` join — once hockey players + UD products land, they auto-appear in roster autocomplete. `BreakFormat = hobby | bd | jumbo` doesn't need extending — UD breakers overwhelmingly sell hobby slots.

## Commit 2 — Upper Deck URL parser (scope + plan)

### Schema / sport setup
- Insert Hockey row into `sports` table via Supabase MCP (no migration needed — single `INSERT`):
  ```sql
  INSERT INTO sports (id, name, slug) VALUES (gen_random_uuid(), 'Hockey', 'hockey');
  ```
- Upper Deck manufacturer + `upper_deck_series` / `upper_deck_artifacts` / `upper_deck_spx` are ALREADY in [lib/product-lines.ts](../lib/product-lines.ts). No code change there.

### New file: `lib/upper-deck-parser.ts`

Single export: `parseUpperDeckUrl(url: string): Promise<{ checklist: ParsedChecklist, odds: ParsedOdds }>`.

Internally:
1. **Firecrawl scrape with JSON extract.** Use `@mendable/firecrawl-js` SDK, format=`json`, with a Zod-shaped schema that extracts the checklist table rows: `[{ setName, cardNumber, playerName, teamCity, teamName, isRookie, hasAuto, hasMem, printRun, sps, statedOdds, point }]`. The `statedOdds` field stays as raw string (e.g. `"2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"`).
2. **Normalize odds column with Claude Haiku.** Pass each unique `statedOdds` string + context to Haiku with a prompt to extract the structured `{ hobby?: string, epack?: string, retail?: string, blaster?: string, mega?: string, hanger?: string, tin?: string, dollar?: string }`. Cache by raw string so we don't re-call Haiku for identical odds strings. Most checklists have ~10-20 unique odds patterns, so ~$0.05 total per import.
3. **Group rows by `setName`** → that becomes `ParsedSection`. Each card in a section becomes one `ParsedCard` with the rich `parallels: [setName]` already set.
4. **Build `ParsedOdds`:** one row per unique (setName, oddsByFormat) tuple. Extend `ParsedOdds.rows[]` type to include optional `oddsByFormat: OddsByFormat` alongside the existing `hobbyOdds: string`. The existing `apply-odds` route reads `hobbyOdds` and continues to work; new oddsByFormat field is stored in payload for future use.
5. Throw on Firecrawl error or empty result so the route surfaces it cleanly.

### New file: `lib/types.ts` extension
Add `OddsByFormat`:
```ts
export type UpperDeckPackFormat = 'hobby' | 'epack' | 'retail' | 'blaster' | 'mega' | 'hanger' | 'tin' | 'dollar';
export type OddsByFormat = Partial<Record<UpperDeckPackFormat, string>>;
```

Extend `ParsedOdds.rows[]` element:
```ts
{ subsetName: string; hobbyOdds: string; breakerOdds: string | null; oddsByFormat?: OddsByFormat }
```

### New routes
- **`app/api/admin/parse-checklist-url/route.ts`** — POST `{ url, productId }`. Calls `parseUpperDeckUrl(url)`, returns `{ checklist: ParsedChecklist }`. Admin auth (mirror `parse-checklist`).
- **`app/api/admin/parse-odds-url/route.ts`** — POST `{ url, productId }`. Same Firecrawl call (cache the response by URL in memory for ~5min so back-to-back checklist+odds imports don't double-charge Firecrawl). Returns `{ odds: ParsedOdds }`. Admin auth.

Reuse existing `apply-odds` route to land the parsed data onto product variants — no changes needed there.

### New UI: inline on product page
Mount in [app/admin/products/[id]/page.tsx](../app/admin/products/%5Bid%5D/page.tsx) Quick Actions. Two text inputs + two buttons:
- `Import checklist from URL` → `POST /api/admin/parse-checklist-url` → use returned ParsedChecklist with existing checklist-apply flow
- `Import odds from URL` → `POST /api/admin/parse-odds-url` → use returned ParsedOdds with existing `apply-odds` flow

Render under or alongside the existing "Upload odds PDF" affordance. Reuse styling from existing buttons.

### Docs to touch
- CHANGELOG entry for commit 2
- CLAUDE.md Current State (new paragraph for UD URL parser)
- CLAUDE.md docs index (add link to UD parser doc if we write one)
- `docs/private-beta-scope.md` — update Football row to `2025 Topps Chrome Football`, note Hockey is being added as a sport, and that UD product creation is the new admin workflow

## Commit 3 — WaxStat box-pricing scraper

Full plan was in the prior session's `2026-05-21` Waxstat plan that Brody pasted. Key implementation points to carry over:

- Migration: `supabase/migrations/{ts}_waxstat_pricing.sql` with three `waxstat_*_url` columns on `products` + new `waxstat_pricing_snapshots` table (per-fetch time series). **CRITICAL:** if the migration adds any Postgres functions, append `NOTIFY pgrst, 'reload schema';` to the bottom (see CLAUDE.md Known Gotcha #10 — bit us hard 2026-05-20). Plain table/column additions don't need it.
- `lib/waxstat.ts` — `fetchBoxPanel(url)` using Firecrawl JSON extract with Zod schema for `{ avgPrice, low30d, high30d, trend7d }`.
- `lib/waxstat-importer.ts` — `refreshProductWaxstat(productId)` that reads the three URL columns, fetches each in parallel, writes snapshots + updates `*_am_case_cost`.
- Cron: `app/api/cron/refresh-waxstat-pricing/route.ts` — Sundays 04:00 UTC in `vercel.json`. Iterates active products, sequential per-product, error-isolated.
- Admin: `app/admin/products/[id]/WaxstatPanel.tsx` — three URL inputs (hobby/jumbo/bd), Refresh Now button per format, latest snapshot summary with error state in red.
- Manual refresh route: `app/api/admin/products/[id]/waxstat-refresh/route.ts`.

Reuses Firecrawl SDK install from commit 1. No new dep.

## Known gotchas the fresh session needs to know

1. **PostgREST schema cache** (CLAUDE.md Known Gotcha #10). If commit 3's migration adds functions, append `NOTIFY pgrst, 'reload schema';` to the bottom of the .sql file. We learned this the hard way 2026-05-20 with the `upsert_ch_price_cache_preserving_nulls` RPC — 30 min of "Internal Server Error" debugging.
2. **`.env.local` location** (CLAUDE.md Known Gotcha #9). The canonical file is `/Users/brody/Documents/GitHub/breakerz/.env.local`. Only one — there used to be `.env.local.real` and `.env.production`, consolidated 2026-05-19. Worktrees do NOT have their own `.env.local`.
3. **Worktree deploy guard.** Never run `vercel --prod` from a worktree path — creates a new Vercel project instead of deploying. Use `git push origin main` (auto-deploys) or `cd /Users/brody/Documents/GitHub/breakerz` first.
4. **Vercel + Cloudflare.** Direct `fetch()` from a Vercel function to a Cloudflare-protected site (UD, WaxStat) gets blocked ~50% of the time. That's exactly why we're using Firecrawl. Don't fall back to direct `fetch()` if Firecrawl errors — surface the error instead.
5. **Settings.local.json gitignored.** Local-only file. The four files we already populated with empty `FIRECRAWL_API_KEY` placeholders will be overwritten by `node scripts/sync-claude-env.mjs` once the real key lands in `.env.local`.

## Verification plan for each commit

### Commit 2 (UD parser)
1. Sport added: `SELECT * FROM sports WHERE slug = 'hockey'` returns one row.
2. Create a test UD product in admin (manufacturer: Upper Deck, line: `upper_deck_series`, sport: Hockey, year: 2025-26).
3. On the product page, paste `https://upperdeck.com/checklist/2025-26-upper-deck-series-2-checklist/` into the Import-checklist-from-URL input → confirm sections + cards land.
4. Same URL into Import-odds-from-URL → confirm odds rows land with `oddsByFormat.hobby` populated.
5. Inspect one player_product_variant row in DB → confirm odds applied correctly.

### Commit 3 (WaxStat)
1. Migration applied to prod via Supabase MCP. `\d products` shows three new `waxstat_*_url` columns.
2. Open an existing product in admin, paste a real waxstat hobby URL → save → snapshot row appears within ~10s + `hobby_am_case_cost` updates.
3. Deliberately broken URL → red error state renders + snapshot row with `error_message` set.
4. Hit `/api/cron/refresh-waxstat-pricing` with `Authorization: Bearer ${CRON_SECRET}` → confirm all mapped products refresh + `cron_run_log` records start + end.

## Today's running commit count

If a fresh session executes commits 2 + 3 cleanly, today's total commits on `main` will land at **15** — eleven prior + commit 1 (Firecrawl foundation, already shipped) + UD parser + WaxStat.

## Out of scope (explicitly)

- Auto-discovery of UD/WaxStat URLs by fuzzy-matching product names. Admin pastes URLs directly.
- Extending `BreakFormat` to include `epack` / `retail` / `blaster` etc. — UD breakers overwhelmingly sell hobby slots; revisit if data ever justifies.
- Consumer surface for the 8-format odds breakdown. Stored in payload, not rendered to users yet.
- Backfilling historical WaxStat snapshots. First weekly run starts the time series.
- Per-retailer pricing breakdown for WaxStat. Aggregate only.
- Discord notifications on material case-price moves.
