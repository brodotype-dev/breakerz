# Web-Sourced Intel — Session Handoff (2026-05-28)

Status snapshot for the "fill the non-CH data gap" build (Track A prospect
rankings + Bucket A editorial + Bucket B open-ended URL ingestion). The
original brainstorm plan was chat-only (never committed); this doc is the
self-contained source of truth going forward.

## TL;DR

Across one long session we shipped **11 PRs (#159–#169)** covering Slices 1, 2a,
2b, 3, and 4a + the web-source parser mode. Everything is **feature-flag-gated
or admin-only — nothing touches the pricing engine or consumer pricing yet.**
The remaining work is Slice 4b (recurring cron), Slice 5 (more prospect
sources), Slice 6 (engine activation), and a few fast-follows.

**⚠️ Outstanding housekeeping:** `CHANGELOG.md` has NOT been updated for any of
#159–#169, and `CLAUDE.md` "Current State" has no entries for this arc. The
per-PR commit messages + this doc carry the detail in the interim. Consolidating
both is the top fast-follow.

## The plan in brief

Two unmet needs: (1) pre-release hype is model-output, not editorial reality;
(2) the Track A prospect-attribute layer was designed (2026-05-12 plan) but never
fed. Solution: scrape the open web, admin-curated like `/insight`, reusing
existing sinks.

Three ingestion shapes:
- **Track A / Bucket B structured** — dedicated scrapers (MLB Pipeline first)
  write objective rankings to `prospect_rankings`; material moves get endorsed
  into observations.
- **Bucket A editorial (Shape 1)** — per-product `editorial_urls`, admin-curated,
  scraped on demand into product/player `market_observations`. No Discord.
- **Open-ended (Shape 2)** — `/url-source` Discord command: any URL + cadence +
  stop_after → `tracked_sources` → scrape → `pending_insights` proposal via the
  existing ✅/✏️/❌ flow. First scrape now; recurring via cron (4b).

## Slice status

| Slice | What | Status |
|---|---|---|
| 1 | `prospect_rankings` + MLB Pipeline scraper + direct write | ✅ shipped + **verified on prod** (100 scraped, 76 matched) |
| 2a | Diff engine (±3 material moves) + admin movers report | ✅ shipped, not yet exercised (needs 2 scrapes w/ a rank change) |
| 2b | Endorse moves → `prospect_rank_move` observations (inline web approval) | ✅ shipped, endorse UI untested on real movers |
| 3 | Editorial URLs (Bucket A) → `market_observations` | ✅ shipped, **NOT prod-verified** (needs a real Beckett scrape) |
| 4a | `tracked_sources` + `/url-source` command + first scrape | ✅ shipped + registered (5 cmds); tested vs Substack homepage → `[]` (thin homepage, expected) |
| — | web-source parse mode (`parseInsights({webSource:true})`) | ✅ shipped, not yet validated on a content-rich URL |
| 4b | `createChannelMessage` + nightly cron for recurring sources | ⏳ NOT STARTED |
| 5 | More structured prospect sources (NPB, NBA, NHL) | ⏳ NOT STARTED |
| 6 | Engine activation (shadow→full) + resolve two-lane Track-A overlap | ⏳ NOT STARTED |

## PRs this session (#159–#169)

- **#159** Slice 1 — `prospect_rankings` migration, `lib/scrapers/mlb-pipeline.ts`, `lib/prospect-rankings-import.ts`, admin button, route. Direct write (no proposal).
- **#160** fix — scrape button rendered a Vercel platform-error OBJECT → React #31 → full admin-page crash. `errText()` coercion.
- **#161** fix — MLB Pipeline URL was the hub page (`/prospects` → 5 featured) not the ranked table (`/prospects/stats/top-prospects` → 100). + `errText` sweep on RefreshCatalog/HydrateVariants buttons.
- **#162** fix — dedupe within a single scrape (ranked page lists some players in 2 sections → 12 dupe rows). Keep best rank per player.
- **#163** feat — surface unmatched prospect names in the button + CLAUDE.md gotcha #13.
- **#164** Slice 2a — `lib/prospect-rankings-diff.ts` (computeProspectDiff, `PROSPECT_RANK_MATERIAL_DELTA=3`) + admin movers report.
- **#165** Slice 2b — `prospect_rank_move` observation type migration, `apply-prospect-moves` route, inline checklist endorse UI on the button.
- **#166** Slice 3 — `products.editorial_urls` migration, `lib/scrapers/editorial.ts`, `lib/editorial-parser.ts`, `lib/editorial-import.ts`, `editorial-refresh` route, `EditorialPanel`.
- **#167** Slice 4a — `tracked_sources` migration, `lib/tracked-sources.ts`, `/url-source` registration, `handleUrlSource` + refine branch.
- **#168** feat — `webSource` parse mode (long-content framing + 8192 tokens) for `/url-source`.
- **#169** fix — surface `scraped=<N> chars` + 400-char preview in `/url-source` no-updates debug.

## Migrations applied to prod (all via Supabase MCP)

- `20260528094702_prospect_rankings.sql` — table + `feature_flags.prospect_rank_enabled` (false). Admin-only (REVOKE).
- `20260528123742_prospect_rank_move_observation.sql` — adds `prospect_rank_move` to `market_observations` observation_type CHECK.
- `20260528155434_products_editorial_urls.sql` — `products.editorial_urls text[]`.
- `20260528160519_tracked_sources.sql` — table. Admin-only (REVOKE). Index on `(status, next_scrape_at)`.

## Key files (navigation map)

- `lib/scrapers/mlb-pipeline.ts` — Firecrawl JSON scrape of MLB Pipeline Top 100.
- `lib/scrapers/editorial.ts` — content-agnostic Firecrawl **markdown** scrape (12k-char cap). Reused by `/url-source`.
- `lib/prospect-rankings-import.ts` — name-match (normalized) vs baseball roster, dedupe, direct write.
- `lib/prospect-rankings-diff.ts` — diff latest vs prior scrape; `describeMove()`.
- `lib/editorial-parser.ts` — `parseEditorial()`, emits ONLY market-observation kinds.
- `lib/editorial-import.ts` — `refreshProductEditorial()`, per-URL scrape→parse→supersede→write.
- `lib/tracked-sources.ts` — cadence/stop_after helpers (`computeStopAt`, `computeNextScrapeAt`, `isOneShot`).
- `lib/format-error.ts` — `errText()` (gotcha #13).
- `lib/insights-parser.ts` — `parseInsights` now takes `webSource?: boolean`.
- `app/api/admin/scrape-mlb-pipeline/route.ts` — scrape + import + diff (returns structured movers).
- `app/api/admin/apply-prospect-moves/route.ts` — writes endorsed moves as `prospect_rank_move` obs.
- `app/api/admin/products/[id]/editorial-refresh/route.ts` — POST (scrape) / PUT (save URLs).
- `app/admin/products/[id]/ScrapeMlbPipelineButton.tsx` — scrape + movers checklist + endorse.
- `app/admin/products/[id]/EditorialPanel.tsx` — editorial URL textarea + Save/Re-scrape.
- `app/api/discord/interactions/route.ts` — `handleUrlSource` + `tracked_source_scrape` refine branch.
- `scripts/register-discord-commands.mjs` — `/url-source` (5 commands total now).

## Decisions locked

1. **Slice 1 raw rankings write DIRECT** (no Discord proposal) — rank is objective fact.
2. **`PROSPECT_RANK_MATERIAL_DELTA = 3`** — moves of ≥3 spots / new entries / drop-offs are material.
3. **Endorsed moves (2b) → dedicated `prospect_rank_move` `market_observation`** — NOT `breakerz_score` (that's Track B SME sentiment; would conflate + get clobbered by next `/insight`), NOT `players.prospect_rank` (would fire the engine's `computeProspectAdjustment` immediately, bypassing the Slice-6 shadow gate).
4. **Editorial (Slice 3) emits ONLY market-observation kinds** — never `breakerz_score` sentiment, never prices. Track separation, same principle as #3.
5. **X/Twitter feeds deferred** — Firecrawl can't reliably scrape x.com in 2026 (anti-bot). WaxMetrix-style feeds need a dedicated X API (twitterapi.io / Apify) — own spike, not started.
6. **Substack** — homepage is thin (no article bodies, partly paywalled); target individual **post URLs** or `/feed` (carries bodies). Good recurring-cron candidate.

## Gotchas discovered this session

- **gotcha #13 (in CLAUDE.md):** admin action buttons must run `json.error` through `errText()` + guard `res.json()` — a Vercel platform-error object rendered raw → React #31 → whole admin page crash.
- **Firecrawl is untestable in this dev env** (MCP token dead); prod's `FIRECRAWL_API_KEY` runs the real scrapes. Every scraper needed prod iteration (MLB Pipeline took 4 follow-ups). Expect the same for editorial + `/url-source`.
- **MLB ranked table** lists some players twice (risers highlight + main table) → importer dedupes per player.
- **Discord re-registration**: only needed when the slash-command schema changes. `/url-source` (Slice 4a) needed it; future schema changes do too. Run `node --env-file=.env.local scripts/register-discord-commands.mjs` (NOT `source .env.local` — `.env` values with special chars break bash `source`).

## How to resume — next steps in priority order

### Slice 4b — recurring cron (the natural next build)
- **Add `tracked_sources.discord_channel_id text`** (migration) — `handleUrlSource` must populate it from `interaction.channel_id` so the cron knows where to post. (4a does NOT store it yet.)
- **Add `createChannelMessage(channelId, body)` to `lib/discord.ts`** — POST `/channels/{id}/messages` via bot token. Only `editChannelMessage` exists today.
- **Extract a shared `scrapeAndStageProposal({url, note, channelId, submittedBy})`** from `handleUrlSource` that returns the proposal message body, so both the interaction reply AND the cron can post it.
- **`app/api/cron/refresh-tracked-sources/route.ts`** — iterate `tracked_sources WHERE status='active' AND next_scrape_at <= now() AND (stop_at IS NULL OR stop_at > now())`; per row: scrape → `parseInsights({webSource:true})` → stage `pending_insights` (`source_kind='tracked_source_scrape'`) → post via `createChannelMessage` → advance `next_scrape_at` (computeNextScrapeAt) → flip `status='done'` when `stop_at` passes. `recordCronStart` marker. Add to `vercel.json` (nightly).

### Slice 5 — more structured prospect sources
ESPN NBA Big Board, NHL Central Scouting, NPB signees. Each a scraper like
`mlb-pipeline.ts` (structured table → Zod JSON) OR seed as recurring `/url-source`
rows. Per-source materiality tuning if one proves noisy.

### Slice 6 — engine activation + resolve the two-lane overlap
**Critical unresolved architecture:** there are TWO Track-A mechanisms —
(a) `players.prospect_rank` → `computeProspectAdjustment` (in `lib/prospect-score.ts`,
called UNCONDITIONALLY in `lib/break-page-data.ts`, but `players.prospect_rank` is
unpopulated) and (b) the new `prospect_rankings` table (read by nothing yet). Slice 6
must consolidate to ONE lane, gated behind `prospect_rank_enabled` (currently false),
shadow-mode first (compute but don't apply; watch Market Delta Watch), then flip live.

### Fast-follows (no hard dependency)
- **CHANGELOG.md + CLAUDE.md current-state** consolidation for #159–#169 (top priority — docs debt).
- **Surface `prospect_rank_move`** in consumer views (`WhyThisPriceCard` / `PreReleaseLayout` read product-scope `market_observations` but not this player-scoped type yet). Editorial obs (Slice 3) DO surface for free.
- **X-feed ingestion spike** (twitterapi.io / Apify) — only if WaxMetrix-style feeds become a priority.

## Verification still owed (prod, can't test locally)

1. **Slice 3 editorial** — paste a real Beckett product-news URL on a pre-release product, Re-scrape, confirm `market_observations` rows + pre-release chips render.
2. **`/url-source` on a content-rich URL** — a specific Slabsquatch POST (not homepage), confirm multi-entity extraction. The #169 debug now shows `scraped=<N> chars` to diagnose thin vs rich.
3. **Slice 2a/2b** — after two MLB Pipeline scrapes with a rank change, confirm movers surface + endorse writes `prospect_rank_move` rows.
