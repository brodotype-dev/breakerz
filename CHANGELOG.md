# Changelog

All notable changes to BreakIQ are documented here.
Format: newest first. Each entry covers what changed, why, and any important technical notes.

---

## 2026-07-27 — Disk IO reduction #2: catalog refresh nightly → weekly

Supabase sent a **second** High Disk IO warning — the 07-19 cuts helped but didn't get under the compute tier's baseline, and 5 more products are landing this week. Diagnosis: the nightly **catalog refresh** is the biggest remaining write-IO event — `refresh-ch-catalogs` does a full delete-then-insert of every active product's entire CH catalog every night (`ch_set_cache` is 259 MB / 252K rows = ~500K row writes + index churn nightly), even though card catalogs barely change after a set releases.

Moved it from nightly (`0 3 * * *`) to **weekly, Sunday 01:00 UTC** (`0 1 * * 0`) in [vercel.json](vercel.json) — isolated from the 3–6:30 AM pricing window so the heavy write no longer stacks on pricing scans. Cuts the single biggest nightly write by ~85% with no real freshness loss: new products still refresh on-demand via the "Refresh CH Catalog" button at setup, and CH adding cards to existing sets is caught by the nightly `ch_additions` feed → manual `drive-rematch`. [CronStatusPanel](components/admin/CronStatusPanel.tsx) gets an 8-day stale threshold for the catalog cron (was 26h) so weekly cadence doesn't false-alarm, plus a corrected pricing-schedule label (×8, not ×5).

Companion one-time `VACUUM FULL public.ch_set_cache` (reclaims ~100 MB of free space retained from the dropped `raw` column → smaller table to scan/vacuum) is owed — run manually from the Supabase SQL editor (it takes a brief ACCESS EXCLUSIVE lock). Brody is also upgrading the Supabase compute add-on to raise the IO baseline for growth; these free cuts extend whatever tier we land on. Structural fix (streaming pricing rearchitecture) still the long-term answer.

## 2026-07-19 — Disk IO reduction: cron 12 → 8 firings + drop unused `ch_set_cache.raw`

Supabase sent a "High Disk IO Consumption" warning on prod (`zucuzhtiitibsvryenpi`). Diagnosis: the IO-heavy nightly pipeline (catalog delete-reinsert of 196K rows into the 259 MB `ch_set_cache` + pricing scans over the 280K-variant / 143K-price-cache hot tables) on a small compute tier, with the 2026-07-17 cron bump (5 → 12 firings) adding ~2.4× read passes right before the warning fired. Two free reductions, no compute upgrade:

1. **Pricing cron 12 → 8 firings** — [vercel.json](vercel.json) `*/20 3-6` → `*/30 3-6` (fires :00/:30 across 3–6 AM UTC). ~24 product-slots/night at 3 workers/firing, still well above the pre-audit 15 and enough for current ~16 active products. Partly reverses the 07-17 increase while keeping headroom.
2. **Stopped writing `ch_set_cache.raw`** — the full untransformed CH card payload was persisted as a JSONB column ([lib/cardhedger-catalog.ts](lib/cardhedger-catalog.ts)) on every nightly catalog refresh but read *nowhere* (`loadCatalogIndex`, `ch-coverage.ts`, the product page all select specific columns). It was ~half the table's 259 MB and pure write-IO. Removed from the insert; column dropped via migration. The table shrinks progressively as each set's rows get delete-reinserted (smaller) on subsequent nightly catalog refreshes. If a future feature needs the raw CH fields, re-add the column *and* a reader together.

Structural fix (streaming pricing rearchitecture) still owed before ~18 active products — this buys runway.

## 2026-07-17 — Pricing cron: 5 → 12 nightly firings (interim throughput bump)

A system audit found the nightly pricing cron finishing `partial: true` on 2025 Topps Chrome Football (33.9K variants) at ~286s of the 300s Vercel kill — self-healing, but zero headroom with more products loading. Interim fix: replaced the 5 scattered `refresh-pricing` firings in [vercel.json](vercel.json) with a single `*/20 3-6 * * *` window (every 20 min, 3:00–6:40 AM UTC = 12 firings). At 3 concurrent workers/firing that's ~36 product-slots/night (up from 15), ~2.4× capacity — covers ~30 active products. Self-limiting: firings quick-exit when nothing's stale (stale-first selection), so extra firings only spend CH calls when there's real work. Config-only; no code change. This moves the ceiling, it doesn't remove it — the structural fix is the streaming rearchitecture ([docs/plans/2026-05-10-streaming-pricing-refresh.md](docs/plans/2026-05-10-streaming-pricing-refresh.md), now targeted before ~18 active products). Also dropped the 4 stale `archive_junk_*` backup tables from the June cleanup (clears 4 DB advisories).

## 2026-06-22 — Admin waitlist: resend invite + login status

Two adds to `/admin/waitlist`. (1) **Resend invite** — a button on every `approved` row re-sends the invite email, reusing the existing `invite_code` (so prior links keep working) and bumping `invite_sent_at`. New `POST /api/admin/waitlist/[id]/resend` ([route](app/api/admin/waitlist/[id]/resend/route.ts)) mirrors `/approve`'s best-effort send + `emailDelivered` reporting; the table surfaces a send failure inline and shows a transient "✓ Sent" on success. (2) **Login status** — each row now shows whether (and when) the user has actually signed in, sourced from `auth.users.last_sign_in_at` matched by email ([page](app/admin/waitlist/page.tsx) enriches via `auth.admin.listUsers`). Ground truth independent of the `converted` status: green "✓ Logged in {date}" when they've signed in, muted "Not logged in yet" for approved/converted who haven't. Header gains a "N logged in" count. [WaitlistTable](app/admin/waitlist/WaitlistTable.tsx).

## 2026-06-17 — Private-beta: unlimited analyses / slabs / breaks (flag-gated)

Brody's call: with this few users we need DATA more than revenue, so during private beta every user gets unlimited usage. All three paywalled actions (`/api/analysis`, `/api/card-lookup`, `/api/my-breaks`) flow through `checkAndIncrementUsage` in [lib/usage.ts](lib/usage.ts); added a short-circuit at the top — when `feature_flags.private_beta_unlimited` is ON, it returns `{ allowed: true, remaining: null, plan: 'beta' }` before any plan/limit logic. Toggle via SQL, no deploy. **Not permanent** — flip the flag off to restore Free/Hobby/Pro tiers (the limit constants are untouched). The usage *data* we actually want (break records, analysis runs, PostHog events) is captured independently, so bypassing the counter loses no signal. Note: `/subscribe` still shows the tier copy (5 free / Hobby / Pro) — left as-is since billing returns when the flag flips; revisit the copy if beta runs long.

## 2026-06-17 — "Bought in? Log this break" CTA (analyze → log handoff, prefilled)

After running a break analysis there was no path to log it — the user had to navigate to My Breaks and re-enter the same product / teams / format mix / ask. Added a **"Bought in? Log this break →"** button on [AnalysisResultPanel](components/breakiq/AnalysisResultPanel.tsx) (so it shows on both `/analysis` and the inline `/break/[slug]` analyzer). It deep-links to `/my-breaks?view=new` with the analyzed config in query params (`productId`, `teams`, `hobby`/`bd`/`jumbo`, `ask`). [My Breaks](app/(consumer)/my-breaks/page.tsx) parses those into a `BreakFormPrefill` and hydrates the new-break form's product / teams / format counters / ask price, so the log is one click + confirm. Guarded the form's product-change reset so it fires only on an actual change, not the prefilled mount (which would otherwise wipe the carried-over teams). No new params required — an empty/normal "Log a Break" still opens a blank form.

## 2026-06-17 — Prospect chip: `#N` → `P-N` + table legend

The bare `#46` prospect chip didn't read as "prospect rank" — could be a card number, a slot, anything. Relabeled to **`P-46`** (Prospect-rank) in [components/breakiq/ds/ProspectRankChip.tsx](components/breakiq/ds/ProspectRankChip.tsx), and added a compact **`ProspectRankKey`** legend (`P-# = MLB Pipeline prospect rank` + the tier color swatches ≤10/≤30/≤100) rendered above [PlayerTable](components/breakiq/PlayerTable.tsx) and [TeamSlotsTable](components/breakiq/TeamSlotsTable.tsx) — only when a ranked prospect is actually in view, so rosters without prospects stay clean. Tooltip reworded to "Prospect rank #N…". Display-only; tier colors still mirror `PROSPECT_RANK_TIERS`.

## 2026-06-17 — Fix: `/break-price` crash when the `product` option is typed, not selected

`/break-price` with a pinned product failed hard with `invalid input syntax for type uuid: "2026 2025-26 Topps Chrome Cactus Jack Basketball"` (`products=0`, "pinned product not in active set"). Root cause: Discord's `product` autocomplete sends the product **UUID** as the option value *only when the user picks a suggestion*. If they type the name and press Enter without selecting, Discord sends the raw typed string (which matches the autocomplete label `${year} ${name}`). `parseBreakPrice` used that string in `.eq('id', productId)` → Postgres rejected the non-UUID and the whole parse died.

Fix in [lib/insights-parser.ts](lib/insights-parser.ts): only `.eq('id', …)` when the pin is a real UUID; otherwise treat it as a typed product name and resolve it against the active set (normalized label / name substring match), scoping to the matches and falling through to the full set so Claude can still infer if nothing matches. `parseBreakPriceJson` gets the same fallback (`resolveProduct(productId)` when the id isn't a row match). No more hard crash on a free-typed pin. (Separately: a 169-row sheet like this still exceeds the inline LLM parse's practical row ceiling — use the structured `.json` upload for full coverage; this fix just stops the pin from crashing.)

## 2026-06-17 — `/break-price` proposals attach a full-list `.md` when truncated

Discord caps a message at 2000 chars, so a large `/break-price` proposal (e.g. an 88-row sheet) showed only the first ~14 rows + "… and 74 more (full list applies on ✅)". The ✅ always applied the complete staged set — the cutoff was cosmetic — but approving 74 unseen rows blind is a real verification gap (did every team/player resolve to the right DB object?).

Now, whenever the inline preview truncates (`formatProposalSummary` returns `hiddenCount > 0`), the bot attaches **`proposed-updates.md`** — a Markdown table of EVERY staged row with its resolved DB targets: `kind`, product (+ `product_id`), scope, the resolved team / player name, `target_id` (player_id), composition, price, source. The reviewer scans the whole list before clicking ✅. New `editInteractionResponseWithAttachment()` in [lib/discord.ts](lib/discord.ts) (multipart — `discordFetch` forces JSON), `buildProposalMarkdown()` in [lib/tracked-source-proposal.ts](lib/tracked-source-proposal.ts), and a `postProposalReply()` helper in [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) wired into all three break-price reply paths (JSON upload, slash vision/tabular, message context-menu). Inline preview unchanged when nothing's hidden. Verification-only — no change to what ✅ applies. (The `/insight` + refine paths reuse the same helper if extended later.)

## 2026-06-16 — Prospect pricing: Track A activation + pre-release base EV floor (Bowman)

Kyle flagged that Bowman products have no "rookies" in the MLB sense — every player is a prospect — so the rookie-weighted model systematically underweighted headline Bowman 1st / Chrome / Draft cards. Track A (prospect-rank → weight bump) was ~95% built but inert: the engine reads `players.prospect_rank`, which was never populated (the MLB Pipeline scraper wrote a separate `prospect_rankings` time-series table; the two lanes never connected). This wires them together, adds a rank-tiered base EV floor for thin-data pre-release cards, and puts both behind one kill switch.

- **Importer dual-write** ([lib/prospect-rankings-import.ts](lib/prospect-rankings-import.ts)) — after the `prospect_rankings` insert, dual-writes `players.prospect_rank` / `_source` / `_updated_at` for each matched row (`prospect_status` untouched — institutional importer owns it; cross-importer conflict = most-recent-write-wins).
- **Kill switch** — new server-only [lib/feature-flags.ts](lib/feature-flags.ts) `isFeatureFlagEnabled()` (60s TTL cache). Gated at the async call sites ([lib/break-page-data.ts](lib/break-page-data.ts), [lib/analysis.ts](lib/analysis.ts)) so `computeProspectAdjustment` stays sync; off → `prospect_score_adj = 0` → WhyThisPriceCard's Track A row hides. `feature_flags.prospect_rank_enabled` toggles BOTH the weight-share bump AND the base EV floor.
- **Rank-tiered base EV floor** — new [lib/pre-release-base-ev.ts](lib/pre-release-base-ev.ts) `computeFallbackBaseEV()` (top-10 $80 / #11–30 $50 / #31–100 $25 / in-Bowman-unranked $15 / legacy $15/$8), Bowman-scoped. Track A bumps weight *share*; this sets base *value* before the share math so a #1 prospect floors at ~$80 not ~$24. Swapped the `$15/$8` fallbacks in [lib/pricing-refresh.ts](lib/pricing-refresh.ts) + [lib/analysis.ts](lib/analysis.ts) (added `product_line`/`prospect_rank` to the refresh selects). **Floor numbers are calibrated guesses — tune via Market Delta Watch.**
- **Visual rank chip** — new [components/breakiq/ds/ProspectRankChip.tsx](components/breakiq/ds/ProspectRankChip.tsx) (`#7`, tier-colored, tooltip with source/date), next to the `RC` badge in PlayerTable / TeamSlotsTable / PlayerDetailDrawer (3 fields threaded through [/api/player-comps](app/api/player-comps/route.ts)). **Independent of the flag** — rank is a fact; the flag only controls pricing.

No new schema (columns + flag row pre-existed). **Rollout (operational):** deploy flag-OFF (no change) → backfill `players.prospect_rank` from `prospect_rankings` (one-shot SQL, ~40 baseball players) → verify chips + no pricing change → flip the flag (outward-facing Bowman pricing change) → watch Market Delta Watch. Plan + rationale: [docs/plans/2026-06-16-prospect-pricing-track-a.md](docs/plans/2026-06-16-prospect-pricing-track-a.md). Concept C "1st Bowman" detection deferred. Only baseball activates (only sport with `prospect_rankings` data); other sports stay null → legacy behavior.

## 2026-06-16 — `/break-price` structured JSON upload (deterministic, no-LLM escape hatch)

The durable answer to the large-sheet timeout class. The inline `/break-price` parser runs an LLM whose output is bounded by tokens + the 300s function cap, so past ~90 rows it can't finish (streaming in #199 raised the ceiling but didn't remove it). New path: upload a **`.json` file of slot asks** and BreakIQ ingests it **deterministically — no LLM call** — resolving names→ids against the active roster. Instant, unbounded by row count.

New `parseBreakPriceJson()` in [lib/insights-parser.ts](lib/insights-parser.ts): accepts a bare array or `{ product?, source?, source_note?, rows: [...] }`, each row keyed by **names** (`team`/`player`/`name`, `price` or `price_low`+`price_high`, `format`/`composition`). Product resolves from the pinned `product` option → doc `product` → per-row `product` (normalized-exact then unique-substring); teams/players resolve against that product's roster; **ambiguous/unmatched rows are dropped with a reason, never guessed**. Emits the same `asking_price` `ParsedUpdate[]` as `parseBreakPrice`, so staging + the ✅/❌ apply flow are unchanged. [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) `handleBreakPrice` branches on `.json` before the markdown/vision flow and posts an **Apply/Discard** proposal (no Refine — that re-runs the LLM, N/A for a deterministic upload). The existing `.xlsx/.xls/.csv` + Google-Sheets-URL tabular path (LLM) is unchanged.

Producer workflow: run a messy/huge capture through Claude offline (no time limit) → emit the schema → upload; or hand-build/export for clean sheets. Schema + workflow: [docs/break-price-structured-upload.md](docs/break-price-structured-upload.md). Operational: re-run `node scripts/register-discord-commands.mjs` (the `file` option description now mentions `.json`; no schema change to the command itself). Keeps inline screenshots for quick small/medium captures; this is the fallback for big-or-failed ones.

## 2026-06-16 — Fix: `/break-price` timeout on large price sheets (stream the vision parse)

`/break-price` failed with "⚠️ Parser error: Request timed out" on a **75-row** price sheet (full team + player slot list). The #197 fix (maxDuration 300 + 60s timeout) stopped the *hard* kills but exposed the real ceiling: each output row is a verbose ~120-160 token JSON object (full `product_id`, `product_name`, `source_note`, …), so 75 rows ≈ **11-15K output tokens** — which both **overflowed `max_tokens: 8192`** (truncated array) and **took ~150s to generate**, blowing the 60s timeout. With the SDK's default 2 retries, the call burned ~36s thrashing on a request it could never finish in time.

Fix in [lib/insights-parser.ts](lib/insights-parser.ts): the heavy paths (`parseBreakPrice`, and the image/web branch of `parseInsights`) now **stream** the Anthropic call (`messages.stream(...).finalMessage()`) — streaming holds the connection open through a long generation instead of tripping a single-request read timeout — with **`max_tokens: 16000`** (fits ~90 rows) and **`{ timeout: 220_000, maxRetries: 0 }`** (one generous attempt; a 220s call retried even once would overrun the route's 300s `maxDuration`). Text-only `/insight` keeps the fast non-streaming path (2048 / 25s) — unchanged. The downstream truncation-salvage still recovers parseable rows if an even-larger sheet exceeds 16K.

Follow-up (not done): genuinely huge sheets (>~90 rows) still bound by `max_tokens`/time — durable answer is a leaner per-row output schema (factor out the constant product_id/name, drop source_note) or chunked parsing of tabular exports. Noted for when it bites.

## 2026-06-09 — Parser: Topps Chrome × Cactus Jack (bare-ratio odds dialect) + re-import + product line

Admin "BreakIQ Insights Debrief" showed **"No players found for this product"** on the new 2025-26 Topps Chrome × Cactus Jack Basketball, despite the roster existing. Root cause was the checklist parser choking on this product's format (a cousin of the Motif bug), which cascaded into **all 141 player_products flagged `insert_only = true`** (the debrief filters to `insert_only = false`). Three distinct quirks, all fixed in [lib/checklist-parser.ts](lib/checklist-parser.ts):

1. **Bare-ratio odds on every parallel label** — `"White (1:7)"`, `"Cactus Jack Refractor (1:184)"`. The Motif fix (#194) only recognized *keyword*-led parens (`(Hobby - …)`), so these failed `isParallelLabel`, leaked into the section name, and overwrote the real `Base Set` header. `PAREN_ODDS_PARALLEL_RE` extended with a bare-ratio `(1:N)` alternative.
2. **Ratio-led odds lines** — `"1:208 packs"`, `"1:8 packs"` (section pull rates on their own line) were becoming garbage sections. `BARE_ODDS_RE` extended to skip `N:N packs` lines.
3. **Leading-space sheet name** — the base sheet ships as `" Base"`; used as the fallback section name it failed `isBaseSectionName`'s `^Base` anchor → every base player flagged `insert_only`. Now the sheet name is trimmed before the skip check and section-name use.

Combined, the base-section header was destroyed → base detection failed → no slot-eligible players. After the fix: parsing yields 8 clean sections / 338 cards / 0 odds-named sections / 0 odds-in-variant-names; the `Base` section's 100 numeric cards register as base.

Operational repair (prod): deleted the 2,070 garbage variants for the product and re-imported the clean parse (parsed locally with the fixed parser, POSTed to the import route) → **3,370 clean variants, base players 0 → 100, 41 insert-only** (autographs/inserts). Debrief now finds the roster.

New manufacturer-rules doc [docs/manufacturer-rules/topps-cactus-jack.md](docs/manufacturer-rules/topps-cactus-jack.md) (sibling of topps-motif.md) and new product line **`topps_cactus_jack`** ("Topps Cactus Jack") in [lib/product-lines.ts](lib/product-lines.ts).

## 2026-06-09 — Fix: `/break-price` "application did not respond" (Sonnet vision timeout × retries)

Discord `/break-price` (and image `/insight`) started failing with "The application did not respond" / stuck "BreakIQ is thinking…". Root cause was the **Sonnet 4.6 upgrade (2026-06-05) colliding with the retry math**: the Anthropic client runs the default 2 retries, the vision parse had a 30s per-attempt timeout (tuned for Haiku), and the Discord function was `maxDuration = 60`. Sonnet 4.6 vision on dense multi-screenshot price sheets exceeds 30s, so the first attempt timed out → SDK retried → the ≤3-attempt chain overran 60s → the function was hard-killed mid-flight ("Vercel Runtime Timeout Error" in the logs at the exact failure timestamps), so the deferred reply never landed. Text-only `/insight` was unaffected (fast, no vision), which is why only screenshot captures broke.

Fix: [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) `maxDuration` 60 → **300** (the sync ACK still returns in <1s; the `after()` block now has room for the parse + bounded retries), and [lib/insights-parser.ts](lib/insights-parser.ts) raised the vision/web-source Anthropic call timeout 30s → **60s** in both `parseInsights` and `parseBreakPrice` so Sonnet completes on the first attempt instead of triggering the retry storm. Text-only calls stay at 25s. No model rollback — keeps the Sonnet accuracy win from #192.

## 2026-06-08 — Catalog pagination drift fix + Chrome Football full re-hydrate

**Symptom (via River / CardHedger):** "2025 Topps Chrome Football total cards was way low." Investigation showed the product was the *only* active product still on the legacy parse→match path (0% `ch-native`) — its checklist file carries no chrome parallels (those come from CH-catalog hydration, like every other product), and it was never hydrated because its CH catalog wasn't matched until the June 4 re-match. Result: 5,022 variants (1% parallels, base + photo-variations only) + 1,720 duplicate rows, EV built without the refractor/colored ladder where the chase value lives.

**Re-hydrated** Chrome Football from the now-complete CH catalog via `hydrateVariantsFromCatalog` → **36,970 `ch-native` variants, all 73 parallels, pre-matched**, then refreshed pricing (399/400 players live). River's flag resolved.

**Root-cause bug caught mid-hydrate:** [lib/cardhedger-catalog.ts](lib/cardhedger-catalog.ts) `loadCatalogIndex` paginated `ch_set_cache` with `.range()` but **no `.order()`** — PostgREST returns rows in undefined heap order that drifts across page boundaries, so on a 37K-row set the first hydrate produced **exactly 1,000 duplicate card_ids AND ~1,000 silently-missing cards** (36,970 rows / 35,970 distinct). Football's heap order had just been churned by the re-match, making the drift acute. **This affected every hydrate and every catalog match** that builds the in-memory index. Fix (PR [#195](https://github.com/brodotype-dev/breakerz/pull/195)): `.order('card_id', { ascending: true })` (unique per set → deterministic paging) + a defensive de-dup by `card_id` when building `index.cards`. Re-hydrate against the fixed code → 36,970 rows = 36,970 distinct, 0 dups, 0 missing. **Heads-up:** Chrome Football slot prices shifted — they now reflect the full parallel ladder instead of base-only (the correct number).

## 2026-06-08 — Topps Motif Basketball: re-import with clean parser (odds matching unblocked)

`/admin/products/<motif>` odds import showed **0 matched / 127 unmatched**. Root cause: the Motif checklist was imported *before* the parenthetical-odds parser fix (2026-06-07, PR #194) deployed, so every variant name had the pack odds glued in (`"Platinum (Hobby - 1:436; FDI - 1:291)"`, `"Hobby - 1:17; FDI - 1:11"`, the malformed `"Platinum (Hobby - 1:949; FDI - 1:633"`). The odds matcher scores by token overlap, so those tokenize into odds digits and score ~0 against any odds subset → nothing matched. The roster (players) imported fine, masking it.

Fix (operational, no code): deleted the 769 garbage variants (scoped to the one product; players/player_products untouched), re-imported the checklist via the now-live fixed parser → **4,676 clean variants** (`Base`, `Pastel Pink`, `Quin Gold`, … `Platinum` + autograph sections). Odds now match (re-run odds import in the UI). Known coarseness: pure base-autograph odds rows (`"Motif Rookie Relic Autographs"` with no color) can stay unmatched because the importer names a card's no-parallel row `"Base"` rather than the section name — pre-existing, affects all products, not the Motif bug. Motif remains a CardHedger catalog gap (pre-release, display-only) until CH adds the set.

## 2026-06-07 — Checklist parser: Topps Motif / Beckett parenthetical-odds parallel dialect

Topps Motif Basketball imported as garbage — ~15 odds-named sections (`"Platinum (Hobby - 1:157; FDI - 1:157)"`) instead of real subset titles. Root cause: Motif is the same Beckett multi-sheet XLSX the generic `parseChecklistXlsx` already walks, but each parallel label carries its pack odds glued on (`"Platinum (Hobby - 1:157; FDI - 1:157)"`, `"Pastel Pink (No odds given)"`). Those failed `isParallelLabel()`, fell through to "new section header," and clobbered the real subset title.

Fix is **format-general**, not Motif-hardcoded — any Topps/Beckett checklist with odds-in-parallel-labels now routes through it automatically, no new detection branch, no migration. New constants/helper in [lib/checklist-parser.ts](lib/checklist-parser.ts): `PAREN_ODDS_PARALLEL_RE` + `parenOddsParallelName()` recognize `(Hobby…/FDI…/Retail…/Jumbo…/No odds given)` parentheticals and strip the odds to the clean parallel name; `BARE_ODDS_RE` skips standalone odds rows as metadata. The closing `)` is **optional** because the Motif source file ships at least one malformed line missing it (`"Platinum (Hobby - 1:949; FDI - 1:633"`) — otherwise that line leaks as a section and steals its subset's cards (`Still Life Signatures`).

Made it a first-class, reusable capability (per Brody — Motif will be a common product): new manufacturer-rules doc [docs/manufacturer-rules/topps-motif.md](docs/manufacturer-rules/topps-motif.md) (mirrors bowman/panini/upper-deck) + asserting regression test [scripts/verify-motif-parser.mjs](scripts/verify-motif-parser.mjs) (`npx tsx scripts/verify-motif-parser.mjs`). **Verified against the real 2025-26 Topps Motif Basketball file: 15 garbage → 23 real subset sections, 769 cards, 0 stray, parallels captured incl. trailing `Platinum`.** ⚠️ CardHedger catalog gap — checklist imports clean, but CH matching is blocked until CH adds the set (ask for River).

## 2026-06-05 — Model upgrade: Haiku 4.5 → Sonnet 4.6 across the board + central registry

Re-evaluated our Claude usage now that the lineup has moved (Haiku 4.5 $1/$5 · Sonnet 4.6 $3/$15 · Opus 4.8 $5/$25 per MTok). The model id was hardcoded in 9 files (8 on Haiku 4.5, 1 already on Sonnet 4.6). New [lib/models.ts](lib/models.ts) is the single registry — semantic keys (`matcher`, `cardMatch`, `verdict`, `extract`, `configurator`) so a future upgrade/rollback or per-task tiering is one edit. All call-sites now route through it and are standardized on **Sonnet 4.6**: Discord `/insight` + `/break-price` matching ([lib/insights-parser.ts](lib/insights-parser.ts)), CH hard-case matching ([lib/cardhedger.ts](lib/cardhedger.ts)), break-analysis verdict ([lib/analysis.ts](lib/analysis.ts)), slab/cert + editorial + bets-debrief extraction. Driver: the Haiku associative-substitution errors on long rosters (Russell Wilson → Sam Darnold) — a stronger model makes that class far rarer at the source, so the warning/auto-correct/self-correct-parse layers become backstops rather than load-bearing. Cost delta is immaterial at our volume; Brody's call was to prioritize confidence over the ~3× per-call cost. Opus left unused (overkill for extraction/matching). Prompt caching considered + deferred (it was a cost lever; cost isn't the constraint). Thinking stays off (plain `messages.create`), so response shapes are unchanged.

## 2026-06-05 — `/insight`: parse the model's self-corrected JSON (multi-block / prose-interleaved)

Real root cause of the Russell Wilson failure, caught from the raw response: the prompt rule actually *worked* — Haiku emitted a Sam Darnold block, then prose ("Wait… Russell Wilson IS in the roster"), then a **corrected second `json` block with Russell Wilson**. But `parseInsights` parsed `raw` with a brittle greedy `raw.match(/\[[\s\S]*\]/)` + `JSON.parse`, which spanned both arrays + the interleaved prose and threw "Unexpected non-whitespace character after JSON" → `parsedRaw=0` → "couldn't extract." Two fixes in [lib/insights-parser.ts](lib/insights-parser.ts): (1) `parseInsights` now uses the robust `salvageJsonArrayObjects` walker (same as `parseBreakPrice`) instead of regex+`JSON.parse`; (2) `salvageJsonArrayObjects` takes the **last** fenced block, not the first — so a self-corrected response yields the model's final answer (Russell Wilson), not its first attempt. Verified on the exact two-block response → extracts Russell Wilson. With the parse fixed, yesterday's auto-correct re-resolution is the backstop for any residual mis-bind.

## 2026-06-05 — `/insight`: auto-correct wrong-player matches from the contributor's text

The soft mismatch warning (2026-06-04) correctly flagged "Russel Wilson retired → Sam Darnold" but didn't fix it — the model kept binding Darnold despite the prompt rule, and Refine round-trips through the same flaky model (one returned `parsedRaw=0`). New **structural auto-correct** in [lib/insights-parser.ts](lib/insights-parser.ts): when the model-bound player's name isn't in the contributor's text AND **exactly one** roster player is *strongly* present (surname **and** first name, fuzzy/accent-tolerant via new `nameStronglyInText`), re-bind `player_id` to that player at parse time — no model or refine dependency. "Russel Wilson retired" now binds **Russell Wilson** with a `↻ re-matched` note; surname-only/ambiguous text ("Wilson retired") still falls back to the soft warning (never guesses). Applies to `risk_flag` + `sentiment` (the player-id-bound kinds). Verified against an ambiguity roster (Russell/Garrett/Tyson Wilson). Since the original parse now self-corrects, Refine isn't needed for this class.

## 2026-06-04 — Fix: `/admin/data-health` statement timeout (57014) + additions panel moved/collapsible

`/admin/data-health` started 500ing with Postgres `57014` (statement timeout) after the re-match roughly doubled some products' matched card sets — and a 500ing admin RSC blocks Next.js navigation, which read as "the whole site is slow." Root cause: `getCHCoverageForActiveProducts` built each product's rollup with a per-product fan-out (distinct-card scan + a chunked `ch_price_cache` loop of ~`cards/200` round-trips + a `pricing_cache` fetch), all in parallel across active products. **Fix:** new `get_ch_coverage(product_id, cutoff)` SQL function (migration [20260604140000_ch_coverage_rpc.sql](supabase/migrations/20260604140000_ch_coverage_rpc.sql)) collapses the whole rollup into one aggregate query per product — **MATERIALIZED** CTEs (the multi-referenced `cache`/`pc` CTEs were being re-executed 5× each) + a new `player_products(product_id)` index. Heaviest product (Chrome Football) went **2.4s → ~104ms warm** (was timing out). [lib/ch-coverage.ts](lib/ch-coverage.ts) `buildOneRow` now calls the RPC; `getCHCoverageForActiveProducts` uses `Promise.allSettled` so one bad product can't 500 the page; the old chunked helper is deleted. Also per Brody's QA: the **CardHedger Additions panel moved below the coverage table and is now collapsible** (native `<details>`, default collapsed, with a "⚡ N tracked" chip in the summary when CH added to a set we track). Function is admin-only (`REVOKE EXECUTE`, pinned `search_path`, `NOTIFY pgrst` — gotchas #10/#12).

## 2026-06-04 — CardHedger additions feed on Data Health (release-calendar proxy + re-match signal)

River pointed us at CH's `/v1/cards/additions-summary` as the closest thing to a release calendar (what CH adds daily, t-1). New nightly cron [/api/cron/refresh-ch-additions](app/api/cron/refresh-ch-additions/route.ts) (02:30 UTC, before the catalog refresh) pulls a 4-day window and upserts into a new `ch_additions` table (migration [20260604120000_ch_additions.sql](supabase/migrations/20260604120000_ch_additions.sql), admin-only grants, idempotent on `(added_date, set_name, subset)` so a missed night self-heals). New [getAdditionsSummary](lib/cardhedger.ts) wrapper. `/admin/data-health` gains a **CardHedger Additions** panel ([CHAdditionsPanel.tsx](app/admin/data-health/CHAdditionsPanel.tsx), data via `getRecentCHAdditions` in [lib/ch-coverage.ts](lib/ch-coverage.ts)) showing the last 14 days of additions, and — the actionable bit — **flags additions to sets we already track** (`set_name` matches an active product's `ch_set_name`) as a re-match signal ("⚡ N cards added to sets you track → re-run matching"). Pairs with the same-day re-match enabler (#186): CH adds → panel flags → we re-match.

## 2026-06-04 — match-cardhedger: accept cron-secret bearer (drive re-matching after CH card-match changes)

CardHedger (River) shipped significant card-match changes and asked us to rerun non-matches. Our matcher runs a local tier-ladder against the cached CH catalog (`ch_set_cache`), and validation showed **98.6%** of Topps Chrome Football's 2,523 unmatched variants have a card number present in the fresh catalog — i.e. re-running matching is high-yield (≈50% → ≈99% for that product; ~13K unmatched variants across active products). [match-cardhedger](app/api/admin/match-cardhedger/route.ts) now accepts `Authorization: Bearer <CRON_SECRET>` in addition to admin-cookie auth (same pattern as `refresh-product-pricing`), so re-matching can be driven by a script/cron rather than only the admin UI. No behavior change to the matching itself — it still only touches unmatched (`cardhedger_card_id IS NULL`) variants, so it can add matches but never break existing ones.

## 2026-06-04 — Discord `/break-price`: same wrong-player warning for player-row asks

Extends the `/insight` mismatch guard to `parseBreakPrice` ([lib/insights-parser.ts](lib/insights-parser.ts)). Player/variant-scope asks now carry the soft `match_warning` (via the shared `matchedNameMissingFromText`) when the bound player's name isn't in the text we can read. Because `/break-price` is screenshot/sheet-first, the check runs only when the evidence is text-checkable — a tabular sheet (`tabularText`) is present, OR there's no image — so pure-screenshot rows (where the name lives in pixels) never false-warn. Compared against `tabularText + narrative + notes`. Also now resolves `scope_player_name` from the roster on emission, so the proposal shows the player's name instead of "player slot". Renders via the same `summarizeUpdate` path on the ✅/✏️/❌ panel.

## 2026-06-04 — Discord `/insight`: warn on wrong-player matches (name not in your text)

A `/insight` of "Russel Wilson retired" proposed a retirement flag on **Sam Darnold** — the model semantically substituted the *current* Seahawks QB for the *former* one, returning a self-consistent wrong `player_id`/`player_name` (so the existing id↔name check couldn't catch it). Russell Wilson was in the roster; this was a confident mis-match, not a missing-roster bug.

New structural guard in [lib/insights-parser.ts](lib/insights-parser.ts): `matchedNameMissingFromText(playerName, text)` flags a sentiment/risk_flag update when **none** of the bound player's name tokens appear (fuzzily) in the contributor's narrative. It's a **soft warning, never a drop** — a hard reject would false-fire on nicknames ("Wemby") and misspellings ("Russel") the model resolved correctly. Fuzzy (edit-distance ≤1, accent-folded) token matching keeps it quiet on those; empty text (screenshot-only) skips the check. The warning (`⚠️ "Sam Darnold" isn't in your text — double-check…`) renders on the proposal via `summarizeUpdate`, so it shows on the existing ✅/✏️/❌ panel. Plus a prompt rule explicitly forbidding role/team/succession substitution (don't bind the current player at a position when the text names a former one). Verified by [scripts/verify-match-warning.ts](scripts/verify-match-warning.ts).

## 2026-06-03 — Import hardening: stop junk player rows at the source (normalize + reject)

Root-cause fix behind the `/admin/players` junk. The checklist import created a `players` row for *every* parsed name and only flagged junk `insert_only` — quarantined, never prevented — so card-number-prefixed names (`1 Jacob Wilson`), section/description headers (`BASEBALL STARS AUTOGRAPHS`), stray numbers, and subset codes all accumulated as fake players. Two shared guards now run at the aggregation chokepoint (`computePlayerAggregates` in [lib/checklist-aggregates.ts](lib/checklist-aggregates.ts), which both the client `playersOverride` path and the server use), plus the matching variant loop in [app/api/admin/import-checklist/route.ts](app/api/admin/import-checklist/route.ts):

- **`normalizePlayerName`** strips a glued leading card-number prefix (`1 Jacob Wilson` → `Jacob Wilson`, merging with the real player) + trademark symbols. Conservative — only a pure leading number is stripped.
- **`isNonPlayerName`** rejects rows that aren't people — pure numbers, subset codes (`isCardSubsetCode`), and all-caps multi-word headers/descriptions — so they never become rows. Legit multi-player slash cards (`Skubal / Blanco / Valdez`) are explicitly NOT rejected (caller still keeps them `insert_only`).

Verified by [scripts/verify-name-guards.ts](scripts/verify-name-guards.ts) (`npx tsx`, 26 cases: real names untouched, prefixes stripped, every junk shape rejected, multi-player preserved). Prevents recurrence; existing quarantined rows were cleaned separately. Deferred enhancement: recover the real player for subset-code rows that carry the name in the team column (swap), instead of dropping the card.

## 2026-06-03 — `/admin/players`: hide card-code junk rows + widen subset-code matcher

The new global players directory surfaced ~2,900 garbage `players` rows where a card-subset code is the name and the real player sits in the team column (`90CAS-DO` / team `David Ortiz`). Investigation: these are NOT new pollution — **every one is already `insert_only` everywhere** (quarantined from team math, parser rosters, and consumer pages; the prior #111/#113 cleanup did its job). Only the new admin page showed them because it lists raw rows regardless of `insert_only`. Net live impact: 1 row (`B25-ÉP`, accented É, on an inactive product).

Three fixes: (1) new `looksLikeRealPlayerName()` in [lib/checklist-aggregates.ts](lib/checklist-aggregates.ts) — a real name has a space or a lowercase letter; card codes / stray card numbers / accented codes have neither — applied to [/api/admin/players/search](app/api/admin/players/search/route.ts) so the directory hides them. (2) Widened `CARD_SUBSET_CODE_RE` from `{1,5}-{1,6}` to `{1,6}-{1,8}` so the parser roster filter catches 6-char-prefix subsets (`MLMDA2-…`, `HLAR2-…`) that were slipping through. (3) **Physically deleted** the quarantined junk: [migration `20260603120000_delete_junk_player_rows.sql`](supabase/migrations/20260603120000_delete_junk_player_rows.sql) (applied to prod via MCP) removed **2,892** player rows whose name is code-like AND every player_product is insert-only — cascade cleared 2,264 pps / 941 variants / 268 pricing rows, 0 orphans, real players + curated attributes untouched. Pre-verified 0 references in chase list / chase cards / breaks / observations / flags. Reversible: rows archived to `archive_junk_players_20260603` + `archive_junk_player_products_20260603` (admin-only). The one live edge case (`B25-ÉP`, non-insert pp on an inactive product) was intentionally excluded by the predicate.

## 2026-06-02 — `/admin/players`: Sport / Product / Rookie filters + click-to-expand products

Follow-up UX on the global players directory. (1) **Filters** — a Sport dropdown, a Product dropdown (active products), and a Rookies Y/N selector, alongside the existing name search. Any combination ANDs together and browses the full catalog (not just the managed set); the managed set is still the default empty-state view. (2) **Click a player name** → inline expansion listing every product that player is in, with year, sport, lifecycle badge (Live / Pre-release / Dormant), inactive + insert-only tags. Lazy-loaded + cached per player.

Implementation: [/api/admin/players/search](app/api/admin/players/search/route.ts) extended from name-only to a unified `q` / `sport` / `productId` / `rookie` query (inner-join on `player_products` for the product filter, `sport_id` + `is_rookie` eq filters, deduped, with a truncation sentinel — capped at 300, narrow to see more). New [/api/admin/players/[playerId]/products](app/api/admin/players/%5BplayerId%5D/products/route.ts) backs the expansion. [GlobalPlayersManager](app/admin/players/GlobalPlayersManager.tsx) gains the filter controls, a `filterActive` fetch path (debounced), and the expandable product sub-row; [page.tsx](app/admin/players/page.tsx) loads the sport + product dropdown options and threads `is_rookie` onto managed rows (with an RC chip). Admin-only via middleware; no schema change.

## 2026-06-02 — Fix: `/break-price` player-scoped asks (inject the roster into the prompt)

A `/break-price` capture of a Wemby Bowman Sapphire eBay auction ($1,275) parsed perfectly but got dropped: **`scope_player_id not in roster: victor-wembanyama`**. Root cause: `parseBreakPrice` ([lib/insights-parser.ts](lib/insights-parser.ts)) loaded the player roster *only* to validate Claude's output (`playerById`) but **never injected those names + ids into the prompt** — unlike `parseInsights`, which does. So for any player-scoped ask, Claude was told "use the matched roster id" with no roster in front of it, fabricated a slugified id (`victor-wembanyama`), and validation at line ~1438 dropped it. This is why player-row asks had effectively never worked (the code comment even called them "rare"); team-scoped asks were unaffected because team names aren't validated against a roster.

**Fix:** inject the roster (`- Name (Team) [id: uuid]`) into the `parseBreakPrice` prompt with an explicit "use the EXACT id, never invent/slugify/guess" instruction, mirroring `parseInsights`. When the product is pinned via Discord autocomplete, the roster is scoped to just that product's players (lean prompt, exact candidates); unpinned captures fall back to the full active-product roster. Verified against prod data: Wemby (`7776119d-…`) is in the active Sapphire roster, so the capture that failed will now resolve. No Discord command schema change → no registrar re-run; prompt-only fix, same ✅/❌ confirm flow.
## 2026-06-02 — Players-as-global re-model (HV + risk flags → player) + global `/admin/players` directory

Brody noticed there was no way to manage player attributes platform-wide — you edited icon / high-volatility / risk flags **inside a product**, but those describe the *player*, not the card-in-a-product. Framing: *cards of players are product-specific, players as players are global.* An injury / suspension / volatile market follows the athlete across every product. So **HV and risk flags move to the player**; **B-score stays product-scoped** (sentiment genuinely varies by product). Icon was already global, just lacked a global edit surface.

Validating finding: the Discord `/insight` apply path already fanned each risk flag out to every one of a player's `player_products` — **63 rows collapsing to 14 logical flags across 13 players**. The re-model removes that redundancy rather than adding a concept.

**Schema (phase 1 — additive, applied to prod):** `supabase/migrations/20260602120000_players_global_attributes.sql` adds `players.is_high_volatility` (backfilled from any-product HV) + `player_risk_flags.player_id` FK (backfilled from the product join; `player_product_id` made nullable; new indexes). Invisible to old code. A **phase-2 cleanup migration** (`20260602130000_…_cleanup.sql`) is written but **NOT applied** — it deletes the 49 redundant fan-out rows + drops the legacy columns and is **deploy-gated** (running it under old code would strip flags from a player's other products).

**Read sites → player-global** (HV off the `players` join; flags by `player_id` with defensive dedup): `lib/pricing-read.ts`, `lib/team-fair-value.ts`, `lib/analysis.ts` (riskAdjMap still ppId-keyed via player→pp projection), `lib/break-page-data.ts` (projects back onto ppId so the client's keyed records are unchanged), `lib/chase.ts` (simplified — it already did a pp→player workaround), `app/api/player-profile/route.ts` (dropped now-meaningless per-flag product attribution). `lib/types.ts`: `Player.is_high_volatility` is the new source of truth; `PlayerProduct.is_high_volatility` marked legacy; `PlayerRiskFlag` gains `player_id`.

**Write paths:** new `app/admin/players/actions.ts` (icon / HV / add-flag / clear-flag, all keyed by `player_id`); product-scoped versions removed from `app/admin/products/actions.ts`. Discord risk_flag apply collapses the fan-out loop to a single insert by `player_id`.

**New global directory:** `/admin/players` ([page.tsx](app/admin/players/page.tsx) server-loads only the "managed" set since the players table exceeds PostgREST's 1k cap; [GlobalPlayersManager.tsx](app/admin/players/GlobalPlayersManager.tsx) adds debounced search + per-player icon/HV toggles + flag add/clear; [/api/admin/players/search](app/api/admin/players/search/route.ts) is the admin-gated rich search). Nav entry added. The per-product players page (`app/admin/products/[id]/players/`) loses its icon/HV/flag controls (now a read-only roster with a link to the global directory); B-score / bets stay there.

Build clean. Full plan + post-deploy verification checklist + the deploy-ordering caveat: [docs/plans/2026-06-02-players-global-attributes.md](docs/plans/2026-06-02-players-global-attributes.md).

## 2026-06-01 — My Breaks V2 · Solidity Pass (verdict render + honest stats + edit/delete)

Three scoped fixes to make the **My Breaks** consumer surface feel solid. No schema migration — all client + API-route changes. Branch `feat/my-breaks-v2-solid` off `origin/main`. Plan: [docs/plans/2026-05-30-my-breaks-v2-handoff.md](./docs/plans/2026-05-30-my-breaks-v2-handoff.md).

**1. Show the verdict in New Break.** The New Break flow ran `runBreakAnalysis`, saved the snapshot, then immediately called `onSaved()` and navigated away — the computed verdict was thrown on the floor despite the copy promising "a live analysis." `BreakForm.handleSubmit` ([app/(consumer)/my-breaks/page.tsx](<./app/(consumer)/my-breaks/page.tsx>)) now gates on `mode === 'new'` success: stores the returned `AnalysisResult`, renders `<AnalysisResultPanel>` inline (with a "Saved to My Breaks" header + "Done — back to My Breaks" button that calls `onSaved()`). The break is already saved `pending`, so it's a pure render switch. `productSlug` omitted so the panel hides its self-link. `log` mode behavior unchanged.

**2. Honest stats.** `computeStats` extended with two descriptive, sample-size-guarded measures alongside the existing Breaks / Total Spent / W·M·B record: **Avg vs Fair** = mean of `(ask − snapshot_fair_value) / snapshot_fair_value` across non-abandoned breaks carrying a usable fair-value snapshot → rendered "Over Fair +14%" (red) / "Under Fair −8%" (green) with an "across N breaks" sub-label; **Signal Mix** = count of BUY·WATCH·PASS our model flagged at log time, "of N rated." Both show `—` + "no snapshots" when the sample is empty. Stat block widened to a wrapping `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`.

**3. Edit / delete a break.** New `PATCH` + `DELETE` on [app/api/my-breaks/[id]/route.ts](<./app/api/my-breaks/[id]/route.ts>), both scoped by resolved `user_id` through the service-role client (no DELETE RLS policy exists on `user_breaks`). `PATCH` accepts `ask_price` / `platform` / `platform_other` / `outcome` / `outcome_notes`; when `ask_price` changes it recomputes `snapshot_value_pct` + `snapshot_signal` from the *stored* pure `snapshot_fair_value` via `computeSignal` (no CH/Claude call). Accepted caveat: that recompute references pure fair value while the original signal was judged against the market-adjusted number — internally consistent, slightly different from origin. UI: shared `CardActions` (pencil + trash with a two-click delete confirm, all `stopPropagation` so the pending card's click-to-expand isn't triggered) + shared `BreakEditForm` (ask price + platform always; outcome + notes for completed breaks) wired into both `PendingBreakCard` and `CompletedBreakCard`. New collapsed **"Passed on"** drawer lists abandoned breaks (delete-only) — they're excluded from every stat, so they live in a quiet section.

---

## 2026-05-30 — Per-player PYP prediction on `/break/[slug]` (fair-value EV model + P(zero hits))

Adds a **PYP** (Pick Your Player) column to the player table on `/break/[slug]`, predicting what a breaker would charge to pre-pick that player's slot in the user's currently-configured break. Built on a fair-value expected-value foundation so the number is interpretable as a buyer's break-even price, not a breaker's logistical case-cost split.

**Math (lib/player-pyp-pricing.ts):**

```
For a hobby case of H boxes:
  E[$ from player p in this case] = H × Σ_p_variants(EV_v × 1/odds_per_box_v)
                                  = H × hobbyEVPerBox_p
For C cases:
  fair_pyp_p   = C × H × hobbyEVPerBox_p
  market_pyp_p = fair_pyp_p × MARKET_MARKUP_BY_LIFECYCLE(lifecycle)
```

`H` (boxes per case) is derived as `products.hobby_autos_per_case / Σ_all_variants(1/hobby_odds_per_box)` — the existing-but-previously-unused `hobby_autos_per_case` column is repurposed as the per-case anchor, no schema change. Same `MARKET_MARKUP_BY_LIFECYCLE` (1.40 pre-release / 1.20 live / 1.05 dormant) the team-slot display layer already uses, so PYP and the team-slot model use the same lifecycle markup contract.

**Why fair-value and not case-cost-share** (initial v1 took the wrong path and was rewritten before shipping): a PYP slot is a financial instrument — the buyer pays now and receives a random payoff in pulls. Fair price = expected dollar value of those pulls. The case-cost-share formula (`hobbyBreakCost × player_weight / total_weight`) conflates the breaker's economic break-even ("I need to recoup case cost × markup") with the buyer's expected value, and the two diverge for any product that isn't a sell-out PYP. Fair-value math gives a coherent baseline that captured `/break-price` PYP asks can be deltaed against.

**The lottery signal (P(zero hits) chip):** each row also renders a Poisson `P(0) = e^(-λ)` chip where `λ = expected pulls of this player across the configured break`. Color-coded: green (<25% chance of no hit, near-certainty), orange (25–50%, real lottery), red (≥50%, half-or-more chance of nothing). Tooltip explains "buyers often pay above fair value for the upside on low-λ slots." This is the variance honesty the model owes the user — a $1,500 slot with a 60% no-hit chance is a very different bet than a $1,500 slot with a 5% no-hit chance.

**Column rendering is gated.** New per-call coverage check (`oddsCoverageOk`): the PYP column only appears when ≥30% of priced players have at least one variant with `hobby_odds`. Panini and similar odds-less products skip it cleanly — no degenerate "every player has equal share" math leaks through. Per-product hobby_autos_per_case must be set; we default to existing `16` for products without an explicit value.

**v1 scope:** hobby only. BD / jumbo PYP rare in practice; will extend once `/break-price` captures reveal demand.

**Data plumbing:** `lib/break-page-data.ts` adds a sixth parallel query loading per-variant `hobby_odds` keyed by `player_product_id` (uses an inner-join filter on `product_id` to sidestep gotcha #11's 200-UUID `.in()` cap). `BreakPageClient` recomputes `computePlayerPyp(rawPlayers, variantsMap, config, hobby_autos_per_case, lifecycle)` reactively on every break-config change — same pattern as `computeSlotPricing`.

**Two BACKLOG entries surfaced and recorded** while building this:

- **P0 — PYT (team-slot) math: audit + rebuild on fair-value EV foundation.** The existing `computeSlotPricing` in `lib/engine.ts` uses the same case-cost-share formula this rewrite specifically moved away from. The critique that drove PYP to fair-value applies equally to PYT. Worth aligning both pricing paths on one mathematical foundation; capture Market Delta state before the rewrite to A/B old vs. new model against the same captured asks. See `docs/BACKLOG.md` for the full plan, rollout shape, and pre-flight cautions.
- **P1 — Variance-aware refinements (post fair-value foundation).** Two deferred-from-v1 items: (a) risk-premium markup that grows with `1/λ` (low-pull-rate slots trade above fair value in practice; we'll tune α from `/break-price` capture deltas once they accumulate), and (b) a "carve out as PYP" toggle per player that excludes them from the team-slot denominator and re-prices both — captures Kyle's hybrid-break pattern ("separate out rookies + big players, make them their own spot"). Both refinements are materially easier with both paths on fair-value EV; don't tune from constants in a vacuum.

**Admin Market Delta player-scope Δ column deferred to a one-day follow-up PR** to keep this one scoped. `/break-price` PYP captures will start accumulating against the model immediately; the admin Δ surface is the validation loop and lands next.

---

## 2026-05-29 — Consumer sign-in (`/auth/signin`) + waitlist link repurposed

Caught testing the end-to-end signup flow: once you finish creating an account there's no door back into the app from `getbreakiq.com`. The waitlist had a single "Already have an invite? Create your account →" link pointing to `/auth/signup`, which without an invite code returns an error page. And the in-product fallback (the "Sign in →" button on the signup page's "this invite was already used" error state) pointed to `/auth/signin` — **a route that didn't exist**, so even the existing escape hatch was a 404.

**Fix — three pieces:**

- **New [/auth/signin](app/auth/signin/page.tsx) + [SigninForm](app/auth/signin/SigninForm.tsx)** — Google + Discord OAuth alongside an email **magic link** (`supabase.auth.signInWithOtp` with `shouldCreateUser: false` so a fat-fingered email can't silently mint a new auth user, which would then trip the callback's invite gate). No invite-code requirement, no legal-acceptance checkbox (returning user already accepted at signup; the callback honors their existing acceptance untouched). Footer links back to the waitlist for users who don't have an account yet.
- **New shared [components/auth/OAuthButtons.tsx](components/auth/OAuthButtons.tsx)** — the Google + Discord buttons (with their SVG icons) extracted out of [SignupForm](app/auth/signup/SignupForm.tsx), now consumed by both signup and signin so the two pages can't drift visually. Signup wires `onBeforeRedirect={guardAccepted}` so the legal-checkbox gate is preserved exactly as before. Props take a `getRedirectTo: () => string` callback so the `window.location.origin` lookup happens lazily inside click handlers — earlier `redirectTo: string` shape crashed `/auth/signin`'s static prerender with `ReferenceError: window is not defined`.
- **Waitlist link repurposed** — `"Already have an invite? Create your account →"` → `"Already have an account? Sign in →"` pointing to the new route. The old "create your account" path is dead weight now that every new invite is a unique URL embedded in the approval email — anyone clicking the link without an invite code was hitting an error anyway.

**Callback unchanged**: [/auth/callback](app/auth/callback/route.ts) already skipped the invite-code gate for returning users (line 73's `isNewProfile` check), so signin via the new page round-trips cleanly without needing `invite_code` / `accept_terms` / `accept_privacy` params on the redirect URL. New-user-without-profile hitting signin gets bounced to `/waitlist?error=missing_invite` — correct.

**Admin login stays separate** at `/admin/login` — different mechanism (email + password) and intentionally not advertised on the marketing surface.

---

## 2026-05-29 — `/break-price` accepts price sheets (Google Sheets / .xlsx / .csv) + extracts team AND player rows

Two related improvements from a Bowman Sapphire testing session:

**Use case 1 — team + player extraction in one capture.** Sending two screenshots to `/break-price` — one with team-bucket prices, one with per-player prices — was returning only the team rows. The parser already supported `scope_type='player'`, but `parseBreakPrice`'s prompt rules were team-biased (all examples and the "one row per slot ask" wording defaulted to team thinking). Added an explicit rule that **team rows AND player rows are both slot asks** and must be extracted from the same capture, with concrete patterns for player-row name extraction (`"Cooper Flagg, Dallas Mavericks (RC) (AUTOS) $2400"` → `scope_type='player'`, name = `"Cooper Flagg"`, ignore parentheticals, match to active-product roster). New rule also names the multi-player insert / generic bucket rows that should be **skipped** (`yz*UNLISTED ACC(7 PLAYER AUTOS)`, `z*UNLISTED Chicago Bulls (Autos)`, totals, blanks) so they don't pollute observations.

**Use case 2 — tabular price-sheet ingestion.** A breaker's canonical price artifact is a Google Sheet or .xlsx with team buckets + per-player rows + PYT (Pick Your Team / Price You Trade) and PYP (Pick Your Player / Price You Pay) columns. New optional `url` and `file` options on `/break-price` (and the same on `Capture break-price` message context menu, which now also detects Sheets links in message content + xlsx/csv attachments on the target post). The handler converts:

- **Google Sheets URL** → public **xlsx** export (`/export?format=xlsx`) — the whole workbook in one fetch, so the same parser handles uploaded files AND Sheets URLs. No OAuth; sheet must be shared "anyone with the link." Clear contributor-actionable error on 401/403/404.
- **.xlsx / .xls / .csv attachment** → parsed with the `xlsx` lib we already ship for checklist imports.

**Multi-tab aware** ([lib/tabular-extract.ts](lib/tabular-extract.ts)): both paths iterate every sheet in the workbook, classify each by a numeric-density heuristic, and **drop tabs that don't look like price sheets** (mostly prose, few $-shaped numbers — e.g. a Bowman Sapphire sheet's `NOTES *NBA*` / `NOTES *NCAA*` tabs get skipped while `PYT PRICE` / `PYP PRICE` survive). Surviving tabs concat into one markdown blob with `## <tab name>` headers so Claude can tell which rows came from PYT vs PYP (and use the tab name as a strong hint for both row-scope and which column is the asking price). Caps: 400 rows × 12 cols per tab, 60 K total chars across all tabs. If no tab passes the heuristic the handler short-circuits with a friendly "didn't have any tabs that look like a price sheet" message (with the list of skipped tab names). The prompt activates a price-sheet section when present, with rules for identifying the PYP column (prefer player-specific column for player rows; team-specific column for team buckets; fall back to the only price column when only one is present). Same `asking_price` observation rows out, same ✅/✏️/❌ staging — no schema change.

**Why not just route notes tabs through `parseInsights`?** Same separation we enforce for editorial scraping (Slice 3): a competitor breaker's notes shouldn't auto-import as our SME's sentiment / breakerz_score read. If those notes turn out to be valuable, the right move is `/insight` from the SME's own voice. Deferred.

**Restriction on the URL option:** Google Sheets only. Generic web URLs route through `/url-source` (different workflow — recurring cadence + parseInsights). Clear error message on non-Sheets URLs.

**Other minor caveats:**
- File precedence > URL when both supplied.
- Refine on tabular captures doesn't yet re-fetch + re-parse the source (URL stored in `source_text`, xlsx in `source_attachments` via Discord CDN's 24h window) — kept the refine branch unchanged this round; that's a one-line addition we can do once we see how the captures actually flow.

**Files:** new [lib/google-sheets.ts](lib/google-sheets.ts), new [lib/tabular-extract.ts](lib/tabular-extract.ts), [lib/insights-parser.ts](lib/insights-parser.ts) (BreakPriceInput + prompt), [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) (both handlers), [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) (two new options).

**Operational:** re-run `register-discord-commands.mjs` after deploy so the new `url`/`file` options appear on `/break-price` in Discord. The Capture break-price message context menu didn't change schema, so it'll work without re-registration once code deploys.

**Open follow-up surfaced by this work (not in this PR):** we don't have a per-player PYP prediction in the engine yet. Team-slot PYP-equivalent exists (TeamSlotsTable × lifecycle market-markup), but per-player PYP needs `EV × expected_hits_per_break × markup` where `expected_hits_per_break = cases_in_break / hobby_odds(player)`. All inputs exist (`pricing_cache.ev_*`, `player_product_variants.hobby_odds`, `lib/market-markup.ts`); the wiring doesn't. Slated as the immediate next slice so the PYP observations this PR captures have a model number to delta against.

---

## 2026-05-29 — "Capture url-source" message context-menu (long-press → track a link)

Adds a long-press / right-click → Apps → **"Capture url-source"** entry alongside the existing "Capture insight" / "Capture break-price" context-menu commands, so an SME can track a link someone dropped in `#breakiq-insights` without retyping it into the slash command. The handler ([app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)) pulls the first http(s) URL out of the target message and opens a **modal** for cadence + stop_after — context-menu commands can't carry option dropdowns, and Discord modals support only text inputs, so the two fields are typed (pre-filled with `weekly` / `3_months`, validated on submit with forgiving normalization so `one off` / `3-months` resolve correctly). The URL rides through the modal as a pre-filled, editable field since modal submits don't re-resolve the target message. New `extractFirstUrl()` helper.

Both entry points (the `/url-source` slash command and this context menu → modal) now converge on a shared `captureUrlSource()` extracted from the old `handleUrlSource` body — record the source, first scrape, stage the proposal, reply — so the recurring-cron path, the slash path, and the context-menu path all behave identically. Modal submits are routed by `custom_id` (`url_source_modal` → new handler, `refine_modal:*` → refine). No schema change. **Operational: re-run `register-discord-commands.mjs` after deploy** so the new context-menu entry appears (the only schema-changing command this round).

---

## 2026-05-28 — Discord proposal buttons clear reliably on apply/discard (incl. after refine)

Long-standing annoyance: clicking ✅ Apply or ❌ Discard on an `/insight` / `/break-price` / `/url-source` proposal **after it had been refined** applied the update to the DB but left the buttons live — click ✅ again and you'd get the "That insight was already applied" ephemeral. PR #114 (2026-05-17) thought it fixed this by switching the post-hoc message edit from the interaction webhook (`@original`) to `editChannelMessage` (channel API by message id), but it kept failing on refined-message lineage.

**Root cause:** both the apply/discard resolution AND the refine re-render relied on a *post-hoc* edit of a message that a prior interaction had already touched. That edit is the unreliable step — `@original` is flaky across interaction lineages, and `editChannelMessage` flakes on refined messages too. So the buttons (which only get removed by that edit) stuck around.

**Fix ([app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)):** strip the buttons in the **immediate interaction response** (`UPDATE_MESSAGE`, type 7) instead of a post-hoc edit. Updating the component's *own* message via the interaction response is the one mechanism Discord guarantees, regardless of how the message was previously edited. Discard flips status inline (fast, deterministic) and resolves in the response. Apply shows an optimistic "✅ Applied" in the response (buttons gone instantly), then runs `applyUpdates` in `after()` and refines the text to the precise "N of M committed" via `editInteractionResponse` first (this interaction's `@original` is now reliably the message it just updated) with an `editChannelMessage` fallback — both best-effort, since the buttons are already cleared. New `appendResolution()` helper clamps the resolution line to Discord's 2000-char cap so a near-full proposal body can't overflow and fail the `UPDATE_MESSAGE` response (which would re-introduce the stuck-buttons bug). No schema/registration change.

---

## 2026-05-28 — Web-sourced intel arc: Track A prospect rankings + editorial + open-ended URL ingestion (11 PRs, #159–#169)

Fills the non-CardHedger data gap. Two unmet needs drove it: (1) pre-release hype was model-output, not editorial reality; (2) the Track A prospect-attribute layer was designed in the 2026-05-12 plan but never fed. Solution: scrape the open web, admin-curated like `/insight`, reusing existing sinks (`market_observations`, `pending_insights`, the ✅/✏️/❌ proposal flow).

**Everything shipped this arc is feature-flag-gated or admin-only — nothing touches the pricing engine or consumer pricing yet.** Engine activation is Slice 6 (not started), held behind `feature_flags.prospect_rank_enabled` (seeded `false`) for shadow-mode-first rollout.

Full handoff with resume steps: [docs/plans/2026-05-28-web-sourced-intel-handoff.md](docs/plans/2026-05-28-web-sourced-intel-handoff.md).

### Three ingestion shapes

- **Track A / Bucket B structured** — dedicated scrapers (MLB Pipeline first) write objective rankings to `prospect_rankings`; material moves get endorsed into observations.
- **Bucket A editorial (Shape 1)** — per-product `editorial_urls`, admin-curated, scraped on demand into product/team/player-scope `market_observations`. No Discord.
- **Open-ended (Shape 2)** — `/url-source` Discord command: any URL + cadence + stop_after → `tracked_sources` → scrape → `pending_insights` proposal. First scrape now; recurring cron is Slice 4b (not started).

### Slice 1 — `prospect_rankings` + MLB Pipeline scraper — PR [#159](https://github.com/brodotype-dev/breakerz/pull/159)

Operationalizes the prospect-rank layer the 2026-05-12 plan designed but never built — scraping MLB Pipeline instead of CSV imports. **Direct-write architecture** (rank position is objective fact, so scraped rankings write straight to `prospect_rankings` — no Discord proposal). Migration `20260528094702_prospect_rankings.sql` (applied to prod): time-series table (one row per player/source/scrape), composite indexes for the Slice 2 "most recent per (player, source)" diff query, admin-only per gotcha #12 (RLS enabled, no policies, `REVOKE ALL FROM anon, authenticated`), `feature_flags.prospect_rank_enabled` seeded `false`. `lib/scrapers/mlb-pipeline.ts` (Firecrawl JSON extract, `waxstat.ts` singleton pattern, Zod→JSON schema, no plain-fetch fallback). `lib/prospect-rankings-import.ts` (normalized name-match — lowercase, strip accents/suffixes/punctuation — against the baseball roster of players with ≥1 player_product; unmatched dropped + reported; chunked inserts at 200). `app/api/admin/scrape-mlb-pipeline/route.ts` + baseball-only `ScrapeMlbPipelineButton`. **Verified on prod: 100 scraped, 76 matched.**

### Slice 1 fixes — PRs [#160](https://github.com/brodotype-dev/breakerz/pull/160), [#161](https://github.com/brodotype-dev/breakerz/pull/161), [#162](https://github.com/brodotype-dev/breakerz/pull/162), [#163](https://github.com/brodotype-dev/breakerz/pull/163)

- **#160** — the scrape button crashed the whole admin page with **React error #31**. Root cause: a long-running scrape can hit a Vercel **platform** error (timeout/500) whose JSON body shapes `error` as an **object** (`{code, message, …}`), not the plain string our route returns; rendering that object as a React child threw, and with no error boundary the Next.js global overlay replaced the document. Fix: new `errText()` helper coerces any error shape to a renderable string + guard `res.json()` against non-JSON bodies.
- **#161** — the MLB Pipeline URL was the hub page (`/prospects` → 5 featured players), not the ranked table (`/prospects/stats/top-prospects` → 100). Plus an `errText` sweep onto `RefreshCatalogButton` + `HydrateVariantsButton` (same latent footgun).
- **#162** — the ranked page lists some players in two sections (risers highlight + main table), so the raw scrape contained 12 dupes within one `captured_at`, breaking the "one rank per player per scrape" invariant. Importer now dedupes per player, keeping best rank.
- **#163** — surface the unmatched prospect names (not just the count) in an expandable `<details>` so name-normalization misses are distinguishable from genuinely-not-carried prospects. Codified **CLAUDE.md gotcha #13** (the `errText` convention).

### Slice 2a — prospect rank diff engine + admin movers report — PR [#164](https://github.com/brodotype-dev/breakerz/pull/164)

`lib/prospect-rankings-diff.ts`: `computeProspectDiff()` compares the latest scrape against the most-recent prior. Material = a move of ≥ `PROSPECT_RANK_MATERIAL_DELTA` (3) spots, a new entry, or a drop-off. First-ever scrape returns empty (baseline only, no flood). `describeMove()` renders the one-liner (`"Jesus Made ↑12 (#13→#1) on MLB Pipeline"`). Button shows risers/fallers/new/dropped counts. Report-only; no engine change. **Not yet exercised — needs two scrapes with a rank change.**

### Slice 2b — endorse moves as `prospect_rank_move` observations — PR [#165](https://github.com/brodotype-dev/breakerz/pull/165)

Inline web approval turns admin-endorsed material moves into player-scoped `prospect_rank_move` `market_observations`. **Stored as a dedicated observation type — deliberately NOT `breakerz_score`** (that's Track B SME sentiment; writing rank-derived Track A values there would conflate the two tracks the moat keeps separate AND get clobbered by the next `/insight`, whose apply path SETS not increments) **and NOT `players.prospect_rank`** (would fire the engine's existing `computeProspectAdjustment` immediately, bypassing the Slice-6 shadow gate). Migration `20260528123742_prospect_rank_move_observation.sql` (CHECK-only, applied to prod). Scrape route returns structured moves; `POST /api/admin/apply-prospect-moves` writes selected moves with full attribution + 45d TTL, per-player supersede, `.in()` chunked at 200. Button renders a pre-checked checklist with "Endorse N signals". **Endorse UI untested on real movers.**

### Slice 3 — editorial URL scraping (Bucket A) — PR [#166](https://github.com/brodotype-dev/breakerz/pull/166)

Admin-curated editorial/content URLs per product (Beckett product news, Topps blog, break previews), scraped on demand into `market_observations`. No Discord proposal — the admin who set the URLs is the gate. Migration `20260528155434_products_editorial_urls.sql`: `products.editorial_urls text[]` (consumer-readable products, no grant change). `lib/scrapers/editorial.ts`: content-agnostic Firecrawl **markdown** scrape (12k-char cap, no plain-fetch fallback). `lib/editorial-parser.ts`: roster-aware Haiku extract that **emits ONLY market-observation kinds** (`product_sentiment`/`team_sentiment`/`team_product_sentiment`/`hype_tag`) — never `breakerz_score` sentiment, never prices (same track-separation principle as #3 above). `lib/editorial-import.ts`: per-URL scrape→parse→supersede-prior→write, rows tagged `source_user_id='system:editorial'`, per-URL error isolation. `POST/PUT /api/admin/products/[id]/editorial-refresh` + `EditorialPanel`. Consumer surfacing works for free — `PreReleaseLayout` + `WhyThisPriceCard` + verdict-context already read product-scope observations. **NOT prod-verified — needs a real Beckett scrape.**

### Slice 4a — `tracked_sources` + `/url-source` command — PR [#167](https://github.com/brodotype-dev/breakerz/pull/167)

Open-ended URL ingestion (Shape 2). An allowlisted SME runs `/url-source` with a URL + cadence + stop_after; we record the source and run the first scrape immediately, staging a `pending_insights` proposal via the existing flow. Migration `20260528160519_tracked_sources.sql` (admin-only, index on `(status, next_scrape_at)` for the cron's due-check). `lib/tracked-sources.ts` (`computeStopAt`/`computeNextScrapeAt`/`isOneShot`). `/url-source` registered with cadence + stop_after dropdowns (5 commands total now). `handleUrlSource` (allowlist + URL validation, insert, first scrape via `scrapeEditorial` → `parseInsights`, stage `source_kind='tracked_source_scrape'`) + a refine branch. One-shot sources fully functional now; recurring fires once Slice 4b ships. **Tested vs a Substack homepage → `[]` (thin homepage, expected).**

**Constraint hotfix (post-4b, migration `20260528180000_pending_insights_tracked_source_kind.sql`):** #167 staged with `source_kind='tracked_source_scrape'` but never extended the `pending_insights_source_kind_check` CHECK past `'insight'`/`'break_price'`. The Slice 4a Substack test returned zero updates so the insert never fired and the gap stayed hidden; the first real multi-update `/url-source` parse (a ripped.topps.com Bowman article, 11 updates) hit the constraint at stage time (`new row … violates check constraint`). Added the third value. DB-only fix — live on prod immediately, no redeploy needed to unblock staging.

**Proposal readability — player-scope updates now show the player name.** That same 11-update parse rendered as 10 anonymous `player: release_premium` rows because `summarizeUpdate` only had `'player'` as the label for player-scope `hype_tag` / `asking_price` / `odds_observation` — the parser carried `scope_player_id` but no name, so reviewers couldn't see *who* a hype bump targeted. Added an optional `scope_player_name` to those three `ParsedUpdate` kinds, populated from the in-memory `playerById` roster at validation time (zero extra cost — the validator already looks the id up), and rendered it (`Ethan Holliday: release_premium (strength 0.85, decay 30d)`). Display-only — the apply path keys on `scope_player_id`, so it's non-breaking and affects every proposal surface (`/insight`, `/break-price`, `/url-source`). Already-staged rows stay anonymous in their posted message but still apply correctly; re-run to see names.

### Web-source parse mode — PRs [#168](https://github.com/brodotype-dev/breakerz/pull/168), [#169](https://github.com/brodotype-dev/breakerz/pull/169)

- **#168** — new `ParseInput.webSource` flag. `/url-source` targets long, multi-topic web content but was reusing `parseInsights`' terse-SME framing + 2048-token cap, which under-extracts from dense pages. Web-source mode swaps the prompt intro ("extract EVERY distinct grounded signal across many players/teams/products; ignore nav/ads/boilerplate; don't stop after the first few") and raises `max_tokens` 2048 → 8192 (timeout 25s → 30s). Two-tier roster + all 8 kinds + validation unchanged. `handleUrlSource` + the refine branch pass `webSource: true`. **Not yet validated on a content-rich URL.**
- **#169** — when `/url-source`'s first scrape extracts nothing, the reply now shows `scraped=<N> chars` + a "Scraped (first 400)" block, so "thin/paywalled page" is distinguishable from "parser too conservative" instead of guessed.

### Slice 4b — recurring tracked-sources cron

Completes the open-ended ingestion shape: recurring `/url-source` rows now re-scrape on their cadence and post a fresh ✅/✏️/❌ proposal to the channel they were submitted from. Migration `20260528170000_tracked_sources_channel_id.sql` adds `tracked_sources.discord_channel_id` (nullable, applied to prod) — Slice 4a stored the source but not where it was submitted; `handleUrlSource` now populates it from `interaction.channel_id`. New `createChannelMessage()` in [lib/discord.ts](lib/discord.ts) (bot-token POST, the cron has no interaction to reply to). The scrape→parse→stage→build-proposal logic was extracted from `handleUrlSource` into [lib/tracked-source-proposal.ts](lib/tracked-source-proposal.ts) `scrapeAndStageProposal()` so the command reply and the cron share one path (the two pure proposal helpers `formatProposalSummary` / `buildTargetsHeader` moved there too; the route re-imports them — −141 lines net in the route). New [app/api/cron/refresh-tracked-sources/route.ts](app/api/cron/refresh-tracked-sources/route.ts): selects `status='active' AND next_scrape_at <= now()` (capped 40/run, serial for Firecrawl rate limits); per row — retire if past `stop_at`, skip + back off legacy rows with a null channel, else scrape → `parseInsights({webSource:true})` → stage `pending_insights` → `createChannelMessage` → advance `next_scrape_at` (flip `status='done'` if the next firing would pass `stop_at`). No-updates scrapes advance silently so a recurring feed with nothing new doesn't spam the channel nightly; errors record `last_error` + back off. `recordCronStart`/`recordCronRun` markers for the admin Cron Status panel. `vercel.json` entry at `0 8 * * *` (after the pricing/dormant crons clear). **No Discord re-registration needed** — the `/url-source` schema didn't change. Owed prod verification: a recurring source + an actual cron firing.

### Decisions locked

1. Slice 1 raw rankings write **direct** (no Discord) — rank is objective fact.
2. `PROSPECT_RANK_MATERIAL_DELTA = 3` — moves of ≥3 spots / new entries / drop-offs are material.
3. Endorsed moves → dedicated `prospect_rank_move` observation (not `breakerz_score`, not `players.prospect_rank`).
4. Editorial emits **only** market-observation kinds — never sentiment, never prices.
5. **X/Twitter feeds deferred** — Firecrawl can't reliably scrape x.com in 2026 (anti-bot); WaxMetrix-style feeds need a dedicated X API (twitterapi.io / Apify) — own spike, not started.
6. Substack — homepages are thin; target individual post URLs or `/feed`.

### Not done (resume order in the handoff doc)

- **Slice 5** — more structured prospect sources (ESPN NBA Big Board, NHL Central Scouting, NPB signees).
- **Slice 6** — engine activation + resolving the **two-lane Track-A overlap**: `players.prospect_rank` → `computeProspectAdjustment` (called unconditionally in `lib/break-page-data.ts`, but the column is unpopulated) vs. the new `prospect_rankings` table (read by nothing). Must consolidate to one lane, gated behind `prospect_rank_enabled`, shadow-mode first.
- **Surface `prospect_rank_move`** in consumer views (this player-scoped type isn't read yet; editorial product-scope obs surface for free).

### Untestable locally

Firecrawl's MCP token is dead in this dev env; prod's `FIRECRAWL_API_KEY` runs the real scrapes. Every scraper needed prod iteration (MLB Pipeline took 4 follow-ups). Slice 3 editorial + `/url-source` content-rich extraction still owe prod verification.

---

## 2026-05-27 — Data API hardening (preempting Supabase's Oct 30 default flip)

Triggered by Supabase's 2026-05-26 email announcing that on **Oct 30, 2026**, new `public` tables in existing projects will no longer be auto-exposed to the Data API unless explicitly `GRANT`ed. While auditing exposure, the Security Advisor surfaced three pre-existing WARN-level findings worth fixing now — separate from the email but related to the same theme.

**Fixes shipped in [migration `20260527140000_data_api_hardening.sql`](supabase/migrations/20260527140000_data_api_hardening.sql):**

1. **🔴 Real bug — `upsert_ch_price_cache_preserving_nulls` was publicly callable.** This `SECURITY DEFINER` function (added 2026-05-20) lacked a `REVOKE`, so PostgreSQL's default `EXECUTE TO PUBLIC` left it callable by anyone with the anon API key via `POST /rest/v1/rpc/upsert_ch_price_cache_preserving_nulls`. The function is meant to be called only by `lib/pricing-refresh.ts` (which uses service role and bypasses GRANTs anyway). Anyone could have injected pricing rows by hand. Fix: `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` + pin `search_path = public, pg_temp` to prevent search-path hijacking on the SECURITY DEFINER body.

2. **🟡 Data API surface reduction.** Seven admin-only tables (`breakerz_sentiment_history`, `ch_set_cache`, `ch_set_refresh_log`, `cron_run_log`, `discord_contributors`, `feature_flags`, `pending_insights`) plus the unused-but-not-yet-dropped `kv_store_bb185425` had RLS enabled with no policies — clients couldn't read/write rows, but the tables were still listed in `/rest/v1/`. Verified every access in app code uses `supabaseAdmin` (service role), so `REVOKE ALL FROM anon, authenticated` is safe and closes unnecessary attack surface.

3. **🟡 CLAUDE.md gotcha #12.** New "Data API exposure is a per-table decision" gotcha with a 4-pattern decision table (consumer-read RLS-gated / consumer-write RLS-gated / public-form unauth submit / admin-only). Future migrations have a clear template to follow before Oct 30 hits.

**What this isn't:** the Oct 30 deadline isn't an emergency for us. Existing tables keep working unchanged. This PR is preemptive — it (a) fixes the real public-RPC bug found during the audit and (b) updates our migration playbook so we don't create a broken table after Oct 30 by accident.

**Out of scope (Brody handles via dashboard):** enable HaveIBeenPwned leaked-password protection in Supabase Auth settings. Free toggle.

**Open question for future cleanup:** `kv_store_bb185425` contains 2 rows of legacy JSON from the pre-relational-schema prototype era (`products` + `teamSlots:...` keys). Zero code refs. Likely safe to `DROP TABLE` entirely, but skipped from this migration since "REVOKE on the 8 admin-only tables" was what was authorized; full drop is deferred pending an explicit teardown decision.

---

## 2026-05-26 → 2026-05-27 — `/insight` screenshots arc (5 PRs)

Brings `/insight` to full parity with `/break-price` for image capture, plus a wider RISK_FLAG roster so we can flag events for players who aren't on a current Bowman checklist. Original ship was PR [#145](https://github.com/brodotype-dev/breakerz/pull/145), followed by four real-time-discovered fixes during live testing the same evening.

### Initial ship — PR [#145](https://github.com/brodotype-dev/breakerz/pull/145)

- **`/insight` slash command** — `narrative` is now optional; new optional `screenshot` / `screenshot2..5` attachment slots + `notes` string. At-least-one of narrative / screenshot enforced server-side (Discord schema can't express it). Mirrors `/break-price` exactly.
- **New `Capture insight` MESSAGE context-menu command** — long-press / right-click any Discord message → Apps → "Capture insight" pulls every image attachment (soft cap 5) and runs them + the message text through `parseInsights` as one batch. Same allowlist, same staging, same ✅/✏️/❌ proposal flow.
- **`parseInsights`** — `ParseInput` extended with optional `images: BreakPriceImage[]` + `notes`. When images present, the Claude call switches to image content blocks (Haiku 4.5 vision), `max_tokens` bumped to 8192 (vision responses run wider — same reason `parseBreakPrice` runs at 8192). Text-only `/insight` calls byte-for-byte unchanged in cost + behavior.
- **Refine flow** — `kind === 'insight'` branch in `handleRefineModalSubmit` re-fetches `source_attachments` CDN URLs (24h window) and re-sends to `parseInsights` alongside the correction. Mirror of the break-price refine path.
- **Image fetch hardening reused** — Same `sniffImageMediaType` magic-byte path + 5 MB per-image cap + `VALID_IMAGE_TYPES` set as `/break-price`. Trust bytes not Discord's content_type (iOS routinely mis-labels PNGs as JPEGs).

### Discord description length fix — PR [#146](https://github.com/brodotype-dev/breakerz/pull/146)

#145 set the `/insight` narrative description to 116 chars. Discord caps option descriptions at 100 and rejects the bulk PUT with `BASE_TYPE_BAD_LENGTH` 50035. Found during the post-deploy `register-discord-commands.mjs` run — only 3 of 4 commands were registering. Trimmed the description to 84 chars (dropped the second example phrase from the registration script).

### RISK_FLAG leading-indicator rule — PR [#147](https://github.com/brodotype-dev/breakerz/pull/147)

First live screenshot test (Josh Jacobs arrest news article) returned `[]` with scratch reasoning explaining *"no sports card market context, pricing, sentiment, or product mention"*. The model was correctly applying the prompt as written — but the prompt was wrong for risk_flag specifically. Risk flags exist to capture events BEFORE the market reacts (see `lib/score-modulation.ts`: legal −0.40, off_field −0.25, retirement −0.80, etc.). Waiting for observable market signal forfeits the whole timing advantage. Added an explicit "LEADING INDICATORS" clause to the RISK_FLAG rule and retuned the screenshots-section opener so news articles / event reports are explicitly named as valid inputs.

### Empty-narrative rendering bug + RISK_FLAG emit-by-default — PR [#148](https://github.com/brodotype-dev/breakerz/pull/148)

After #147 deployed, Josh Jacobs STILL returned `[]` (this time silently, no scratch reasoning). Root cause was a rendering bug introduced by #145 that was only exposed once screenshot-only calls became routine: when narrative was empty, `parseInsights` was rendering `Narrative:\n"""\n(no narrative — see screenshots)\n"""` — putting the placeholder string INSIDE the triple-quoted narrative block. The model was reading that placeholder as the actual narrative content and returning `[]` because the string carried no signal. `parseBreakPrice` had a clean conditional that drops the entire `Narrative:` block when empty; `parseInsights` didn't. Mirrored the pattern, plus added a CRITICAL-section RISK_FLAG EMIT-BY-DEFAULT rule with a concrete Josh Jacobs example as the template. **This was the actual root cause.** #147 alone wasn't enough.

### Two-tier roster for RISK_FLAG — PR [#149](https://github.com/brodotype-dev/breakerz/pull/149)

Brandon Marsh (Phillies OF) injury screenshot couldn't get a risk_flag because he isn't in any active Bowman product. Active-product-only roster scope (PR #142) was the right call to fix the Wemby cap bug for SENTIMENT / ASKING_PRICE / etc. — but too narrow for RISK_FLAG, which is a leading indicator we want to capture even for players whose cards aren't currently in rotation. New two-tier roster: default-tier (~2,900 active-product players, valid for every kind) + `*risk-only` tier (filling remaining `maxPlayers` budget with any-product players, valid for RISK_FLAG only). Total capped at 5000 with primary filling first so no Wemby regression. Prompt explains the marker; RISK_FLAG rule extended with ROSTER SCOPE clause.

### Files touched across the arc

- [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) — screenshot slots, `Capture insight` MESSAGE command, description-length fix
- [lib/insights-parser.ts](lib/insights-parser.ts) — `ParseInput.images` + `notes`, two-tier roster, RISK_FLAG carve-out, screenshot prompt section, empty-narrative rendering fix
- [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) — `handleInsight` extracted from inline dispatcher, new `handleInsightFromMessage`, refine flow re-fetches insight attachments

### Operational

Re-ran `scripts/register-discord-commands.mjs` against the prod guild after #146 deployed — 4 commands now registered (`/insight`, `/break-price`, `Capture break-price`, `Capture insight`). Force-quit + reopen Discord on mobile to pick up the new schema.

### Lessons logged

1. **Discord option descriptions cap at 100 chars** — easy to forget when example narratives feel too short
2. **When mirroring a prompt-handling pattern across parsers, mirror the empty-state path too** — #145's prompt template inherited from a text-only world and broke on the new screenshot-only path
3. **Prompt-only fixes for "model returned []" need to verify the model's scratch reasoning shows the new rule firing** — #147 was correct in intent but invisible in effect because #145's rendering bug was eating the input upstream

---

## 2026-05-26 — FMV `price_explanation` surfaced in player drawer tooltips

River's 2026-05-23/24 FMV revamp added a per-row `price_explanation` field — human-readable narrative of how each price was derived. We pipe it through to the player drawer as a native browser tooltip on every per-grade cell. Hover any price → see CH's full derivation in plain English.

**Examples of what now shows on hover:**
- *"Used 7d FMV ($2.29, Winsorized median of 7 daily prints) in place of latest_price $1.70. Fresh (0d) — no movement adjustment applied."*
- *"Estimated PSA 10 from the Raw price ($2.29, 0d old), translated Raw→PSA 10 via Raw multiplier (×11.07)."*
- *"Estimated PSA 9 from the 2026|Baseball segment baseline ($27.29 at reference grade PSA 9), used directly — no grade adjustment applied. Stale (365d) → applied the player-level movement index for Jacob Wilson -45.4% — damped to 75% of the raw -55.4% move (10,534 samples, τ-damped)."*

**Plumbing.** `CardFmvResult` + raw row type gain `price_explanation` (lib/cardhedger.ts); `app/api/player-comps/route.ts` captures it in per-card priceMap; `VariantWithPrices.prices[]` extends with the optional field (lib/types.ts); `PlayerDetailDrawer.tsx` per-grade `<td>`s get a `title=` attribute composed from grade + method + explanation. Cursor becomes `help` so the affordance is discoverable. Legend updated.

**Why not also persist into `ch_price_cache`?** FMV is called live on every drawer open already, so the explanation flows through without persistence. A future PR can ingest into the cache if we want to surface explanations on slot pricing / audit-trail card / other surfaces.

**Why not also swap the slot-pricing engine to FMV?** Today's 500-card at-scale re-experiment showed drift vs `batch-price-estimate` narrowed from ~18% (May 20 baseline) to ~7% on PSA 9/10. The bias persists, so we're not swapping yet. This PR is the trust + transparency layer that makes admins comfortable comparing both prices side-by-side until we ground-truth them against actual sales.

PR [#143](https://github.com/brodotype-dev/breakerz/pull/143).

---

## 2026-05-26 — Insights parser: roster scope + refine = authoritative + nickname rules

Three coordinated fixes for the Discord `/insight` + `/break-price` parsers after a real Wemby-misattribution incident this morning (3+ refines kept landing on the wrong player — Luka Doncic, Alex Sarr, Cooper Flagg).

**Root cause (the real one, found via `pending_insights.parsed_updates` inspection):** the roster query pulled `from('players')` unfiltered, alphabetically ordered, capped at 5,000. The players table has grown to 6,666 solo entries (legends accumulated from historical product imports). **Victor Wembanyama (V/W region) was getting cut off below the cap.** Cooper Flagg (C), Alex Sarr (A), Luka (L) all survived. The model semantically extracted "Wemby" → "Wembanyama" in its freeform `note` field but couldn't find a roster match, so fell back to picking an alphabetically-earlier auto-eligible basketball rookie that was in its slice.

**Three fixes (chronological, three PRs):**

1. **PR [#140](https://github.com/brodotype-dev/breakerz/pull/140) — `parseInsights` refine correction = authoritative override.** `ParseInput` gains optional `refineCorrection` field. When present, prompt renders a dedicated "CONTRIBUTOR CORRECTION (authoritative)" section with explicit override language. Previously the refine handler was concatenating the correction onto the narrative and re-running the parser — the model treated both passes as equal context. Also hardened the CRITICAL nickname rule with a concrete table (Wemby, Luka, CJ Stroud, Tua, Shedeur, Flagg, Ohtani, Soto, Schwarber, etc.) and explicit "NEVER substitute" language. `handleRefineModalSubmit` in app/api/discord/interactions/route.ts now passes correction as structured `refineCorrection` instead of mashing onto narrative.

2. **PR [#141](https://github.com/brodotype-dev/breakerz/pull/141) — `parseBreakPrice` refine correction = authoritative override (mirror).** Same structural fix for the break-price refine path. `BreakPriceInput.refineCorrection` is distinct from `notes` (which is original-call user input). Nickname mapping line added to the CRITICAL section for chase-card sub-rows.

3. **PR [#142](https://github.com/brodotype-dev/breakerz/pull/142) — Scope roster to active-product players (the real fix).** The refine fixes alone weren't enough — even after #140 + #141 deployed, Brody's refines kept landing on Cooper Flagg because Wembanyama wasn't IN the roster slice. Both parsers now use `player_products!inner(products!inner(is_active))` to scope the roster to ~2,889 distinct players in active products (down from 6,666). Comfortably under the 5,000 cap with every match candidate represented. Dedupe in-process via Set since PostgREST can't express DISTINCT on a joined query.

The #140 / #141 prompt fixes still earn their keep — they protect the refine flow once the model finds the right roster entry. #142 made the lookup correct in the first place.

---

## 2026-05-26 — CardHedger data-health dashboard + live probe

Two PRs delivering the dashboard we promised ourselves after the 2026-05-20 `ch_price_cache` null-overwrite incident and the 2026-05-25 Kong-URL-cap regression. Both went undetected for days because we had no routine "is the data we depend on actually there?" surface.

**PR [#138](https://github.com/brodotype-dev/breakerz/pull/138) — Data-Health dashboard.** New admin route `/admin/data-health` reachable from the admin nav. One row per active product surfacing:

- Distinct cards (denominator: `cardhedger_card_id`s OUR matched variants reference, not full ch_set_cache)
- With prices / All-null / Never fetched (sums to distinct cards). With-prices tinted green ≥60%, yellow 25-60%, red <25%. Pre-release products tinted neutral.
- Cache fresh vs stale (24h TTL split)
- Priced players (`pricing_cache` rows / total auto-eligible player_products)
- Avg confidence (CH's sales-weighted confidence averaged across player_products)
- Last priced (relative time)

New `lib/ch-coverage.ts` runs counts in parallel per product. `ch_price_cache` reads scoped via 200-UUID `.in()` chunks (CLAUDE.md gotcha #11). PostgREST 1000-row cap handled by pagination on the distinct-card-ids query. Pure read, no new schema. Server-rendered, non-interactive for v1.

**PR [#139](https://github.com/brodotype-dev/breakerz/pull/139) — CH live-probe button.** Closes the "does it also hit the MCP to see what actually exists directly from CH" question. The dashboard's default render is cache-only (cheap). New per-row "Probe CH" button hits `getCardsBySet(ch_set_name, 1, 1)` — the response's `count` field tells us CH's view of the set size. Compare to our `ch_set_cache` rows and render a diagnosis badge:

| Result | Color | Meaning |
|---|---|---|
| match (delta = 0) | 🟢 green | CH and our mirror agree |
| CH +N | 🟡 yellow | CH grew, run Refresh CH Catalog |
| Ours +N | gray | We have more than CH (rare) |
| CH 0 / Ours >0 | 🔴 red | Bad `ch_set_name` OR CH outage |

Button-triggered so the dashboard render stays cheap. Admin clicks per-product on demand.

Watch the **With prices** column over time — a sudden drop on a previously-green product is the canary for a CH-side regression or one of our cache bugs. Would have flagged the 2026-05-22 Kong-cap issue within hours instead of 3 days.

---

## 2026-05-25 → 2026-05-26 — Pricing-refresh cron arc: three sequential fixes

The pricing-refresh cron had been silently broken since 2026-05-22 04:30 UTC. Three products (2025-26 Topps Chrome BB, 2026 Bowman BB, 2025-26 Topps Cosmic Chrome BB) timing out on every firing. Diagnosed + fixed in three PRs.

**PR [#135](https://github.com/brodotype-dev/breakerz/pull/135) — Cache-read chunk size 1000 → 200 (Kong URL cap).** Worker logs showed repeating `[pricing-refresh] ch_price_cache read failed (degrading to live fetch)` warnings. The `.in('cardhedger_card_id', slice)` cache lookup had `CACHE_LOOKUP_CHUNK = 1000` — UUIDs encode at 37 chars each, so 1000 UUIDs = 37 KB request URL, way past Kong/PostgREST's ~8 KB cap. Kong rejected the request outright. The worker logged + swallowed, fell through to "treat everything as stale," and tried to live-fetch every card via batchPriceEstimate × 3 grades. 30k cards × 3 grades / 100 per chunk ≈ 900 batches. 300s isn't close. Worked silently for two weeks because no product had >1,000 distinct CH cards until basketball products got fully hydrated. Every other `.in()` chunk in the codebase already uses 200. Added CLAUDE.md Known Gotcha #11 ("when in doubt, use 200").

**PR [#136](https://github.com/brodotype-dev/breakerz/pull/136) — Skip refetching fresh-but-all-null cached rows.** After #135 fixed the cache READ, the worker still timed out on big products. Root cause: 2026 Bowman BB has 4,257 fresh-under-24h cached rows, but **3,469 of those are all-null** (CH genuinely has no data for the card_id). Line 217's skip kept them out of `pricesOnly`, but `staleCardIds = allVariantCardIds.filter(id => !pricesOnly.has(id))` STILL included them — so we live-refetched every all-null card on every firing. CH responded "no data" again, the COALESCE upsert kept the row all-null, and we burned 6+ minutes of CH bandwidth on data we already had. For thin-coverage products (Topps Chrome BB: 28,014 / 29,936 all-null = 94%) this dominated runtime. Fix: track `freshAllNullIds: Set<string>` alongside `pricesOnly` during the cache read pass; exclude both from `staleCardIds`. After 24h the all-null rows fall out of the freshness window and we retry. New `variantsSkippedAllNull` counter surfaced in `RefreshSummary` + terminal log.

**PR [#137](https://github.com/brodotype-dev/breakerz/pull/137) — Worker AbortController so we never hit Vercel's 300s kill.** Brody hit `FUNCTION_INVOCATION_TIMEOUT` on the manual refresh even after #135 + #136 — our graceful 280s/295s deadlines only prevent NEW chunks from starting; in-flight CH calls and their 3-retry × 10s × backoff chain could ride past the deadline and blow Vercel's 300s function `maxDuration`. Fix: `lib/cardhedger.ts` `post()` accepts optional `signal: AbortSignal`. Combined with the per-call 10s timeout via `AbortSignal.any` (Node 20+). Retry loop checks the caller signal at entry + after each backoff and bails immediately if aborted. Backoff sleeps short-circuit via new `sleepUnlessAborted` helper. `batchPriceEstimate` forwards the signal. `lib/pricing-refresh.ts` creates a worker-level `AbortController` that fires at `HARD_DEADLINE_MS - 5_000` (290s). At 290s every in-flight CH call aborts, every retry chain short-circuits, and the function body returns within the ~5s buffer with a structured `partial: true` `RefreshSummary` instead of being Vercel-killed.

**Recovery scheduled.** A one-shot task fires 2026-05-26 09:00 ET to verify all three products produced `/done` markers overnight + check for `aborted by caller signal` warnings (expected, proves the AbortController is doing its job).

---

## 2026-05-21 — Upper Deck XLSX parser (Beckett "Master Card List" sheet)

Adds a second surface to the Upper Deck / O-Pee-Chee importer alongside the URL scraper that shipped earlier today. Beckett publishes a `<product>-Checklist.xlsx` for every UD release whose `Master Card List` sheet has the exact same 11-column structure (`Set Name | Card | Description | Team City | Team Name | Rookie | Auto | #'d | SPs | Stated Odds | Point`) as the web checklist table. The XLSX is the preferred path when admin has it — no Cloudflare, no JS rendering, no rate limit, one file = checklist + odds.

**Mechanics.**
- [lib/upper-deck-parser.ts](./lib/upper-deck-parser.ts) refactored to extract a shared `rowsToResult(rows)` transform. Both `parseUpperDeckUrl` and the new `parseUpperDeckXlsx` produce identically-shaped `RawRow[]` and route through the same set-grouping + Claude Haiku odds normalization.
- `parseUpperDeckXlsx(buffer)` detects the canonical sheet by header signature (not name — Beckett uses both "Master Card List" and "Master Checklist" across files). Lowercases + trims the header row, requires `set name`, `card`, `description`, `stated odds`, builds a column-index map, then walks every subsequent row.
- New `POST /api/admin/parse-upper-deck-xlsx` — multipart upload, returns `{ checklist, odds }`.
- [app/admin/products/[id]/ImportFromUrl.tsx](./app/admin/products/%5Bid%5D/ImportFromUrl.tsx) gains a `Beckett XLSX (preferred)` file-upload affordance above the existing URL inputs. One click runs parse → apply checklist → apply odds in a single pass.
- New [docs/manufacturer-rules/upper-deck.md](./docs/manufacturer-rules/upper-deck.md) — mirrors `bowman.md` / `panini.md` structure. Covers both surfaces, the shared row shape, the 8-format Stated Odds column, and admin workflow.

**Validated against the actual 2025-26 OPC Platinum XLSX:** 112 sections × 6,322 cards × 25 unique odds patterns — byte-identical to the URL-scrape numbers.

**Naming choice.** Lives in the UD manufacturer parser, not a Beckett-specific module. The format may be published BY Beckett but it represents UD product structure (the Bowman/Topps + Panini patterns are both manufacturer-keyed; UD follows suit).

---

## 2026-05-21 — Upper Deck URL parser: scrape markdown + parse table directly

Replaces the earlier Firecrawl JSON-extractor path that landed in PR [#117](https://github.com/brodotype-dev/breakerz/pull/117) and PR [#118](https://github.com/brodotype-dev/breakerz/pull/118). The OPC Platinum import surfaced a real limitation: upperdeck.com checklist pages produce ~810KB of markdown when fully loaded (6,322 rows × 112 sections), which choked Firecrawl's LLM-based JSON extractor (returned `success: true` with no `json` field).

**Pivot.** The table is structurally clean (`|`-delimited markdown with a known header row). Deterministic parsing is faster, cheaper, and more reliable than the LLM path.

- Drop the Zod-schema JSON extraction. Scrape markdown only.
- Add `proxy: 'stealth'` + `waitFor: 8000` + `onlyMainContent: false` to defeat the Cloudflare anti-bot + GDPR cookie banner + JS-hydrated table without dropping the table along with the banner.
- New `parseTableFromMarkdown` finds the header row by required-column detection, reads column indices dynamically, walks `|`-rows until table ends.
- Claude Haiku odds normalization unchanged — still called once per import to normalize multi-format `Stated Odds` strings.

---

## 2026-05-21 — WaxStat box-pricing scraper + weekly importer

Third commit of today's Firecrawl-foundation arc. Pulls sealed-box pricing from [waxstat.com](https://waxstat.com) — an aggregator that consolidates wax prices across retailers (eBay, Steel City Collectibles, Blowout, etc.) — into our `*_am_case_cost` columns weekly. Closes the gap where breaker-supplied MSRP is stale and admin had to type the AM number in by hand.

**Why this scraper.** WaxStat is the canonical place to see "what is a sealed hobby box of 2025-26 Bowman Basketball actually selling for right now?" — and that number is what `hobby_am_case_cost` represents in our schema (one sealed box = one case for our case-mix math). The break page already prefers AM cost over MSRP when both are set. Until now it was a manual admin task; this commit makes it weekly + automatic.

**Mechanics.**
- **Schema** is already applied to production via Supabase MCP (from a prior session); [supabase/migrations/20260521120000_waxstat_pricing.sql](./supabase/migrations/20260521120000_waxstat_pricing.sql) is the traceability file with `IF NOT EXISTS` guards. Adds three `waxstat_*_url` columns on `products` + new `waxstat_pricing_snapshots` table (per-fetch time series: `avg_price`, `low_30d`, `high_30d`, `trend_7d`, `error_message`, `fetched_at`).
- **Scraper** [lib/waxstat.ts](./lib/waxstat.ts) `fetchBoxPanel(url)` — Firecrawl JSON extract with Zod schema, throws on empty or schema mismatch. No plain-fetch fallback (WaxStat is Cloudflare-protected).
- **Importer** [lib/waxstat-importer.ts](./lib/waxstat-importer.ts) `refreshProductWaxstat(productId)` — reads the three URL columns, fetches in parallel, writes one snapshot row per format (success OR error — so stale ≠ broken in the admin panel), and overwrites the matching `*_am_case_cost` on success. Per-format errors are isolated; a 404 on hobby doesn't tank BD + jumbo.
- **Cron** [app/api/cron/refresh-waxstat-pricing/route.ts](./app/api/cron/refresh-waxstat-pricing/route.ts) — Sundays 04:00 UTC. Iterates active products with at least one `waxstat_*_url` set, serial per product. `recordCronStart` marker so the admin Cron Status panel sees the run even if Vercel kills the function at `maxDuration=300s`.
- **Admin panel** [app/admin/products/[id]/WaxstatPanel.tsx](./app/admin/products/%5Bid%5D/WaxstatPanel.tsx) — three URL inputs (hobby / BD / jumbo), "Save URLs" + "Refresh Now" buttons, latest-snapshot summary per format with the error message rendered in red when the most recent fetch failed.
- **Manual refresh + save** [app/api/admin/products/[id]/waxstat-refresh/route.ts](./app/api/admin/products/%5Bid%5D/waxstat-refresh/route.ts) — POST runs `refreshProductWaxstat`; PUT saves the three URL fields. Admin/contributor only.

**Operational notes.**
- Re-uses the Firecrawl client singleton pattern from `lib/upper-deck-parser.ts` (lazy, per warm container, throws if `FIRECRAWL_API_KEY` is unset).
- Snapshot table is service-role-only — no consumer access. Same pattern as `ch_set_refresh_log` + `cron_run_log`.
- The cron skips products with all three URL columns null, so onboarding a new product is just "paste a URL".

**Out of scope.**
- Backfilling historical snapshots. The first weekly run starts the time series.
- Per-retailer breakdown — we take WaxStat's already-aggregated `avg_price`.
- Discord notifications on material case-price moves.

---

## 2026-05-21 — Upper Deck URL parser: Firecrawl JSON extract + Claude Haiku odds normalization

Adds Hockey to the private-beta sport roster and a new admin path for importing Upper Deck checklists by URL. Builds on the Firecrawl foundation that landed earlier today.

**Why the URL path.** Upper Deck doesn't publish per-product XLSX checklists the way Topps and Panini do — instead each release has a single HTML page at `upperdeck.com/checklist/…` with a per-card table that crams 8 pack formats into one `Stated Odds` column (`"2:1 h, 2:1 e, 2:1 r, 2:1 b, 2:1 mega 5:1 hanger, 2:1 tin, 1:1 dollar"`). Cloudflare-protected, so direct fetch from a Vercel function is unreliable. Firecrawl proxies it cleanly + extracts the table to structured JSON via a Zod-shaped schema.

**Mechanics.**
- **New parser** [lib/upper-deck-parser.ts](./lib/upper-deck-parser.ts) exports `parseUpperDeckUrl(url)` → `{ checklist: ParsedChecklist, odds: ParsedOdds }`. Firecrawl client is a lazy singleton (one instantiation per Lambda warm container). Module-level `PAGE_CACHE` is an in-memory Map keyed by URL with a 5-minute TTL — back-to-back checklist + odds imports against the same URL only spend one Firecrawl call.
- **Odds normalization** is done with Claude Haiku (`claude-haiku-4-5-20251001`) in one batched call per import — `normalizeOdds` dedupes the raw odds strings (typical checklist has ~10–20 unique patterns) and sends them all in one prompt that returns `{ results: [{ raw, odds: OddsByFormat }] }`. ~$0.005 per import.
- **Type extensions** in [lib/types.ts](./lib/types.ts) — new `UpperDeckPackFormat = 'hobby' | 'epack' | 'retail' | 'blaster' | 'mega' | 'hanger' | 'tin' | 'dollar'` and `OddsByFormat = Partial<Record<UpperDeckPackFormat, string>>`. `ParsedOdds.rows[]` in [lib/checklist-parser.ts](./lib/checklist-parser.ts) extended with optional `oddsByFormat` field. Existing apply-odds writer reads `hobbyOdds` and continues to work unchanged.
- **Two new admin routes** — `POST /api/admin/parse-checklist-url` and `POST /api/admin/parse-odds-url`. Both delegate to `parseUpperDeckUrl`, so they share the per-URL Firecrawl cache. `maxDuration=120` on both.
- **Inline UI** — new [app/admin/products/[id]/ImportFromUrl.tsx](./app/admin/products/%5Bid%5D/ImportFromUrl.tsx) drops two text inputs + Import buttons into a new "Import from URL (Upper Deck)" Section between Quick Actions and Pricing Anchor Strategy on the product dashboard. Checklist flow forwards the parsed sections to `/api/admin/import-checklist` with default `{ hobbySets: 1, bdSets: 0 }` per section (UD breakers overwhelmingly sell hobby slots; admin can override per-section via the legacy `/admin/import-checklist` wizard if needed). Odds flow forwards to `/api/admin/apply-odds` — same token-overlap matcher Topps and Panini use.
- **Hockey sport.** Row already existed in `sports` (slug `hockey`) — no migration needed.

**Engine behavior.** Unchanged. Engine reads `hobby_odds` for slot math today; the richer `oddsByFormat` payload is stored but not consumed yet. When we add per-format pool support (e.g. retail / blaster / mega cases), the data is already in the payload.

**Private-beta scope.** [docs/private-beta-scope.md](./docs/private-beta-scope.md) updated — Football row now points at `2025 Topps Chrome Football` (needs to be created in admin before flipping `is_active = true`); Hockey row added pending sub-line decision.

**Out of scope (queued for later):**
- Auto-discovery of UD URLs by fuzzy-matching product names. Admin pastes URLs directly.
- Extending `BreakFormat` to include `epack` / `retail` / `blaster` etc. — UD breakers overwhelmingly sell hobby slots; revisit if data ever justifies.
- Consumer surface for the 8-format odds breakdown. Stored in payload, not rendered to users yet.

---

## 2026-05-21 — Checklist parser: handle Topps Chrome Football XLSX quirks

Brody hit a clearly-broken import on the new 2025 Topps Chrome Football product — the admin review screen showed sections named `"100 cards"`, `"30 cards"`, `"5 cards"` etc. (raw count-metadata rows mis-promoted to section names) and `"Team Camo Variation"` rendered as a standalone section when it should be a parallel of the Variations section. Blocked the Football product setup for private-beta scope.

**Root cause.** [lib/checklist-parser.ts](lib/checklist-parser.ts) `parseChecklistXlsx` relied on a **trailing period** as the bright-line discriminator between section names and prose metadata (e.g. `"350 cards."` skipped, `"Hobby only."` skipped). 2025 Topps Chrome Football authored its count rows WITHOUT periods (`"400 cards"`, `"70 cards"`), so they slipped past the filter and got promoted to section names. Two related quirks in the same XLSX: `"Versions"` sub-label between count and parallels wasn't in `STRUCTURAL_LABEL_RE`, and `"Lightboard Logo Variation"` / `"Team Camo Variation"` are real parallels of the Base Variations section but didn't match `PARALLEL_LABEL_RE` (which expects "Refractor" / color names / "/N" suffix).

**Fix.** Three pattern additions, no architectural change:
1. New `COUNT_METADATA_RE = /^\d+\s+cards?\.?$/i` — period optional. Wired alongside the existing `.endsWith('.')` skip. Handles all 2025 Topps Chrome count-row variants + remains forward-compatible with the periodic form.
2. `STRUCTURAL_LABEL_RE` extended to skip `"Versions"` / `"Version"` AND Topps' "Veterans:/Rookies:/Legends: #s X-Y" range qualifiers — sub-labels of the Base sheet that the parser was treating as new sections.
3. `isParallelLabel()` extended to recognize any label ending in `"Variation"` / `"Variations"` so Topps Chrome's variation labels collect as parallels of the surrounding section instead of becoming their own mis-named sections.

**Before/after on the actual 2025 Topps Chrome Football XLSX.** Before: 24 sections including `"100 cards"`, `"30 cards"`, `"5 cards"`, `"Team Camo Variation"` as the section name with the data. After: 35 sections with real names — `"Chrome Autographs"` (70 cards), `"Rookie PREM1ERE Patch Autographs"` (98 cards), `"Variations"` with `[parallels: Base - Full Set Variations, Lightboard Logo Variation, Team Camo Variation]`, `"Power Players"`, `"Kaiju"`, `"Let's Go"`, etc.

**Regression suite passed** — 2025 Topps Series 1 Baseball (46 sections, zero metadata leakage) and 2025 Panini Prizm Football (316 sections, 34,723 cards) both parse byte-identical to pre-change. The three new patterns are additive — they catch more cases that should have been filtered, never relax a check.

New verifier script at [scripts/verify-tcf-parse.mjs](scripts/verify-tcf-parse.mjs) — runs the parser against the local Topps Chrome Football XLSX and prints sections + parallels. Sister of the existing `verify-topps-series-parser.mjs` and `verify-panini-parser.mjs`.

---

## 2026-05-21 — Firecrawl foundation: SDK + MCP + env-var plumbing

Foundation commit for the upcoming Upper Deck checklist parser + WaxStat box-pricing scraper, both of which need to fetch from sites behind Cloudflare bot-detection. WebFetch (Anthropic's residential infra) handles those URLs fine, but Vercel functions get blocked frequently — Firecrawl proxies through their own browser-grade infrastructure and is the canonical fix.

This commit is **zero behavior change**. Future commits add the actual scrapers on top of this foundation.

**Mechanics.**
- `@mendable/firecrawl-js` v4.24.2 added to dependencies via `npm install --save`.
- New `FIRECRAWL_API_KEY` env var listed in CLAUDE.md (set in Vercel Production/Preview/Development scopes, mirror to `.env.local` via `vercel env pull`).
- New `firecrawl` entry in [.mcp.json](.mcp.json) using HTTP remote at `https://mcp.firecrawl.dev/${FIRECRAWL_API_KEY}/v2/mcp`. Matches the existing `card-hedge` / `supabase` HTTP pattern (no Node subprocess to manage). Key never lands in committed code — interpolated from env at MCP-client launch.
- `FIRECRAWL_API_KEY` added to the whitelist in [scripts/sync-claude-env.mjs](scripts/sync-claude-env.mjs) so it propagates from `.env.local` into every worktree's `.claude/settings.local.json` automatically. The four current `settings.local.json` files (main + 3 worktrees) got placeholder `FIRECRAWL_API_KEY: ''` slots pre-populated so the MCP entry resolves cleanly the moment the real key lands.
- Stack line in CLAUDE.md updated to mention Firecrawl alongside the other external services.

**Operational follow-on (Brody, before next commit lands real usage).**
1. Add `FIRECRAWL_API_KEY` to Vercel env (all three scopes).
2. `vercel env pull .env.local` to bring it down.
3. `node scripts/sync-claude-env.mjs` to overwrite the empty placeholders with the real value.
4. Cmd+Q + relaunch Claude Code Mac app so the Firecrawl MCP picks up the key at next spawn.

---

## 2026-05-20 — Admin product form: toggle now wins on edit

Brody flagged 2026-05-20 that flipping an active product's "Active" toggle to off and clicking Save (Publish or Save Draft) didn't deactivate it. UI showed "Product updated." but the toggle would re-render as on.

Root cause in [components/admin/ProductForm.tsx](components/admin/ProductForm.tsx) — the submit handler had `is_active: publish ? true : isActive` plus a post-success `if (publish) setIsActive(true)`. So clicking Publish on an existing product ignored the toggle and force-wrote `is_active=true`, then visually snapped the toggle back to on. Net: there was no UI affordance for deactivating a live product, even though the toggle made it look like there was.

Fix carves the behavior on `product` (existence of the edit target):
- **Editing existing product:** toggle wins, always. Both Publish and Save Draft respect it. The Publish button still runs the "CH set name must be set" guard, but no longer overrides `is_active`.
- **Creating new product + Publish:** treat as intent to go live — force `is_active=true` so the button name does what it says. Save Draft on a new product still respects whatever the toggle says (defaults off).
- Post-success: if we changed `is_active` (only happens on the new-product Publish path), sync the toggle UI to match what we just saved.

No DB migration, no schema change. Two-line behavioral fix + comment.

---

## 2026-05-20 — Free-tier analysis limit bumped 3 → 5

Brody + Kyle, 2026-05-20. Private-beta breathing room — three free analyses lifetime was too tight for users to get a real feel for the product before hitting the gate.

Extracted the magic number into `FREE_TIER_ANALYSIS_LIMIT = 5` in [lib/usage.ts](lib/usage.ts), exported and consumed by the `LIMITS` table, the unknown-plan fallback, AND the `/subscribe` consumer copy (both "Start with N free analyses" hero line and "Continue with free trial (N analyses) →" CTA). Single source of truth — bumping the constant in `lib/usage.ts` automatically updates the gate logic AND the marketing copy. No DB migration needed: existing free-tier users who'd already used 3 analyses are immediately allowed 2 more (`3 >= 5` is false), no data backfill.

---

## 2026-05-20 — `ch_price_cache` write bug: failed chunks no longer nuke good prices

The 2026-05-20 FMV investigation surfaced that 60,150 cache rows (97% of `ch_price_cache`) had ALL THREE price columns null. Spot-probing 5 random cards from that bucket showed 1 of 5 (20%) had genuine CH data via `batch-price-estimate` right now — meaning we were silently nulling real prices, not just observing the long tail of low-trade parallels.

**Root cause.** [lib/pricing-refresh.ts](lib/pricing-refresh.ts) `runChunk` ran a blind `.upsert()` per chunk after three parallel `batchPriceEstimate` calls (Raw / PSA 9 / PSA 10). When ANY of those calls rejected at the chunk level — timeout under the 240s deadline, rate limit, transient CH outage — its `*Map` was empty for the entire chunk, every card's `valid*` field collapsed to null, and the upsert wrote `*_price: null` for that grade. The "all grades failed" branch deliberately wrote nulls too (comment said this was to prevent re-fetch storms on transient outage). Net effect: **every chunk-level failure wiped previously-cached good values for every card in the chunk.** Cron logs confirmed per-product workers were routinely running 282–296s — right up against Vercel's 300s kill — so chunk aborts were frequent and the damage accumulated across firings.

**Fix.** Migration [supabase/migrations/20260520220000_ch_price_cache_preserve_nulls_upsert.sql](supabase/migrations/20260520220000_ch_price_cache_preserve_nulls_upsert.sql) adds `upsert_ch_price_cache_preserving_nulls(rows jsonb)` — a Postgres function that does per-grade `COALESCE(EXCLUDED.*, ch_price_cache.*)`. Null new values preserve the existing cached value; non-null new values overwrite. `fetched_at` always bumps so the TTL still skips this card on the next firing (preserving the "no re-fetch storm on transient outage" property the previous blind-upsert was reaching for). Single SQL statement, atomic — no TOCTOU race when concurrent staggered firings overlap on the same card_id (rare but real under 4 in-flight chunks per worker × multiple staggered firings).

[lib/pricing-refresh.ts](lib/pricing-refresh.ts) swap: one line in `runChunk` — `.from('ch_price_cache').upsert(...)` → `.rpc('upsert_ch_price_cache_preserving_nulls', { rows: cachePersistRows })`. Net code delta: zero new app logic, two new comments documenting the contract. The "all grades failed" branch comment rewritten — it still falls through to the upsert because `fetched_at`-only bump is now safe.

**Backfill posture.** Automatic. Next cron firings' successful chunks repopulate prices for previously-nulled cards via the COALESCE-on-overwrite path. Cards CH genuinely doesn't have prices for (the actual long tail) stay null indefinitely — that's correct behavior.

**Verified.** SQL smoke test: seeded a row with raw=$9.99/psa9=$38.50/psa10=$110.00, called RPC with all-null payload → all three prices preserved, fetched_at bumped. Called RPC with raw=$11.11/psa9=null/psa10=null → raw overwrote, psa9 + psa10 preserved.

**Out of scope.** Daily CH-coverage tracker (per-product priced-card-% over time) was scoped during investigation and deferred. Pushing pressure data to River from a contaminated baseline isn't useful — better to wait a few cron cycles for prices to repopulate post-fix, then build the tracker against clean data.

---

## 2026-05-20 — CH catalog: persist `card_description`, dedup matching on (number, variant) collisions

River (CardHedger co-founder, 2026-05-20 email) flagged that some CH cards share the same (set, number, variant) tuple but are genuinely distinct — e.g. Munetaka Murakami `2026 Bowman Baseball #9 "Base"` is both the regular RC AND the Red Rookie Redemption RC, identical in our catalog cache except for `card_description` ("Munetaka Murakami 2026 Bowman Baseball" vs. "Munetaka Murakami 2026 Bowman Red Rookie Redemption Baseball"). Two pre-existing bugs were silently dropping the second card in every collision pair:

1. **Catalog write dropped the field.** [lib/cardhedger.ts](lib/cardhedger.ts) `normalizeCard` projected `player_name / set_name / number / variant / category / rookie / year / prices` from CH's `card-search` response but ignored the `description` field that ships alongside. The `raw` jsonb in `ch_set_cache` had the normalized shape — no description anywhere. `getCardsBySet` is what `refreshSetCatalog` populates with, so every cached set across every product was missing it.
2. **Match index discarded collisions.** [lib/cardhedger-catalog.ts](lib/cardhedger-catalog.ts) `loadCatalogIndex` built `byNumberVariant: Map<string, CatalogCard>` keyed on `"number::variant"` and explicitly kept only the first hit (`if (!byNumberVariant.has(variantKey))`). When two real cards collided on that key, the second was silently overwritten and never bound during checklist import. `tierExactVariant` + `tierSynonym` in [lib/card-knowledge/match.ts](lib/card-knowledge/match.ts) would short-circuit to whichever card won the race, often the wrong one.

**Mechanics.**
- Migration [supabase/migrations/20260520210000_ch_set_cache_card_description.sql](supabase/migrations/20260520210000_ch_set_cache_card_description.sql) adds nullable `card_description text` column to `ch_set_cache`. Already applied to prod via Supabase MCP. Backfill happens on the next per-product CH catalog refresh (3 AM UTC cron, or admin "Refresh CH Catalog" button) — no manual repop needed.
- `CardHedgerSearchCard` + `RawCardHedgerCard` types extended with `description`. `normalizeCard` projects `raw.description ?? ''`. `getCardsBySet` therefore carries it through to the catalog refresh path.
- `refreshSetCatalog` writes `card_description: c.description || null` on insert. `loadCatalogIndex` selects + projects it into `CatalogCard.description`.
- `byNumberVariant` changed from `Map<string, CatalogCard>` to `Map<string, CatalogCard[]>`. All collision candidates retained, none dropped.
- New `pickUnique(bucket)` helper in [lib/card-knowledge/match.ts](lib/card-knowledge/match.ts) returns the single hit when there's exactly one and `null` otherwise. `tierExactVariant` + `tierSynonym` use it — collisions deliberately fall through past the deterministic tiers so the Claude tier can disambiguate with `description`.
- Claude candidate shape in [claudeCardMatchFromCandidates](lib/cardhedger.ts) gains optional `description?: string`. Rendered into the prompt's candidate list when populated. Prompt instruction extended to explicitly call out description as the tie-breaker when (set, number, variant) match across rows.
- [app/api/admin/match-cardhedger/route.ts](app/api/admin/match-cardhedger/route.ts) Claude-tier candidate construction passes `description` through.

**Backfill posture.** Description is nullable on the column and on `CatalogCard.description` (empty string when missing). Existing cached catalogs continue to work as before — they just can't disambiguate collisions until their next refresh. Match tiers gracefully ignore `description` when absent. The 3 AM UTC cron will repopulate over the next few days; admin can force a per-product refresh via the existing "Refresh CH Catalog" button if a specific product needs immediate accuracy (Murakami fix → run on `2026 Bowman Baseball`).

**Out of scope.** Re-matching variants that were bound to the wrong card_id during previous imports (the Murakami case + however many others share this shape). The fix prevents NEW mis-binds; cleaning up historical ones is a separate operation that needs admin UI to surface "variants whose binding collides with another in the same set" and let an operator rebind them. Tracked as a follow-up.

---

## 2026-05-20 — Player drawer per-grade prices: swap CardHedger `all-prices-by-card` → `card-fmv-batch`

Fixes the production drawer bug flagged as Use Case 9 in [docs/cardhedger-api-usage.md](docs/cardhedger-api-usage.md): every consumer player drawer in production today renders `—` in PSA 9 and PSA 10 cells for the vast majority of variants, because CardHedger's `/v1/cards/all-prices-by-card` panel only includes grade entries where it has recent direct sales — and graded sales are thin on most cards.

**Why now.** A 2026-05-20 experiment (`scripts/experiment-card-fmv.mjs` + `scripts/experiment-card-fmv-at-scale.mjs`) confirmed CardHedger's new `/v1/cards/card-fmv-batch` endpoint (shipped by River after the 2026-05-15 product call) returns a defensible price for 100% of PSA 9 / PSA 10 requests across a 500-card random sample. The catch: 91% of those graded prices come back via fallback methods (`segment_fallback_indexed`, `anchor_multiplier_indexed`, etc.) — model estimates derived from cross-grade interpolation or movement-indexed raw prices, not direct sale aggregates. Honest swap requires telling users which is which.

**Mechanics.**
- New [getCardFmvBatch](lib/cardhedger.ts) wrapper next to `batchPriceEstimate`. Same `{ items: [{ card_id, grade }] }` shape, max 100 items per request, returns per-item `{ price, confidence, method, confidence_grade, freshness_days, fmv_sample_count }`. Method semantics: `direct` / `direct_indexed` are real recent-sale aggregates; everything else (`segment_fallback_indexed`, `anchor_multiplier(_indexed)`, `correlated`, `cross_provider(_indexed)`) is a model estimate. `no_data` + `null` price = the row is genuinely empty even for FMV's fallbacks.
- [app/api/player-comps/route.ts](app/api/player-comps/route.ts) rewires per-grade fetch from N parallel `getAllPrices(cardId)` calls (one per unique card_id) to a single batched FMV call covering every (card_id × [Raw, PSA 8, PSA 9, PSA 10]) the drawer renders. Drawer caps at 15 unique cards × 4 grades = 60 items per call, well under the 100/req FMV cap. `null` / `<= 0` rows dropped at the API layer so `—` rendering still represents "we genuinely don't know" (now including "even FMV's correlated fallback ran out of signal").
- [components/breakiq/PlayerDetailDrawer.tsx](components/breakiq/PlayerDetailDrawer.tsx) renders estimated cells (`method !== 'direct' && method !== 'direct_indexed'`) in italic + 65% opacity so users can tell a $42 model estimate from a $42 recent-sale aggregate at a glance. New one-line legend appears below the variants table only when at least one estimated cell is present: *"Italic = model estimate (CardHedger FMV — thin recent-sale data, derived from cross-grade or movement index)."* `VariantWithPrices.prices[]` extended with optional `method` + `confidence` (non-breaking; old consumers ignore them).
- [Recent Sales (Graded) section](components/breakiq/PlayerDetailDrawer.tsx) UNCHANGED — still backed by `getComps` because "no recent graded sales found in the last 180 days" is the honest answer for that surface. FMV would fabricate sale rows that don't exist.

**Out of scope (deliberately).**
- `app/api/player-profile/route.ts` graded-comps calls (Use Case 9 elsewhere in the pipeline) — same shape, easy follow-on, but kept this swap surgical to the drawer surface only.
- Pricing refresh (`lib/pricing-refresh.ts`) — at-scale experiment caught FMV pricing PSA 9 / PSA 10 systematically ~18% LOWER than `batch-price-estimate` (84% of cards, median 18%, directional not noise). Swapping cached EV blindly would shift consumer slot prices everywhere. Held until River explains the drift in the 2026-05-20 follow-up email.
- Per-cell confidence chip in the drawer (e.g., Strong/Solid/Stale/Cold from `lib/engine.ts` `confidenceTier()`). Italic + opacity carries the binary "real vs. estimate" signal; finer-grained tiering deferred until the audit decomposition story lands.

---

## 2026-05-17 — Refine-flow stabilization: buttons now clear on Apply

PR [#114](https://github.com/brodotype-dev/breakerz/pull/114). Brody reported that clicking Apply on a *refined* proposal didn't clear the ✅/✏️/❌ buttons even though the apply itself succeeded (DB updated to status='applied'; second click correctly returned an "already applied" ephemeral). Made the post-refine UX feel broken.

**Root cause.** Both `handleButton` and `handleRefineModalSubmit` were editing the source proposal message via `editInteractionResponse` → `/webhooks/{appId}/{token}/messages/@original`. For an interaction that deferred with `DEFERRED_UPDATE_MESSAGE` the `@original` endpoint *should* reference the source message — but when a message has already been edited by a PRIOR interaction (the modal-submit's edit during refine), a subsequent interaction's `@original` reference becomes unreliable. Discord silently no-ops the PATCH instead of returning an error, so the apply succeeded everywhere except visually.

**Fix.** Every "edit the source proposal message" call now uses `editChannelMessage(channel_id, message_id, body)` — bot-token PATCH by message id, completely bypassing interaction-token lineage. Deferred response stays as `DEFERRED_UPDATE_MESSAGE` so Discord still acks. Touched sites: `handleButton.discard` + `.confirm` + confirm catch-block, and all five edit calls inside `handleRefineModalSubmit` (fetch-failure, no-updates, staging-failure, success, re-parse-error catch). `ButtonInteraction.message` extended to include `id`. All edit failures now log explicitly instead of silently swallowing — the next failure mode surfaces immediately.

---

## 2026-05-17 — Parser: card-code detector widened (catches `3D-37`-style codes)

PR [#113](https://github.com/brodotype-dev/breakerz/pull/113). Kyle's "Dylan Harper across all products" `/insight` matched to the WRONG player record — `3D-37` instead of `Dylan Harper`. Root cause: 40 Topps 3 Basketball card numbers (`3D-1` through `3D-40`) had crept into the players table as bogus rows during checklist import. The 2026-05-15 fix (PR #111) caught letter-starting codes like `B25-AL` but its regex required starting with letters, so `3D-37` (digit-starting) and `90A-KS` (digits-then-letter-then-dash) slipped through.

**Two layers of defense.** (1) Widened the regex in [lib/checklist-aggregates.ts](lib/checklist-aggregates.ts) to `^[A-Z0-9]{1,5}-[A-Z0-9]{1,6}$` — covers letter-starting, digit-starting, and mixed patterns. Still conservative; no real player name fits the all-caps no-spaces short-hyphenated profile. (2) New `isCardSubsetCode()` export consumed by BOTH parser roster queries (`parseInsights` + `parseBreakPrice`) — filters card-code names out of the Claude-visible roster, so even if a bogus row exists in `players`, the parser can't accidentally match a real narrative to it.

**Prod backfill** — 137 polluting rows flipped via Supabase MCP at commit time. Mostly the 40 Topps 3 Basketball numbers plus stragglers.

---

## 2026-05-17 — Parser: sentiment scope defaults to 'global', forbids hallucinated product_ids

PR [#112](https://github.com/brodotype-dev/breakerz/pull/112). Kyle fired `/insight` on a Schwarber 2014 Bowman Chrome auto price movement. Parser interpreted "2014 Bowman" as a product context, set `scope='product'`, and emitted `product_id='90A-KS'` — actually a card code, not a product id (we don't have a 2014 Bowman product in our roster). Apply dropped with "no player_product for (player, product) — sentiment scope=product cannot apply", net zero applied updates.

**Brody's rule.** When sentiment is fundamentally about a player's market movement (homerun pace, hot/cold streak, post-game buzz), scope should be `'global'` (player-wide), NOT a specific card or product. A single-card sale or price observation is itself a data point on the player's overall market, not a product-specific signal.

**Two tightenings on the SENTIMENT rules block in `parseInsights`:** (1) **Strongly default to 'global'.** Bar for `'product'` is now explicit — narrative must EXPLICITLY contrast the player's value ACROSS products ("his Topps Chrome is hotter than his Bowman"). Simply mentioning a card does NOT meet the bar. The Schwarber-style case is called out as a global example. (2) **Hard rules:** never hallucinate a product_id (fall back to `'global'` when named product isn't in the supplied list), team narratives use `team_sentiment` (not sentiment-with-team-scope), and an explicit note that b-score adjustments are the same as sentiment.

Prompt-only change.

---

## 2026-05-15 — Checklist: card-subset codes flagged as `insert_only` at import

PR [#111](https://github.com/brodotype-dev/breakerz/pull/111). Brody spotted 130 "player" rows on 2025 Bowman's Best Baseball with names like `B25-AL`, `B25-CS`, `B25-BCA` — Bowman autograph subset SKU codes, not players. They were polluting the Player Slots tab.

The 2026-04-29 multi-player detector (`isMultiPlayerName`) only checked for `/` in the name (slash = multi-player insert). Card-subset codes don't have a slash so they slipped through. Extended `isMultiPlayerName` in [lib/checklist-aggregates.ts](lib/checklist-aggregates.ts) to also match `^[A-Z]{1,3}\d{0,2}-[A-Z]{1,6}$`. The import-checklist route already calls this in its `insert_only` derivation, so any future checklist import flags subset codes at the source.

**Prod backfill** — 132 polluting rows already flipped via Supabase MCP at commit time (130 on Bowman's Best + 1 each on Topps Chrome + Sapphire). _Note: superseded by the wider regex in PR #113 two days later, which caught the digit-starting variants this one missed._

---

## 2026-05-15 — Market Delta Watch: dual thesis sections (logged breaks + slot captures)

PR [#110](https://github.com/brodotype-dev/breakerz/pull/110). Brody flagged the top of the Market Delta Watch page looked frozen — "Sample too thin · 1 observation" while the captures panel below showed 50 recent `/break-price` slot asks. Not a bug per se, but visually misleading by omission since the two sections read from different data sources at different units of measure (bundle vs slot).

Split the page into two clearly labeled thesis views, each computed from its own data source:

- **Section 1 · Logged breaks** (blue banner) — bundle asks from `user_breaks` (one row = one whole-break ask vs. our number). Thesis verdict, stat grid, delta distribution, per-product breakdown, recent observations table.
- **Section 2 · Observed break pricing** (orange banner) — slot captures from Discord `/break-price` via `market_observations` (one row = one team-slot ask vs. our model). Parallel cluster — own thesis verdict, own stat grid, own distribution, own per-product breakdown. Captures table re-labeled "Recent slot captures."

Extracted `aggregate()` and `verdictFor()` pure helpers so both sections share math + thresholds. Verdict observation enrichment toggle moved inside Section 2 since that's exactly the data it plumbs into the AI verdict prompt. Section 2's verdict subtitle calls out how many of the total captures were excluded from the aggregates (mixed-composition or no per-team fair value). Same thesis thresholds across both data sources for consistency.

No DB migrations, no new API routes. Pure server-component read.

---

## 2026-05-15 — `/insight` + `/break-price` refine-with-correction flow

Adds a third **✏️ Refine** button to every `pending_insights` proposal panel (next to ✅ Apply / ❌ Discard). Click → Discord modal asks "What should change?" → submission re-parses the original capture with the correction spliced in as additional context → edits the proposal message in place. PR [#108](https://github.com/brodotype-dev/breakerz/pull/108).

**Why now.** Picked up the optional refine flow from the BACKLOG. Even with the 2026-05-15 parser fixes (title-level format override + product format awareness) reducing the most common reasons for a mis-parse, there are still edge cases where the model gets one row wrong, or the screenshot text was hard to OCR, or a per-row override needs to be expressed. Re-firing the slash command means re-uploading screenshots; the refine button gives an in-place correction loop.

**Routing.** Pending row carries a new `source_kind` (`insight` | `break_price`) so the modal-submit handler knows which parser to call. Text-only `/insight` proposals get a `parseInsights` re-run with the original narrative + correction concatenated. `/break-price` proposals get a `parseBreakPrice` re-run with the original narrative + re-fetched images + correction as `notes`. Images are re-fetched from stored CDN URLs (kept in a new `source_attachments JSONB` column) within Discord's ~24h CDN window — matches the existing `pending_insights.expires_at` TTL, so the refine window equals the confirm window.

**Iterable.** The pending row stays `pending` through a refine — ✅/✏️/❌ buttons re-render after each refine so the loop is iterable until the contributor applies or discards. Refine is race-safe (only operates on still-pending rows) and gracefully reports when all CDN URLs have expired.

**Migration.** [supabase/migrations/20260516120000_pending_insights_refine.sql](supabase/migrations/20260516120000_pending_insights_refine.sql) adds `source_attachments JSONB` (nullable) + `source_kind TEXT` with CHECK constraint. Already applied to prod via Supabase MCP. Legacy pending rows default to `source_kind='insight'` — refine falls back to text-only re-parse on those (no stored attachments to re-fetch anyway).

**Mechanics.** New constants in [lib/discord.ts](lib/discord.ts): `InteractionResponseType.MODAL` (9), `ComponentType.TEXT_INPUT` (4), `TextInputStyle` enum. The POST dispatcher in [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) routes `MODAL_SUBMIT` (5) → new `handleRefineModalSubmit`. All three staging sites (`handleInsights`, `handleBreakPrice`, `handleBreakPriceFromMessage`) populate the new columns at insert time. `handleButton` gets a `refine` branch returning the modal directly (no defer — modal is the immediate response).

**Operational.** No registrar re-run needed — the Refine button is just a new component on existing replies, no command schema change. Force-quit + reopen Discord to see the new button on the next proposal.

---

## 2026-05-15 — Product line taxonomy + parser format-availability rules

Adds a `product_line` TEXT column to products ("taxonomy lite" path per the data-model roadmap) and uses it to fix a parser correctness gap surfaced after the previous slice's title-level JUMBO rule shipped. PR [#106](https://github.com/brodotype-dev/breakerz/pull/106).

**Why now.** The 2026-05-15 title-level JUMBO override rule made the parser correctly classify "HALF CASE JUMBO" titled breaks on full-format products (e.g. 2026 Bowman Baseball with hobby + bd + jumbo SKUs) as `{jumbo: null}`. But it would have *over*-corrected on specialty hobby-only products like Bowman's Best — those breaks are sometimes loosely called "JUMBO" by breakers as a break-size descriptor, not a product format, because there is no jumbo SKU. We needed the parser to know the product's available formats and the brand-line family to disambiguate.

**Taxonomy.** New [lib/product-lines.ts](lib/product-lines.ts) ships ~35 canonical brand-line values with `manufacturer`, `family`, and `is_specialty` flags. Topps · Bowman family (`bowman_flagship`, `bowman_chrome`, `bowman_best`, `bowman_cosmic`, `bowman_draft`, `bowman_sapphire`, `bowman_platinum`, `bowman_mega`), Topps flagship + specialty (`topps_flagship`, `topps_chrome`, `topps_cosmic_chrome`, `topps_finest`, `topps_pristine`, `topps_three`, `topps_heritage`, `topps_stadium_club`, `topps_allen_ginter`, `topps_archives`, `topps_dynasty`, `topps_definitive`, `topps_update`), Panini (`panini_prizm`, `panini_donruss`, `panini_donruss_optic`, `panini_select`, `panini_mosaic`, `panini_immaculate`, `panini_national_treasures`, `panini_contenders`, `panini_obsidian`, `panini_one`, `panini_chronicles`, `panini_certified`), Upper Deck (`upper_deck_series`, `upper_deck_artifacts`, `upper_deck_spx`), and `other`. The list lives in code (not a Postgres enum) so new lines = a TypeScript change, not a migration.

**Schema.** Migration [supabase/migrations/20260516000000_product_line_taxonomy.sql](supabase/migrations/20260516000000_product_line_taxonomy.sql) adds the nullable column and backfills all 16 currently-active products by slug. Applied to prod via Supabase MCP at ship time.

**Forms.** Both product forms — [app/admin/products/NewProductForm.tsx](app/admin/products/NewProductForm.tsx) and [components/admin/ProductForm.tsx](components/admin/ProductForm.tsx) — gain a Product Line dropdown with manufacturer-grouped `<optgroup>`s. Optional field; legacy products without one continue to work, parser just operates without the line hint.

**Parser hookup (the load-bearing part).** [lib/insights-parser.ts](lib/insights-parser.ts) `parseBreakPrice` query now selects `product_line` + per-format case_cost nullability. Product list rendered to the prompt as `- 2025 Bowman's Best Baseball [id: … line=bowman_best formats=hobby]`. New AVAILABLE FORMATS rule takes precedence over the title-level JUMBO rule from the previous slice — a "JUMBO" titled break on a hobby-only specialty product correctly classifies as `{hobby: null}` because the title describes the break NAME, not the product format. Lines containing `_best`, `_chrome`, `_cosmic`, `_finest`, `_pristine`, `_optic`, `_sapphire`, `_platinum` are flagged as soft-hint specialty/hobby-only.

**Future-proofing.** The `product_line` keys decompose cleanly into a future three-dimensional taxonomy (manufacturer / brand / specialty) via the existing flags in `lib/product-lines.ts`. Migration path to "taxonomy full" is now a simple two-column expansion when consumer browse or cross-product anchoring demands it — see BACKLOG entry `Full taxonomy expansion (manufacturer/brand/specialty)` (⚪ optional).

---

## 2026-05-15 — Parser: title-level JUMBO/BD format override

Standalone parser-prompt fix. PR [#105](https://github.com/brodotype-dev/breakerz/pull/105). A Whatnot screenshot titled "HALF CASE JUMBO #2 Random Team auction" produced 30 `asking_price` rows all tagged `{composition: {hobby: null}}` instead of `{jumbo: null}`. The parser prompt had per-slot examples ("Jumbo per-team $800") and a default-to-hobby fallback but no rule that elevated a title-level format keyword to a per-break override.

New TITLE-LEVEL FORMAT OVERRIDE rule added as the FIRST composition rule (highest priority at ship time — later superseded by the AVAILABLE FORMATS rule from PR #106): scan the break title / section header / text repeated on every row, and when JUMBO appears (case-insensitive) classify all emitted rows as `{jumbo: null}` unless a per-row override is stated. Same applies to BREAKER'S DELIGHT / DELIGHT / BD → `{bd: null}`. Tightens the hobby fallback so it only fires when no title override AND no per-row label was found. Adds a dedup note so the parser doesn't emit two rows when the title and a per-row label both say JUMBO.

Prompt-only change. No schema, no API, no migration. Both `/break-price` entry points (slash + message context menu) share the same `parseBreakPrice` path so the fix lands on both.

---

## 2026-05-15 — `/break-price` multi-screenshot slots on the slash command

UX-consistency follow-up to the message context menu shipped earlier. PR [#104](https://github.com/brodotype-dev/breakerz/pull/104). Adds `screenshot2` through `screenshot5` attachment slots to the `/break-price` slash command so multi-image capture works through the same slash-command UX users already know from `/insight`. Handler collects whichever slots are present, parallel-fetches with the existing byte-sniff validation (PNG/JPEG/WebP/GIF), aborts on any failed image with per-slot error reporting, and routes through the same `images: BreakPriceImage[]` path the context menu already uses.

**Tradeoff:** mobile UX is 5 separate gallery picks per slot vs. the context menu's one multi-select dialog. We ship both so single-shot via slash matches `/insight`'s muscle memory, and batch dumps via the context menu stay efficient. Both routes converge on the same parser.

---

## 2026-05-15 — Discord context-menu registration fix

PR [#103](https://github.com/brodotype-dev/breakerz/pull/103). The `"Capture as /break-price"` MESSAGE context-menu command silently dropped from Discord's bulk PUT response on initial registration — registrar reported `Registered 2 command(s)` instead of 3 with no HTTP error. Two suspected causes, fixed both: (1) the slash character in the name (renamed to `"Capture break-price"` — MESSAGE command names display as-registered but `/` namespace-collides with slash commands); (2) `dm_permission: false` is deprecated since 2024 (replaced by `contexts` + `integration_types` — dropped, Discord defaults to guild-only install which matches our use).

Also added a silent-drop detector to [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs): when the response array is shorter than the request array, it lists the missing commands and exits non-zero. Prevents the next regression from looking like a success.
---

## 2026-05-14 — `/break-price` multi-screenshot via message context menu

Adds a Discord MESSAGE context-menu command — "Apps → Capture as /break-price" — that pulls every image attachment off a target message (cap 5) and runs them through `parseBreakPrice` as one batch. Replaces the "fire `/break-price` N times" workflow when an SME is dumping multiple screenshots from the same break. Plan: [docs/plans/2026-05-14-break-price-multi-screenshot.md](docs/plans/2026-05-14-break-price-multi-screenshot.md).

**Why now.** Mobile UX. Picking 5 screenshots through slash-command attachment options means 5 separate gallery dives. Composing one Discord message with 5 attachments is one multi-select. The slash command stays as the single-shot path; context menu is the batch path. Same allowlist, same parser, same staging, same ✅/❌ confirm.

**Mechanics.**
- New command registered in [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) with `type: 3` (MESSAGE context menu). No options — target message is implied by `data.target_id`.
- [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) gains a `data.type === 3` branch routing to new `handleBreakPriceFromMessage`. Reads attachments from `data.resolved.messages[target_id].attachments`, filters to valid image MIME types, soft-caps at 5, parallel-fetches with per-image 5 MB byte cap. One failed image aborts the parse with per-index error reporting — partial proposals aren't honest. Narrative comes from the message content text.
- [lib/insights-parser.ts](lib/insights-parser.ts) `BreakPriceInput` gains an optional `images: BreakPriceImage[]` (each `{ base64, mediaType }`); when set and non-empty, takes precedence over the legacy single-image fields. Loop pushes N `image` content blocks into the Claude call. Prompt addendum tells Claude to treat the images as one capture session and dedupe identical rows (same team + same price + same format = one row).

**Operational rollout.** Re-run `node scripts/register-discord-commands.mjs` after deploy so Discord picks up the new context-menu command. Long-press / right-click any message → Apps → "Capture as /break-price" — bot replies with one combined proposal. The existing `/break-price` slash command stays unchanged for single-shot captures.

**Out of scope.** Numbered-slot slash variant (`screenshot1`, `screenshot2`...). Thread-based collector. Reply-chain capture. Auto-dedupe inside a parse beyond the prompt hint. All deferred per plan.

---

## 2026-05-14 — Side-by-side comparison UI on `/break/[slug]` (execution-roadmap step #3)

Renders observed `/break-price` asks next to our predicted slot fair value, on the consumer surface users already use. The strategic point of BreakIQ — "we say something different from the breaker market" — is now visible in the place the user is making decisions. Plan: [docs/plans/2026-05-14-side-by-side-comparison.md](docs/plans/2026-05-14-side-by-side-comparison.md). Step #3 of [docs/strategy/execution-roadmap.md](docs/strategy/execution-roadmap.md) — flagged as "highest single user-perceived impact in the entire roadmap."

**Slice A — consumer.** TeamSlotsTable rows now show a thin observation sub-row when `/break-price` data exists for that team: range, observation count, source-type split (listings / estimates / sales), recency, composition label when mixed, plus a "Use $X" pre-fill pill that loads the median price into the team's ask input and fires a new `observed_ask_prefilled` PostHog event. When the user has both typed an ask AND there's a ranked observation, a color-coded `vs herd: ±X%` chip appears next to the pill. Composition similarity × recency ranking determines which observations qualify and in what order. Empty teams (no observations) render nothing — clean by default.

**Slice B — admin Δ vs model on captures panel.** New `lib/team-fair-value.ts` exports `getTeamFairValuesForProduct(productId)` and a batched `getTeamFairValuesForProducts(ids[])`. Reads `pricing_cache` + `player_products`, builds PlayerWithPricing-shaped rows, runs the existing `computeSlotPricing` + `computeTeamSlotPricing` from `lib/engine.ts` at a 1-case-of-each reference config, applies lifecycle-aware market markup. `/admin/market-delta` captures panel now has a `Δ vs model` column (color-coded red ≥+20% overcharge / green ≤−20% steal / neutral between) with hover tooltip surfacing the reference fair value. Mixed-composition captures show `—`.

**Refactor surface.** Slice 2b's `lib/observation-context.ts` had three reusable helpers (composition similarity, recency weight, composition rendering) trapped behind a `supabaseAdmin` import. Pulled them into a pure `lib/observation-ranking.ts` so client surfaces can share them. `observation-context.ts` re-imports — zero behavior change for the verdict-enrichment path.

**Wiring.**
- `app/(consumer)/break/[slug]/page.tsx`: ungated the asking-price observation fetch (was gated to pre-release), added `askObservationsByTeam` + `targetComposition` memos, threaded both as new TeamSlotsTable props.
- `components/breakiq/TeamSlotsTable.tsx`: new `askObservations` + `targetComposition` props, private `rankObservations` helper for composition-similarity × recency × top-N pricing, per-team observation sub-row with pill + vs-herd chip.
- `app/admin/market-delta/page.tsx`: captures query now selects `product_id`, one `getTeamFairValuesForProducts` batched call covers every distinct product, new column + hover semantics.
- `lib/posthog-events.ts`: `observed_ask_prefilled` event.

No DB migrations, no API routes, no schema changes. All on existing reads.

**Data reality.** At ship time, prod has 1 asking_price observation. The feature ships anyway because (a) every new `/break-price` capture surfaces immediately, (b) empty teams render nothing, (c) the per-team fair-value rollup that powers Slice B is reusable for future surfaces.

**What's queued (not this PR).**
- `/analysis` standalone deal checker + `<AnalysisResultPanel>` observation overlay (slice C — deferred until ≥10 captures exist to validate UX).
- Composition-aware fair value for mixed-format captures (per-mix engine reference math).
- Filter captures panel by delta bucket (overcharge/steal/neutral).
- "Open break" link on each capture row jumping to the consumer page.

---

## 2026-05-14 — Verdict observation enrichment (slice 2b of composition-observation plan)

Splices recent `/break-price` observations into the AI verdict prompt at request time, gated behind a `feature_flags.verdict_observation_context_enabled` admin toggle. Default off — flipping the toggle on `/admin/market-delta` enables enrichment immediately for every subsequent verdict. Slice 2 of three from [docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md](docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md). Slice 1 (composition + source_type primitives) shipped earlier today; slice 2a (calibration aggregator) deferred until 2b validates data quality.

**What changed.**

- **`feature_flags` table** ([supabase/migrations/20260514150000_feature_flags.sql](supabase/migrations/20260514150000_feature_flags.sql)) — generic `(key, enabled, description, updated_at, updated_by)` shape. RLS on, service-role-only. Seeded with the verdict-enrichment row defaulted to `false`. Missing key = disabled, so the absence of the row is also a safe default.
- **`lib/observation-context.ts`** (new) — `getRecentObservationsForVerdict(productId, targetComposition)` pulls non-superseded `asking_price` observations for the product in the last 30 days, ranks by `compositionSimilarity × recencyWeight`, returns the top 5 plus a prompt-ready text block. Similarity is 1.0 for identical key sets, 0.5 for subset/superset overlap, 0.0 for disjoint — value counts ignored since the engine doesn't need exact ratio match for narrative purposes. Recency is linear decay over the 30-day window. Threshold: when fewer than 3 ranked observations exist, the block is empty and `hasEnough=false` — caller falls back to the unaltered prompt. The rendered block distinguishes listings vs. estimates vs. sales so the narrative can voice them differently.
- **`runBreakAnalysis`** ([lib/analysis.ts](lib/analysis.ts)) reads the flag at request time. When enabled AND `getRecentObservationsForVerdict` returns ≥3, the observation block + explicit grounding instruction splice into the existing prompt's `${observationSection}` slot. Grounding instruction tells Claude: cite ranges/recency where relevant, never name individuals or platforms, don't invent observations not listed, distinguish listing vs. estimate voice. Flag off → byte-for-byte unchanged from prior behavior. New `observationContext: { enabled, applied, observationCount }` field on `AnalysisResult` carries telemetry for the caller.
- **`/api/analysis` route** ([app/api/analysis/route.ts](app/api/analysis/route.ts)) — when `result.observationContext.applied` is true and the request is authed, fires the new PostHog event `verdict_observation_context_applied` with `{ product_id, observation_count, signal }`. Best-effort — wrapped in try/catch so analytics never fail the verdict. Useful for A/B-segmenting beta retention with vs. without enrichment.
- **Admin toggle UI** — new [app/admin/market-delta/VerdictContextToggle.tsx](app/admin/market-delta/VerdictContextToggle.tsx) (client component) rendered above the captures panel on `/admin/market-delta`. Reads initial state server-side, flips via optimistic update + new [app/api/admin/feature-flags/route.ts](app/api/admin/feature-flags/route.ts) GET/PUT (admin-only, allowlisted to the one toggleable key for now). Colocated with captures because that panel is the data the flag governs — eyeballing both at once makes the A/B decision easier.
- **PostHog taxonomy** ([lib/posthog-events.ts](lib/posthog-events.ts)) — adds `verdict_observation_context_applied` to `PH_EVENTS`.

**Backwards compatibility.** Flag off on deploy → prompt is identical to prior behavior. The observation reader has a fallback path for legacy rows still carrying `payload.format` (defense in depth, since the backfill ran on prod earlier today).

**Operational runbook (Slice 2b):**
1. Apply migration via Supabase MCP or `supabase db push`.
2. Deploy this PR. With flag default-off, every verdict is unchanged.
3. Visit `/admin/market-delta`. New "Verdict observation enrichment" toggle appears above the captures panel — confirm initial state is OFF.
4. With the toggle OFF, run `/analysis` on any product → verdict narrative is byte-for-byte unchanged from yesterday's behavior. PostHog `verdict_observation_context_applied` should NOT fire.
5. Flip the toggle ON. Re-run `/analysis` on a Bowman product (where slice 1 observations now exist) — verdict narrative cites a range or pattern naturally, distinguishes listing vs. estimate voice where the data warrants, never names individuals or platforms. PostHog event fires with the observation count.
6. Adversarial check: run `/analysis` on a product where no recent observations exist — narrative softens (no fabricated ranges). Run on a product where the only recent observation has a wildly different composition — narrative either skips citing it or caveats it explicitly.
7. Leave the flag on or off depending on what spot-checks reveal. Beta users see the difference immediately on the next verdict; no client deploy needed.

**Out of scope (still ahead).**
- **Slice 2a**: periodic calibration aggregator that adjusts engine markup constants from observed asks. Don't ship until 2b validates data quality.
- **Slice 3**: structured consumer displays of observations (aggregate range chip on `/break/[slug]`).
- Consumer surface change to display observations directly — slice 2b is prompt-only, the verdict still renders identically with just smarter prose.

---

## 2026-05-14 — Composition + observation source type (slice 1 of composition-observation plan)

Replaces single-`format` on `asking_price` + `odds_observation` observations with a sparse-vector `composition` map (the engine's already-existing primitive for bundles) and adds a derived `source_type` enum that captures the epistemic kind of each observation. Slice 1 of three from [docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md](docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md). Slice 2b (verdict narrative enrichment) ships next; slice 2a (calibration aggregator) is deferred.

**Why now.** Dan Reed's `/break-price` IG DM screenshot ("Bowman delight/hobby — 20 delight 5 hobby per slot") parsed as 23 single-format `'hobby'` rows. Market Delta Watch comparing $625 Diamondbacks against a pure-hobby fair value is meaningless when the ask covers a bundled mix. Either we drop the SME data (anti-feedback-loop) or we model composition properly. A first-draft plan proposed adding `'mixed'` to `BreakFormat`, but that's a meta-classification stapled onto an enum — the engine and break-log schemas already use composition vectors, so bringing observations into that shape is the structurally honest fix.

**The new primitive** ([lib/types.ts](lib/types.ts)):
- `SlotComposition` = `Partial<Record<BreakFormat, number | null>>`. Single key with null value = pure-format slot, ratio unspecified. Multi-key = bundled mix. Values are case counts when explicitly stated, null when "format involved, ratio unknown."
- `ObservationSourceType` = `'competitor_listing' | 'breaker_estimate' | 'historical_sale'`. Orthogonal to the existing `source` channel.
- `deriveSourceType(source)` — deterministic mapping from existing `source` enum: `stream_ask` / `ebay_listing` / `other` → `competitor_listing`, `social_post` → `breaker_estimate`. Trade-off accepted per plan section 3: not 100% accurate (a `social_post` could be a competitor's tweet), but deterministic + zero classification cost. Revisit with an explicit slash-command override if slice 2a calibration shows drift.
- `BreakFormat` stays untouched. "Mixed" is never a stored value — it's a display computation via `renderComposition()` on the few admin surfaces that need a single-token label.

**Parser changes** ([lib/insights-parser.ts](lib/insights-parser.ts)):
- `asking_price` and `odds_observation` ParsedUpdate types swap `format: BreakFormat` → `composition: SlotComposition`. Other update kinds (sentiment, hype_tag, risk_flag, *_sentiment cascade) untouched.
- New `validateComposition()` exported helper. Both `parseInsights` and `parseBreakPrice` use it during validation. At least one valid format key, values null or positive integer ≤ 50.
- New `renderComposition()` exported helper for proposal previews and admin chips. `{hobby: null}` → `"hobby"`, `{hobby: 3}` → `"hobby ×3"`, `{bd: 20, hobby: 5}` → `"bd 20 + hobby 5"`, `{bd: null, hobby: null}` → `"bd + hobby"`.
- Both prompts get a `COMPOSITION RULES` block with the example mapping table + explicit "use bd for delight" rule.
- `parseBreakPrice` drops the "multi-format bundle → return empty" rejection rule (~old line 919). Multi-format bundles now emit a single row with multi-key composition. The multi-team bundle drop rule stays — that's a different shape.
- `summarizeUpdate` renders composition + source channel inline: `Yankees slot (bd 20 + hobby 5, social_post): asking $6,500 — Dan Reed IG`.

**Apply path** ([app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)):
- `applyUpdates` writes `payload.composition` and `payload.source_type = deriveSourceType(source)` for both `asking_price` and `odds_observation`. JSONB column — no schema migration.
- `payload.format` is no longer written. Legacy rows that still have it get rewritten by the backfill script.

**Backfill script** ([scripts/backfill-composition.mjs](scripts/backfill-composition.mjs)):
- One-time rewrite of legacy `market_observations` rows: `{format: 'hobby'}` → `{composition: {hobby: null}, source_type: 'competitor_listing'}` + drop `format`. Defaults to dry-run; `--commit` to write. `--reverse` undoes a backfill in emergency.
- `--clean-dan-reed-mode` deletes the 23 mis-classified Bowman Baseball asking_price rows captured from Dan's IG DM before composition shipped (filter: `observation_type='asking_price'` ∩ product name LIKE `%Bowman%Baseball%` ∩ `source='social_post'` ∩ `observed_at < --dan-cutoff`, default cutoff `2026-05-14T03:00:00Z`). Per plan section 6: delete rather than backfill a guessed composition. Dan re-submits via `/break-price` after deploy.

**Market Delta Watch surface** ([app/admin/market-delta/page.tsx](app/admin/market-delta/page.tsx)):
- `/break-price captures` panel chips now render composition (`hobby ×3` / `bd 20 + hobby 5`) instead of single format. Mixed compositions render in orange to flag them at a glance.
- Distribution counter at top of the panel: `N pure-format · M mixed · N_listing listings · N_estimate estimates · N_sale sales` — lets the operator see capture shape distribution without scrolling.
- Source-type filter pills (All / Listings / Estimates / Sales) wired to `?source_type=…` URL param. Anchor tags so the page stays server-rendered. Legacy rows with no `source_type` field show "—" in the kind column and aren't matched by any of the typed filters.

**Backwards compatibility.** Legacy rows in `market_observations` keep their `payload.format` until the backfill script runs. The admin panel reads composition with a `parseCompositionFromPayload()` helper that falls back to `format` when `composition` is absent — so the panel renders correctly during the rollout window. No consumer surface today reads observations directly, so consumer behavior is unchanged.

**Operational runbook (Slice 1):**
1. Deploy this PR. New writes from `/insight` + `/break-price` immediately use the new shape; reads tolerate either shape.
2. Run the backfill dry-run on staging first: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backfill-composition.mjs`. Eyeball the planned mutations.
3. Run live on staging: same command with `--commit`. Verify a sample row in DB now has `composition` + `source_type` and no `format`.
4. Run live on prod: same command with `--commit`.
5. Run Dan Reed cleanup: `node scripts/backfill-composition.mjs --commit --clean-dan-reed-mode`. Expect ~23 rows deleted.
6. Ping Dan to re-submit via `/break-price` so the rows come back with proper `composition: {bd: 20, hobby: 5}`.

**Out of scope (still ahead).**
- **Slice 2b** (~1-2 days out): AI verdict narrative enrichment via `getRecentObservationsForVerdict()`. Gated behind a new `feature_flags.verdict_observation_context_enabled` toggle so we can A/B with vs. without enrichment during beta.
- **Slice 2a** (deferred): periodic calibration aggregator that adjusts engine markup constants from observed asks. Don't ship until 2b validates the data quality.
- **Slice 3** (deferred): structured consumer displays of observations (aggregate range chip on `/break/[slug]`).

---

## 2026-05-13 — Beta launch messaging PR3: nav restructure + empty-state CTAs + onboarding microcopy + jargon tooltips

PR3 of three — the "polish" PR. Wraps up the beta-launch messaging refresh. PR1 (positioning) and PR2 (feedback loops) shipped earlier today.

**ConsumerNav restructure** ([app/(consumer)/ConsumerNav.tsx](app/(consumer)/ConsumerNav.tsx)). Desktop nav (md+) now reads the workflow: **Breaks / Research / Slabs** (discovery cluster) → **+ Log a Break** (filled blue primary CTA — the central act of the management-tool frame) → divider → **Chase / My Breaks / Profile** (manage cluster) → admin / sign-out. On `md` the destination labels collapse to icons; on `lg` the full labels are visible. Mobile gets a duplicated **+ Log** pill next to the hamburger so logging is one tap from anywhere even on phone. Mobile sheet groups destinations under "Discover" / "Manage" headers and pins "Log a Break" at the top. Two new helpers (`NavLink`, `MobileNavLink`) factor the repetition.

**My Breaks deep-link** ([app/(consumer)/my-breaks/page.tsx](app/(consumer)/my-breaks/page.tsx)). Reads `?view=new` and `?view=log` from the URL via `useSearchParams` so the primary "Log a Break" CTA lands the user directly on the new-break form. Falls back to the list when the param is absent.

**Empty-state CTAs.** My Breaks empty state gains two buttons: primary **Research a break** → `/analysis` (filled blue), secondary **Log a previous break** → `setView('log')`. Plumbed via a new `onStartLog` prop on `BreakList`. `/chase` empty state gains a **Browse breaks** link to `/`. Both keep the existing explanatory copy.

**Onboarding microcopy** ([app/(consumer)/onboarding/page.tsx](app/(consumer)/onboarding/page.tsx)). New small `<Why>` helper renders a single-line "why we ask" under each Label. Wired up for: *"What do you collect?"* (highlight breaks for these sports first), *"Where do you usually break?"* (drives default platform when logging), *"Monthly hobby spend"* (calibrates BUY/WATCH/PASS thresholds), *"Best pull?"* (pure brag bait). Step 1 gets a one-line workflow preview above the age gate: *"BreakIQ is your break terminal — research, decide, log, learn. Let's set you up."* Step 3 CTA renamed from "Let's Go" → **"Show me my dashboard"** — names the payoff.

**Jargon tooltips.** New [components/breakiq/ds/InfoTip.tsx](components/breakiq/ds/InfoTip.tsx) — small "?" icon with CSS-only hover/focus tooltip. Dropped next to first-mention labels: **Format mix** on `/analysis`, `/break/[slug]`, and `/my-breaks` ("How many cases of each break type."); **EV Low / EV Mid / EV High / Max Pay** on PlayerTable headers; **Latest EV Mid** on `/chase`. EV Mid copy: *"Estimated value at PSA 9 — the most-traded grade for modern cards."*

**Nothing else of consequence.** No DB migrations. No API contract changes. The verdict reframe (PR1), feedback loops (PR2), and now nav + empty states + onboarding + glossary (PR3) finish the messaging-refresh trilogy.

---

## 2026-05-13 — Parser: /break-price truncation salvage + literal-price rule

Two parser fixes uncovered by a real-world `/break-price` capture: Dan Reed's Bowman Baseball 2026 IG DM screenshot (18 team rows) returned "Couldn't extract a slot ask" with debug `parsedRaw=0, hadImage=true, drops=1, Dropped: no JSON array in response`. Claude was actually parsing every row correctly — the response was being truncated mid-object because `max_tokens: 1024` couldn't hold 18 × ~250-token asking_price rows, the closing `]` never came, and the `/\[[\s\S]*\]/` regex bailed throwing away ~17 valid entries that were sitting in the buffer.

**parseBreakPrice** ([lib/insights-parser.ts](lib/insights-parser.ts)). Three changes:

1. **`max_tokens: 1024 → 8192`.** Fits ~30 asking_price rows comfortably; enough headroom for any realistic price-sheet screenshot. Cost ceiling per call is still well under $0.005 on Haiku 4.5.
2. **`salvageJsonArrayObjects(raw)` helper** replaces the all-or-nothing `[…]` regex + JSON.parse. Strips a `\`\`\`json … \`\`\`` markdown fence if present (Haiku does this often), finds the opening `[`, walks the body character-by-character tracking string state and brace depth, parses each top-level `{…}` independently. Stops at first `]` at depth 0 OR end-of-string. Returns whatever objects parsed cleanly — partial last entry is silently dropped. Old behavior threw all 18 rows away when the closer was missing; new behavior keeps the 17 that completed and surfaces a `response appeared truncated` reason in the debug payload so contributors see what happened.
3. **Prompt clarified** to distinguish a price-SHEET (N rows, each its own slot) from a multi-team BUNDLE (single combined ask). Old wording "ONE asking_price row per call. Multiple rows ONLY if the screenshot shows multiple discrete slot listings" was ambiguous against Dan Reed's row-per-team format; new wording calls out the distinction explicitly with examples. Also adds a `NARRATIVE + SCREENSHOT INTERACTION` rule — narrative is product/source context first, per-row override second; does NOT cap row count.

**parseInsights** also gets a literal-price rule on the asking_price section. Same-day fix as the [Ohtani $700 → $700000](#) bug from earlier — Claude was scaling "$700.00" to 700000 by interpreting `.00` as a thousands separator (or by silently rejecting the price as implausibly low for a /25 parallel and substituting). Prompt now spells out: literal dollar amount as written, `.` is decimal/cents not thousands, do not scale up because a price seems low.

The salvage helper is exported so future parser additions can reuse it.

---

## 2026-05-13 — Beta launch messaging PR2: feedback-loop framing + home footer real stats

PR2 of the three-PR beta-launch messaging refresh. The "retention" PR — turns silent contribution into a visible loop, makes "feedback is the feature" credible during beta when the model is honestly imperfect and SME tuning IS the product.

**PricingFeedback** ([components/breakiq/PricingFeedback.tsx](components/breakiq/PricingFeedback.tsx)). Two changes: (1) one-line helper under the 👎 popover header — *"We retrain pricing weekly from breaker reports."* — names what the input does. (2) Success state replaces the generic "✓ Thanks" with *"Logged for the next pricing pass"* — names the change the user just caused.

**ChaseHeartButton first-save hint** ([components/breakiq/ChaseHeartButton.tsx](components/breakiq/ChaseHeartButton.tsx)). First successful save in a browser session fires a one-time floating hint next to the heart: *"Saved — find them on My Chase ↗"* (clickable, links to `/chase`). Persists via `localStorage.breakiq_chase_first_save_seen=1` and auto-hides after 4.5s. Surfaces the payoff (personalized `/chase` page) that users otherwise have to discover by hunting through the nav. Profile-column migration for the flag is queued post-beta — localStorage is fine for beta scale.

**My Breaks copy** ([app/(consumer)/my-breaks/page.tsx](app/(consumer)/my-breaks/page.tsx)). (1) Under "How did it go?" — *"Logged outcomes sharpen the model on your favorite formats."* (2) Under "Was our take helpful?" (renamed from "Was our analysis helpful?" for consistency with the new verdict framing from PR1) — *"Helps us calibrate BUY/WATCH/PASS for breaks like this."* (3) Post-save: a brief 1.2s confirmation banner inside the form before the card collapses — *"Saved — your record + take feedback are in."* or *"Saved — your win/bust record updated."* depending on whether analysis feedback was included. Names what changed instead of fading silently.

**Home footer real stats** ([app/(consumer)/page.tsx](app/(consumer)/page.tsx)). Replaced the vague *AI / 24/7* placeholders with real numbers pulled at page render: (1) `liveCount` products live (already real, kept). (2) Breaks logged in the last 7 days from `user_breaks` (non-abandoned). (3) Community insights applied this month from `pending_insights` where `status='applied'` since the start of the current UTC month. Makes the management-tool loop visible in aggregate; doubles as social proof for the beta cohort.

**No new schema, no API contract changes.** Two parallel Supabase `count: 'exact'` queries on the home page are cheap, indexed, and run in parallel with the existing products query.

**Out of scope for PR2** (queued for PR3): ConsumerNav restructure with primary "Log a Break" CTA, empty-state CTAs on `/my-breaks` and `/chase`, onboarding microcopy, jargon tooltips.

---

## 2026-05-13 — Beta launch messaging PR1: positioning spine + verdict reframe + beta banner

PR1 of the three-PR beta-launch messaging refresh from `~/.claude/plans/2026-05-13-beta-launch-messaging-refresh.md`. The "existential" PR — without it, beta opens with the wrong promise and verdicts users can't yet trust. PR2 (feedback loop framing) and PR3 (nav + onboarding polish) ship next.

**Naming sweep.** "BreakIQ Bets" / "BreakIQ Sayz" → "BreakIQ Insights" across every consumer-facing surface (waitlist pricing tiers, `/analysis` hero, `/subscribe` plan features). The admin debrief tool renamed in parallel: "BreakIQ Bets" → "BreakIQ Insights Debrief" in `/admin/products/[id]` and `/admin/breakiq-betz` (admin nav label + page title). The `/admin/breakiq-betz` URL path stays put — renaming the route is a separate migration. The Discord `/insight` command name is untouched — verb-shaped, already a habit for the contributor allowlist, and changing it would require re-registration with no user-value payoff. Mental model: "BreakIQ Insights" is the noun for the verdict feature; `/insight` is the verb for contributing one.

**Positioning spine.** New two-line stack used everywhere the product introduces itself:
- **Hook:** *"Stop buying breaks blind."* — pain-led, drives the click
- **Descriptor:** *"Every break you buy, in one place — research it, log it, learn from it."* — workflow-led, sets honest expectations

Applied to: [app/manifest.ts](app/manifest.ts) (PWA description), [app/layout.tsx](app/layout.tsx) (metadata title + description + OpenGraph + Twitter card — first time OG/Twitter were configured at all), [app/waitlist/page.tsx](app/waitlist/page.tsx) (H1 + sub), [app/(consumer)/page.tsx](app/(consumer)/page.tsx) (home hero H1 + sub), [app/(consumer)/subscribe/page.tsx](app/(consumer)/subscribe/page.tsx) (sub-line above plan grid), [app/auth/signup/SignupForm.tsx](app/auth/signup/SignupForm.tsx) (sub copy).

**Verdict reframe.** [components/breakiq/AnalysisResultPanel.tsx](components/breakiq/AnalysisResultPanel.tsx) — verdict block prefixed with a small "Our take" label above the BUY / WATCH / PASS badge; new one-line attribution sub below: *"Based on CardHedger comps + our lifecycle-aware pricing model. Flag us if it's off — we tune from every report."* BUY/WATCH/PASS color treatment intact (per Brody's confirmation — soften language, not the badge). CTA verb on `/analysis` and `/break/[slug]` inline analysis softened from "Analyze Bundle" → "Run the check"; loading state from "Analyzing Deal…" → "Reading the comps…".

**BetaBanner component.** New [components/breakiq/BetaBanner.tsx](components/breakiq/BetaBanner.tsx). Thin, dismissible banner: *"Our model is learning from every break logged. Tell us when our take is off — we're tuning with every flag."* Dismissal persists via `localStorage.breakiq_beta_banner_dismissed=1` (cheap-and-cheerful for beta; profile column migration queued post-beta). PostHog `beta_banner_dismissed` event with `surface` property for segmentation. Rendered on three surfaces where beta users are most likely to land on a verdict they can't yet fully trust: home (above hero), `/break/[slug]` (top of main), and `/analysis` (above the Back-to-Home link).

**Out of scope for PR1** (queued for PR2 / PR3): feedback-loop microcopy on PricingFeedback / ChaseHeartButton / My Breaks save confirmations, home footer real stats, nav restructure ("Log a Break" primary), empty-state CTAs, onboarding helpers, jargon tooltips. None of those block beta launch — PR1 covers the existential pieces.

**Operational.** No DB migrations. No API contract changes. All edits are text/JSX. Revertable per-file. PostHog `beta_banner_dismissed` event added to the canonical taxonomy in [lib/posthog-events.ts](lib/posthog-events.ts).

---

## 2026-05-13 — `/break-price` product autocomplete (step #2 polish)

Follow-up to the step #2 ship earlier today. First-day usage surfaced the most common reason for empty parses: SMEs typed short narratives ("Dodgers 625 hobby Whatnot") without naming the product, and Claude correctly refused to guess across 16 active products. Defeats the "zero typing" goal.

**Fix.** Added a `product` option to `/break-price` with Discord autocomplete (`autocomplete: true`). User types a few chars → Discord pings our route with `APPLICATION_COMMAND_AUTOCOMPLETE` (type 4) → we respond within 3s with up to 25 matching active products, ranked by year DESC. New `handleAutocomplete()` in [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts) handles the lookup; new `APPLICATION_COMMAND_AUTOCOMPLETE_RESULT` (type 8) constant added to [lib/discord.ts](lib/discord.ts) for the response payload.

When the user picks a product, the resolved `product_id` flows through `handleBreakPrice` → `parseBreakPrice({ productId })`. In the parser, the candidate-products query is scoped to just that one product, and the prompt tells Claude the contributor PINNED the product so don't infer it. Removes the most common reason for empty captures.

Product remains optional — leaving it out falls back to Claude inferring from narrative/screenshot (which works fine when the narrative names the product explicitly, or when a screenshot has the product in its UI).

**Backlog updates** ([docs/BACKLOG.md](docs/BACKLOG.md)). Marked P1 entries #1, #2, and #6 as ✅ SHIPPED with notes on what shipped vs. the original plan (the original plan for step #2 was admin-paste UI; the actual ship was Discord-first). Step #3 (side-by-side comparison UI on `/break/[slug]`) is now flagged as ⏭ NEXT UP and is the natural follow-on now that captures are flowing.

**Operational.** Re-run [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) after deploy to push the new schema to Discord — the autocomplete flag is part of the command definition, not just the handler.

---

## 2026-05-13 — Execution roadmap step #2: `/break-price` Discord slash command (text + vision capture)

Replaces the original "admin paste UI" sketch of step #2 with a Discord-first design — meets SMEs where their eyeballs already are (watching streams) and reuses the entire Phase 2 `/insight` infrastructure for staging + confirmation + apply.

**New slash command** `/break-price` with three options: `narrative` (string, optional), `screenshot` (attachment, optional), `notes` (string, optional). At least one of narrative/screenshot is required. Registered via [scripts/register-discord-commands.mjs](scripts/register-discord-commands.mjs) — re-run with `DISCORD_APP_ID` + `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` env vars to push to Discord. The screenshot option (type 11) resolves to a Discord CDN URL in `data.resolved.attachments`; the dispatcher fetches it, base64-encodes, and feeds into Claude vision.

**Parser** ([lib/insights-parser.ts](lib/insights-parser.ts)). New `parseBreakPrice()` function next to `parseInsights()`. Single-purpose: emit `asking_price` ParsedUpdate rows only — no sentiment, no risk, no hype. Builds Claude messages with `[{ type: 'image', source: { type: 'base64', media_type, data } }, { type: 'text', text: prompt }]` when a screenshot is present. Uses Haiku 4.5 (vision-capable, $0.002/image vs Sonnet's $0.005). Roster-aware: pre-loads active products + player names so Claude can return canonical product_id and scope_player_id. Validates every row against the roster, drops anything with bad scope/format/source/price-range. Empty array on multi-team or multi-format bundles per the edge-cases doc.

**Discord dispatcher** ([app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)). New `handleBreakPrice()` function. Resolves attachment from `data.resolved.attachments[attachmentId]`, validates MIME type (PNG/JPEG/WebP/GIF), enforces 5 MB cap, fetches the Discord CDN URL, base64-encodes, calls `parseBreakPrice`. Stages proposed updates to the existing `pending_insights` table with the same ✅/❌ button flow as `/insight` — so the apply path (which already supports `asking_price`) doesn't fork. Allowlist check identical to `/insight`. Reply renders "Slot ask from @handle: > narrative (+ screenshot)" with the proposed rows below.

**Market Delta Watch surface** ([app/admin/market-delta/page.tsx](app/admin/market-delta/page.tsx)). New "/break-price captures" panel below the existing per-product breakdown. Lists the most recent 50 `market_observations.asking_price` rows with their product / scope / format / price / source. Resolves player names for player- and variant-scoped rows. Doesn't yet compute delta vs. current pricing — that's a follow-up requiring per-team fair-value lookup from `pricing_cache`. v1 surface is "did the capture pipeline flow?", not "what does the delta look like?"

**Edge cases doc** ([docs/edge-cases.md](docs/edge-cases.md)). New running log for documented-but-deferred edge cases. Seeded with three entries:
- **Multi-team bundle asks** ("Yankees + Red Sox + Dodgers $2,400"): Claude returns empty array. Brody's hunch — the right answer is a `break_config_id` concept tying multiple team-rows together as a bundle, but defer until either the `needs_human_review` queue gets noisy or step #3 needs bundle deltas.
- **Multi-format bundle asks** ("$5k for 1 hobby + 2 BD"): same treatment. Cleanest later answer is a `bundle` observation_type with `formats: { hobby, bd, jumbo }` in payload.
- **Price ranges** ($600-700): handled — schema already supports `price_low` + `price_high` separately.

**Why Discord-first instead of admin UI.** Eyeballs already there (watching Whatnot/Fanatics streams from phone), zero context switch, mobile-friendly, reuses Phase 2 audit chain (pending_insights → confirmed → market_observations with source attribution). Net: ~5 hours of work instead of 1-2 days for an admin form, and better-shaped for the actual use case.

**Operational steps to enable.** (1) Re-run `register-discord-commands.mjs` against the prod guild after deploy. (2) Existing allowlist (`discord_contributors` table) gates access — no per-command allowlist needed. (3) First capture should be a smoke test from Brody to confirm Discord ↔ Vercel ↔ Claude vision works end-to-end.

**Next up.** Step #3 — side-by-side comparison UI on `/break/[slug]`. With observations now flowing in, the comparison surface has a real source. Per-team fair-value query that powers the comparison can be reused on the captures panel for the delta column. Follow-up: auto-apply on high-confidence single-product captures (skip the ✅ step) once we have feedback from real usage.

---

## 2026-05-12 — Execution roadmap steps #1 + #6: Market Delta Watch + Consumer Audit Trail

Two coordinated shipments that execute the first and sixth items of the [execution roadmap](docs/strategy/execution-roadmap.md). Step #1 validates the herd-mispricing thesis before further investment; step #6 surfaces the multi-source moat so Track A and Track B (Phase 2, entry below) aren't invisible work when their bumps go operational.

**Market Delta Watch** ([app/admin/market-delta/page.tsx](app/admin/market-delta/page.tsx)). New admin surface at `/admin/market-delta` that computes `(ask_price − snapshot_fair_value) / snapshot_fair_value` across every `user_breaks` row with both numbers logged (excluding abandoned). No new schema — the data has been accumulating since 2026-04-09 when My Breaks v1 first froze a snapshot at break-log time. The page renders four layers: (1) a thesis verdict that reads the P90 absolute delta — Sample too thin / Herd is tight (thesis weak) / Material spread / Wide spread (thesis confirmed); (2) headline stats — observation count, mean + median delta, overcharge % (delta > +20), steal % (delta < −20); (3) a 7-bucket distribution histogram from Steal+ to Overcharge+; (4) a per-product breakdown showing where spread is concentrated, plus a recent-50 observation list with bucket colors. Nav entry added to [app/admin/AdminNav.tsx](app/admin/AdminNav.tsx). Server component, pure read — no CH calls, no Claude calls, just the database. This is the answer to "if the delta distribution is centered on zero, BreakIQ is a CardHedger wrapper and the rest is moot."

**Consumer audit trail — "Why this price?"** New [components/breakiq/WhyThisPriceCard.tsx](components/breakiq/WhyThisPriceCard.tsx) renders inside [PlayerDetailDrawer](components/breakiq/PlayerDetailDrawer.tsx) above the variants table when an `audit` prop is provided. Decomposes the slot price into five visible layers: (1) Baseline EV from CardHedger sales aggregate (raw → PSA 9 → PSA 10); (2) Math-layer lifecycle multiplier — `RELEASE_PREMIUM` (×1.15) for pre-release products, `freshnessMultiplier()` decay for first-30d-live, neither for dormant; (3) Score modulation rows shown only when non-zero — Track A (prospect rank + source string), SME sentiment (with `breakerz_note`), AI buzz, dominant risk flag, hype tag — each colored by sign with the running `effectiveScore` below; (4) Pool allocation showing this player's weight share + model slot cost; (5) Display-layer market markup with the final number. Confidence/estimated/icon/HV chips below. Pure render component — pulls all numbers from the `PlayerWithPricing` row already in memory on the break page, no new fetches. Threaded from `/break/[slug]` via the new `audit` prop on PlayerDetailDrawer; the drawer keeps working without it so non-break surfaces (e.g. chase list, future surfaces) can render variants alone.

**Coordination note for Phase 2 cascade reader (entry below).** Track B's `cascade_score_adj` is now plumbed through `computeEffectiveScore` and `computeSlotPricing`. The audit card does NOT yet surface a dedicated "Team / Product / Team×Product cascade" row — that's the Phase 3 transparency UI slice. Until then, cascade contributions fold silently into pool weight and appear inside the "Effective score" total. Phase 3 will add per-scope rows alongside the existing Prospect / SME / AI / Risk / Hype rows.

**Why these two together.** Per Principle 1 of the execution roadmap: build the moat *after* you've surfaced it. Track A's prospect-rank engine landed in #85 but isn't moving prices yet — flipping the multiplier on before audit trail would be invisible work. Per Principle 2: validate the thesis cheaply before investing. Market Delta is half a day of admin work; it answers whether everything downstream is worth building.

**Next up.** Step #2 (live ask-price ingestion, admin-paste path v1) is the foundation for steps #3 (side-by-side comparison UI) and #7 (Discord bot). Order isn't accidental — without observed asks at scale, the comparison UI has nothing to show, Market Delta runs on too-thin data, and in-stream verdicts can't reference market. In parallel, Phase 3 transparency UI surfaces Track B cascade contributions in the audit card.

---

## 2026-05-12 — Phase 2 of prospect attrs + cascading sentiment: Track B Discord parser + cascade reader

Third slice of [docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md](docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md). Adds the engine-side cascading-sentiment reader and the Discord-parser extension so SMEs can drop team / product / team-product takes via `/insight` and have them fold into slot pricing.

**Schema** ([supabase/migrations/20260512200000_market_observations_cascade.sql](supabase/migrations/20260512200000_market_observations_cascade.sql)): `market_observations.product_id` relaxed to nullable so global team_sentiment rows can exist without a product. The CHECK constraint on `observation_type` extended to accept three new values: `team_sentiment`, `product_sentiment`, `team_product_sentiment`. Existing writers always supply `product_id`, so the relaxation does not silently break them. Migration applied to prod via Supabase MCP + repair.

**Cascade reader** ([lib/cascading-sentiment.ts](lib/cascading-sentiment.ts)): new module exposes `loadCascadeObservations(productId)`, `filterObservationsForPlayer(all, team)`, and `computeCascadeAdjustment({ observations, sportSlug })`. Each scope contributes `direction × strength × SCOPE_CAP × linearDecay` per observation — same shape as `computeHypeAdjustment` — with per-scope caps (team_product_sentiment ±0.25, team_sentiment ±0.20, product_sentiment ±0.15). Three caps sum to the combined ±0.65 ceiling; that combined value × per-sport multiplier (`baseball 1.0 / basketball 0.9 / football 0.7 / hockey 0.6`) yields the engine adjustment. Returns a full `CascadeBreakdown` with per-scope subtotals + decorated rows for the Phase 3 transparency UI.

**Engine threading** ([lib/engine.ts](lib/engine.ts), [lib/types.ts](lib/types.ts)): `computeEffectiveScore` accepts an optional 7th arg `cascadeScoreAdj` (default 0). `computeSlotPricing`'s inline `effectiveScore` reads `p.cascade_score_adj` alongside the existing risk + hype + prospect modulators. `PlayerWithPricing` gains `cascade_score_adj?: number`.

**Compute sites:**
- [lib/analysis.ts](lib/analysis.ts) — bulk-fetches cascade observations once via `loadCascadeObservations`, then `filterObservationsForPlayer` per pp before `computeCascadeAdjustment`. Runs in parallel with the existing flags + hype fetches.
- [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx) — client-side equivalent: two parallel supabase queries (product-scoped cascade + global team_sentiment) merge into a single observation list, then per-player filter + compute. No new round-trips beyond the two queries.

**Discord parser** ([lib/insights-parser.ts](lib/insights-parser.ts)): `ParsedUpdate` union gains three new kinds — `team_sentiment`, `product_sentiment`, `team_product_sentiment`. Claude prompt extended with three new numbered sections (6 / 7 / 8) plus an explicit "cascade vs hype_tag" differentiation rule (canonical hype labels stay in hype_tag; general bullish/bearish takes land in the new cascade kinds). Roster validation includes a case-insensitive team-name set so cascade rows with unknown teams get dropped at parse time. Neutral takes (direction missing) also get dropped to keep the engine signal tight.

**Discord dispatcher** ([app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)): new case in the apply path writes the three new types to `market_observations` with payload `{ direction, strength, decay_days, tag? }`, scope_type matching the dominant axis (`team` / `product`), and product_id only set for the product-scoped kinds. Decay clock matches the observation's `decay_days`.

**Pure additive ship.** Behavior on existing live products is unchanged until the first cascade observation is captured via Discord — `cascade_score_adj` is `0` for every player_product right now.

**Coordination with the strategy reframe (entry below).** [docs/strategy/execution-roadmap.md](docs/strategy/execution-roadmap.md) Principle 1 says consumer audit trail UI ships BEFORE engine bumps go operational. Phase 2 is engine-side only and contributes zero to slot math until the first cascade observation lands. The ordering concern is still valid for operational rollout — Phase 3 (transparency UI) is the gating step before Discord contributors start dropping observations that move real slot prices users see.

**Out of scope (still ahead):** bulk-sentiment Markdown importer + Claude skill for launch-time SME analyses (Phase 2.5), transparency UI showing per-contribution attribution (Phase 3).

**Files:**
- New: [supabase/migrations/20260512200000_market_observations_cascade.sql](supabase/migrations/20260512200000_market_observations_cascade.sql), [lib/cascading-sentiment.ts](lib/cascading-sentiment.ts)
- Modified: [lib/engine.ts](lib/engine.ts), [lib/types.ts](lib/types.ts), [lib/analysis.ts](lib/analysis.ts), [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx), [lib/insights-parser.ts](lib/insights-parser.ts), [app/api/discord/interactions/route.ts](app/api/discord/interactions/route.ts)

---

## 2026-05-12 — Product strategy reframe + execution roadmap (docs only, framing layer)

No code shipped in this entry. A strategic reset that codifies the **lens** every Phase 1A/1B and future implementation should be evaluated under. Prompted by a thread between Brody and Kyle pressure-testing "how do we objectively quantify if something is a good deal." Two insights together reshape how BreakIQ should evolve:

**1. The market herds, and the herd is wildly wrong.** Live breakers price slots by copying each other — one stream priced 2026 Bowman Pirates at $625 vs. Kyle's ~$1,900 estimate (3x undervalued); another priced Red Sox at $6,000 vs. Kyle's $2,600 (2.3x overvalued). BreakIQ's core role is *the differentiated voice with receipts at the moment of decision*, not a fair-value calculator. New value prop: **"Stop overpaying breakers."**

**2. We've been tuning a piano with the lid closed.** Every model constant we've shipped is a hypothesis without a feedback loop. Until users log actual pulls, we can't measure whether the engine is right — only whether it's internally consistent. Two-stage measurement framework: Stage 1 (Market Delta, available today from `user_breaks.ask_price` + `snapshot_fair_value`) bridges to Stage 2 (Recovery Ratio, requires My Breaks Phase 2 pull capture).

**Three-doc strategy trilogy in new `docs/strategy/` folder:**
- [`north-star-and-feedback-loop.md`](docs/strategy/north-star-and-feedback-loop.md) — five candidate metrics with tradeoffs, ranked by honesty; recommended north-star (Recovery Rate per User) + operational metric (Market Delta until pull data lands); variance-honesty stance; open questions list
- [`product-strategy-map.md`](docs/strategy/product-strategy-map.md) — Reforge 6-dimension strategy map filled out for BreakIQ. Sharper target audience (serial PYT participants on Whatnot / Fanatics Live, 3+ breaks/month, $500+ monthly spend). Locked value prop with "before you claim the slot" wording
- [`execution-roadmap.md`](docs/strategy/execution-roadmap.md) — the 10-step execution sequence ordered by strategic clarity per engineering day; gap analysis mapping each strategic claim to required product change; order-of-operations principles ("Build the moat AFTER you've surfaced it"); session-continuity reading order

**[CLAUDE.md](CLAUDE.md) reframed.** New "Product Strategy — read first" section near the top so future sessions ground in positioning + north star before reading anything else. Docs index extended with the strategy folder + the prospect-attrs plan. Cold-start reading order documented (~17 minutes to full strategic context).

**[BACKLOG.md](docs/BACKLOG.md) reordered.** Six P1 entries promoted, ordered to match the execution roadmap:
- **P1 #1** Market Delta Watch — Stage 1 measurement, available today (~½ day)
- **P1 #2** Live ask-price ingestion (admin-paste path v1) — foundation for #1, #3, #7
- **P1 #3** Side-by-side comparison UI on `/break/[slug]` — visible form of "differentiated voice"
- **P1 #4** Pull-Data Capture in My Breaks — Stage 2 measurement unblocker
- **P1 #6** Consumer audit trail UI ("Why this price?") — **must ship BEFORE Track A's bumps go operational** per Principle 1
- **P1 #7** In-Stream Delivery (Discord bot v1) — meets users at moment of decision
- **P2 #9** Confidence bands in UI — variance-honesty stance from Kyle's "level of gambling" point

**Important coordination note with Phase 1A/1B (entries below).** Phase 1A and 1B shipped the prospect_score engine + importer before the consumer audit trail UI (roadmap step #6). Per [execution-roadmap.md Principle 1](docs/strategy/execution-roadmap.md), that's an ordering violation we should resolve before operational rollout. **The violation is currently potential, not realized**: the migration is unapplied to prod and the Kyle CrossRef script hasn't been run with `--commit`. Resolution before that operational step: ship roadmap step #6 (consumer audit trail UI) so users can see WHY the engine starts emitting bumped numbers.

**What this changes about in-flight work:**
- The prospect_score / cascading sentiment plan is still right; Phase 1A/1B are correct work — they just need step #6 to land alongside before going operational
- Every tuning constant in the engine should be documented inline with its HYPOTHESIS so Stage 2 data (when it lands in 60-90 days) can validate or revise each one empirically
- Pull-data capture (My Breaks Phase 2) graduates from "deferred consumer feature" to "P1 unblocker for measurable success"

No code shipped in this entry. Pure context-setting: strategy docs, plan refinements, BACKLOG reorder, CLAUDE.md reframe, the execution roadmap that ties all of it together.

---

## 2026-05-12 — Phase 1B of prospect attrs + cascading sentiment: Track A importer + Kyle CrossRef ingest script

Second slice of [docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md](docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md). Phase 1A wired the engine; this commit adds the bulk-importer path and a one-shot script to load Kyle's 2026 Bowman CrossRef data.

**Importer** ([app/api/admin/import-prospect-ranks/route.ts](app/api/admin/import-prospect-ranks/route.ts)): POST endpoint accepting `{ source, dryRun, rows: [{ sport, player_name, prospect_rank?, prospect_status?, team? }] }`. Validates every row up-front (no bail-on-first-error), fuzz-matches `player_name` to existing `players` rows within the sport (Levenshtein ≤ 2 on normalized names), uses `team` as tiebreaker when multiple candidates tie, and reports every outcome — `written`, `dryrun_matched`, `unmatched`, `ambiguous`, `invalid`, or `sport_unknown` — back in `perRow` for admin review. Auth: admin cookie OR `Bearer ${CRON_SECRET}` (so the one-shot script can run server-to-server). Update statement only writes columns the row explicitly provides — a status-only row won't blank out an existing rank, and vice versa.

**Source-attribution governance.** Per the plan, Track A is institutional-only. Source strings must contain one of an allowlist of institutional keywords (Pipeline, ESPN, Big Board, Central Scouting, McKenzie, PFF, Kiper, Jeremiah, 247Sports, EliteProspects, TSN, MLB, NHL, NFL, NBA, Baseball America). "Kyle" rejects with a 400 explaining that subjective contributions belong in Track B Discord `/insight`. The Kyle CrossRef import uses `"MLB Pipeline May 2026 via Kyle CrossRef"` — keyword `pipeline` carries the institutional warrant, the trailing fragment is human-readable provenance.

**Fuzz-match utility** ([lib/fuzz-match-players.ts](lib/fuzz-match-players.ts)): exports `normalizePlayerName` (lowercase + NFD diacritic-strip + punctuation-strip — `Dončić` → `doncic`, `Lombard Jr.` → `lombard jr`), iterative `editDistance` Levenshtein, `loadPlayersForSport` (one query per sport, reused across the whole batch), and `matchOne` (tier ladder: exact → ≤ N edit distance → team-tiebreaker → ambiguous). Ambiguous results never write — left for admin review.

**Kyle CrossRef ingest script** ([scripts/import-kyle-crossref.mjs](scripts/import-kyle-crossref.mjs)): reads `~/Downloads/2026_Bowman_BreakIQ_CrossRef.xlsx` (Players (Full) sheet), parses the "Top 100" column into `{ prospect_rank, prospect_status }` — numeric → rank, "Graduated MLB" → `graduated_rc`, "NPB signee (ineligible)" → `international_signee`, "Top 100 (Mar '26 add)" → skipped (no precise rank). Posts to `/api/admin/import-prospect-ranks` with `dryRun: true` by default; pass `--commit` to actually write. Expected counts per plan: 17 ranked + 6 graduated_rc + 3 international_signee = 26 writes. Andrew Fischer skipped pending a precise rank from a later Pipeline release.

**Out of scope (still ahead):** Track B Discord parser extension (Phase 2), bulk-sentiment Markdown importer + Claude skill (Phase 2.5), transparency UI (Phase 3).

**Blocked on Brody before this is operational:**
1. `supabase db push` to apply the 20260512180000 migration to production. The importer code expects those columns.
2. Run `BREAKIQ_URL=https://www.getbreakiq.com CRON_SECRET=... node scripts/import-kyle-crossref.mjs` to inspect the dry-run, then `--commit` once the row results look right.

**Files:**
- New: [app/api/admin/import-prospect-ranks/route.ts](app/api/admin/import-prospect-ranks/route.ts), [lib/fuzz-match-players.ts](lib/fuzz-match-players.ts), [scripts/import-kyle-crossref.mjs](scripts/import-kyle-crossref.mjs)

---

## 2026-05-12 — Phase 1A of prospect attrs + cascading sentiment: Track A engine wire-up

First slice of [docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md](docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md). Plan splits subjective vs. objective player signals into two governance tracks:

- **Track A — Objective:** prospect rank + status from institutional sources (MLB Pipeline, ESPN Big Board, NHL Central Scouting, etc.). Bulk-importable; attribution is the institution, not a person.
- **Track B — Subjective:** team / product / team-product sentiment via Discord `/insight` (or bulk-import with per-row personal attribution for launch analyses). Out of scope for this commit.

This commit is Track A's engine wire-up — schema + module + threading only, no importer, no actual data ingest yet. Effective scores are unchanged on every player until prospect_rank gets populated.

**Schema** ([supabase/migrations/20260512180000_players_prospect_attributes.sql](supabase/migrations/20260512180000_players_prospect_attributes.sql)): 4 nullable columns on `players` — `prospect_rank` (integer), `prospect_status` (CHECK in `'graduated_rc' | 'international_signee' | NULL`), `prospect_rank_source` (institutional provenance string), `prospect_rank_updated_at`. One sport-agnostic column set; per-sport interpretation lives in the source string and the per-sport multiplier in the score module. Migration **NOT YET APPLIED to production** — awaiting Brody's `supabase db push`.

**Scoring module** ([lib/prospect-score.ts](lib/prospect-score.ts)): `computeProspectAdjustment({ prospect_rank, prospect_status, sportSlug })` returns the additive bump folded into `effectiveScore`. Constants per the plan: rank tier ladder (top-10 → +0.60, top-30 → +0.40, top-100 → +0.20), status bumps (graduated_rc +0.15, international_signee +0.10), sport multipliers (baseball 1.0, basketball 0.9, football 0.7, hockey 0.6), cap +0.70.

**Engine threading** ([lib/engine.ts](lib/engine.ts)): `computeEffectiveScore` gains an optional 6th arg `prospectScoreAdj` (default 0 — every existing 3-arg / 5-arg caller continues working unchanged). The inline `effectiveScore` calc inside `computeSlotPricing` reads `p.prospect_score_adj` alongside the existing risk + hype adjustments, so slot-cost math picks up the bump automatically for any player with prospect_rank populated.

**Types** ([lib/types.ts](lib/types.ts)): `Player` gains optional `prospect_rank` / `prospect_status` / `prospect_rank_source` / `prospect_rank_updated_at`. `PlayerWithPricing` gains optional `prospect_score_adj` — runtime modulator, not persisted in pricing_cache (matches the existing risk/hype pattern).

**Computation sites** — same render-time pattern as risk/hype, no pricing-refresh changes needed:
- [lib/analysis.ts](lib/analysis.ts) computes per-pp `prospect_score_adj` using `product.sport.slug` + `p.player.prospect_rank` + `p.player.prospect_status`, attaches alongside the existing risk + hype augmentation
- [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx) does the same for the live break page

**Out of scope (next commits):** importer (`/api/admin/import-prospect-ranks`), Kyle's CrossRef CSV ingest, Track B Discord parser extension, cascade reader, transparency UI. See plan for the full Phase 2/2.5/3 split.

**Files:**
- New: [supabase/migrations/20260512180000_players_prospect_attributes.sql](supabase/migrations/20260512180000_players_prospect_attributes.sql), [lib/prospect-score.ts](lib/prospect-score.ts), [docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md](docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md)
- Modified: [lib/engine.ts](lib/engine.ts), [lib/types.ts](lib/types.ts), [lib/analysis.ts](lib/analysis.ts), [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx)

---

## 2026-05-11 — Import-checklist page no longer crashes when an API returns a non-string error

Brody hit a React #31 ("Objects are not valid as a React child, found: object with keys {code, id, ...}") while running CH match on the import-checklist page. The page renders four error states (`parseError`, `importError`, `matchError`, `oddsError`) as direct JSX children. All four setters assigned `json.error` straight from the API response without coercion — so any time the server returned a structured error (Postgrest, Anthropic envelope, etc.) instead of a string, React would blow up and the whole page would go to the "Application error" fallback.

**Fix** ([app/admin/import-checklist/page.tsx](app/admin/import-checklist/page.tsx)): new `asErrorMessage(value, fallback)` helper coerces any value to a renderable string — returns `value.message` or `value.error` if those are strings, otherwise `JSON.stringify(value)`, otherwise the fallback. Applied at every `set*Error(json.error ?? ...)` site. Now the page surfaces the underlying error instead of crashing, which lets us actually diagnose what the server returned.

**Root cause on the server side is still open.** The defensive fix unblocks the UI; next pass is to find which call inside `/api/admin/match-cardhedger` (or its CH / Claude / Supabase dependencies) returned an `{code, id, ...}` envelope, and fix the source so the error message is human-readable.

---

## 2026-05-11 — Inline Break Analysis block on the product page

UX change: `/break/[slug]`'s "Format Mix" card was just three case counters + a break-cost rollup. Replaced with a full **Break Analysis** block that runs the same bundle analysis as `/analysis` without leaving the product page — pre-selected since we're on the product. Same flow Kyle uses on `/analysis` (format mix → team chip multi-select → searchable player picker → ask price → Run → AI verdict + market ask range + top players + risk flags), now reachable directly from any product without re-picking the product.

**Shared `<AnalysisResultPanel>`.** Extracted the result-rendering UI from `/analysis/page.tsx` into [components/breakiq/AnalysisResultPanel.tsx](components/breakiq/AnalysisResultPanel.tsx) so both surfaces render the verdict identically. New prop `productSlug?: string | null` hides the "View full break analysis →" link when the panel is already rendering on the break page (otherwise it self-links). `signalConfig` + `FLAG_LABELS` + `AnalysisResult` interface migrated alongside; the local `AnalysisResult` type alias in `/analysis/page.tsx` now imports from `lib/analysis.ts`. Removed ~150 lines of duplicate UI code.

**Inline block.** [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx) gains state for `selectedAnalysisTeams`, `selectedAnalysisPlayerIds`, `analysisAskPrice`, `analysisPlayerSearch`, `analysisRunning`, `analysisResult`, `analysisError`. Format counters reuse the existing `config` state — single source of truth across the analysis block AND the slot tables below (one config drives both). Submits to `POST /api/analysis` with the same payload `/analysis` sends; result renders inline within the same bordered card via `<AnalysisResultPanel result={...} productId={product.id} />` (no slug, no link). PostHog `break_analysis_run` event fires with `surface: 'break_page_inline'` so we can segment per-surface conversion. Gated on `!isDormant` (matching the old format-mix block).

**Team / player picker reuse.** `<TeamChip>` from the design system handles team selection; the searchable player picker mirrors the `/analysis` shape (Search icon + 8-row dropdown + chip removal). Players already covered by a selected team are hidden from the picker to avoid double-counting in the bundle math.

**`/analysis` stays.** Standalone deal checker preserved for cross-product comparison and people who start at the deal checker rather than a product page. Both surfaces produce identical results.

**Files:**
- New: [components/breakiq/AnalysisResultPanel.tsx](components/breakiq/AnalysisResultPanel.tsx)
- Modified: [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx), [app/(consumer)/analysis/page.tsx](app/(consumer)/analysis/page.tsx)

---

## 2026-05-11 — Quick wins: catalog cron observability + confidence tiering

Two low-friction follow-ups to the trilogy.

**Catalog cron observability.** `app/api/cron/refresh-ch-catalogs/route.ts` only called `recordCronRun()` at the end of the serial loop, which sat past Vercel's `maxDuration=300s` for any night with 17+ sets. The cron always ran successfully (verified via `ch_set_refresh_log`) but the admin Cron Status panel rendered "Catalog Refresh: NEVER RUN" because the summary insert never got reached. Fix: new `recordCronStart()` helper in [lib/cron-log.ts](lib/cron-log.ts) inserts a `success=true` marker row at the top of the route. If the function completes, the final `recordCronRun` summary supersedes it; if it times out, the marker stays as the most-recent row and the panel correctly shows "healthy · ran X minutes ago." Pure observability — no behavior change to the cron itself.

**Confidence tiering on the player table.** `pricing_cache.confidence` has populated since 2026-05-06 (P0.2 of the CH audit) but rendered as a binary "low conf" chip below 0.5. Replaced with named tiers per Card Ladder's pattern: Strong ≥ 0.7 (green), Solid 0.5–0.7 (neutral), Stale 0.2–0.5 (amber), Cold < 0.2 (red). New `confidenceTier()` helper in [lib/engine.ts](lib/engine.ts) returns `{ tier, label, bg, fg, border }` so the same row reads consistently anywhere it gets surfaced later (PlayerDetailDrawer will pick this up when it surfaces a per-player confidence indicator). Fallback-priced rows still skip the chip — the existing `est` chip already signals that case.

**Files:**
- Modified: [lib/cron-log.ts](lib/cron-log.ts) (new `recordCronStart` export), [app/api/cron/refresh-ch-catalogs/route.ts](app/api/cron/refresh-ch-catalogs/route.ts), [lib/engine.ts](lib/engine.ts), [components/breakiq/PlayerTable.tsx](components/breakiq/PlayerTable.tsx)

---

## 2026-05-11 — Pricing trilogy Plans B + C: market markup display + lifecycle EV multiplier

Completes the 2026-05-11 pricing trilogy. Plan A (per-product anchor configurator) shipped earlier today and addressed the EV-aggregation half of Kyle's $1,447 Royals slot complaint. Plans B and C address the other two halves: (B) pure-EV slot prices systematically signal BUY on market-fair asks because real breaker asks sit 15–40% above pure EV, and (C) pre-release products + first-2-weeks-live products need release-window math that 90-day-average aggregates can't capture (Cooper Flagg $9,500 → $2,500 in 10 days). The two layers compound legitimately — Plan C math layer reflects "what these cards are worth in this lifecycle window" and lands in `pricing_cache`; Plan B display layer reflects "what the breaker charges for a slot above that" and applies at render time.

**Plan B (display layer).** New [lib/market-markup.ts](lib/market-markup.ts) exports `MARKET_MARKUP_BY_LIFECYCLE = { pre_release: 1.40, live: 1.20, dormant: 1.05 }` + `MARKET_MARKUP_RANGE = 0.10` + `getMarketMarkup()` + `buildMarketRange()`. [lib/analysis.ts](lib/analysis.ts) `runBreakAnalysis` returns both `fairValue` (pure-EV, unchanged shape, still what `user_breaks.snapshot_fair_value` persists) and `marketFairValue` / `marketFairLow` / `marketFairHigh` / `lifecycleStatus`; `computeSignal` now runs against `marketFairValue` so the BUY/WATCH/PASS signal reflects how breakers actually price. Claude prompt clarified to distinguish "Pure model fair value" from "Market-adjusted fair value (signal reference)." Display change: [components/breakiq/PlayerTable.tsx](components/breakiq/PlayerTable.tsx) and [components/breakiq/TeamSlotsTable.tsx](components/breakiq/TeamSlotsTable.tsx) accept a `marketMarkup` prop (default 1.0 = no change for any caller that doesn't yet pass it); slot cost cells render the market-adjusted value as the primary number with a small grey "model $X" sub-line beneath, and TeamSlotsTable's `computeSignal(slotCost × markup, askPrice)` keeps the team-row deal checker consistent with bundle math. [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx) passes `getMarketMarkup(lifecycle)` to both tables. [app/(consumer)/analysis/page.tsx](app/(consumer)/analysis/page.tsx) result card replaces the single "Fair Value" stat with a "Market Ask Range" headline ($low–$high · model $pure). No DB migration. No `pricing_cache` change.

**Plan C (math layer).** Same [lib/market-markup.ts](lib/market-markup.ts) extended with `RELEASE_PREMIUM = 1.15`, `FRESHNESS_PREMIUM = 0.20`, `FRESHNESS_HALFLIFE_DAYS = 10`, `freshnessMultiplier()`, and `lifecycleEvMultiplier()` — pre-release multiplies snapshot-derived EV by 1.15 (modest, since Plan B already adds 1.40 on display); live multiplies by `1 + (FRESHNESS_PREMIUM × decay(daysSinceLive, halflife))` which peaks at 1.20 on day 0 and settles to 1.00 past day 30; dormant unchanged. New migration [20260512170000_products_live_since.sql](supabase/migrations/20260512170000_products_live_since.sql) adds `products.live_since timestamptz` (nullable) and backfills to `created_at` for currently-live products — anything already past the 30-day floor gets multiplier=1.0 anyway, so no behavior change for the existing fleet. [app/admin/products/actions.ts](app/admin/products/actions.ts) `setProductLifecycle` stamps `live_since = now()` only on `pre_release → live` transitions; `dormant → live` reactivations deliberately don't reset the freshness clock. [lib/pricing-refresh.ts](lib/pricing-refresh.ts) loads `lifecycle_status` + `live_since` once at refresh entry, computes `lifecycleMultiplier`, and applies it via a small `applyMultiplier(lo, mid, hi)` helper at all seven `cacheRows.push` sites (primary aggregated path + 3 hydrated fallbacks + 3 non-hydrated fallbacks). `RefreshSummary` extended with `lifecycleStatus` + `lifecycleMultiplier`; terminal log line now includes `lifecycle=live mult=1.200`.

**Why these compound, not double-stack.** Math layer answers "what's this card actually worth right now in this lifecycle window?" — that belongs in the cache and feeds slot pricing. Display layer answers "what does the breaker charge on top of that?" — that's the breaker's margin, applied at render. A pre-release product in the live break view shows pure-EV × 1.15 (math) × 1.40 (display) ≈ 1.61× of pure EV; that matches Kyle's observed release-week asks. Without splitting them, you'd have to pick: either bake markup into cache and lose the ability to display the pure model, or apply both at display and have cron-cached slot prices ignore the lifecycle.

**Backward compatibility.** Default lifecycle is 'live' wherever the column is missing. PlayerTable + TeamSlotsTable `marketMarkup` prop defaults to 1.0 so any admin caller that doesn't pass it renders unchanged. `pricing_cache` writes go through the new multiplier — values from the previous refresh stay until the next refresh overwrites them naturally (24h TTL). Pure `fairValue` still ships in `AnalysisResult` so `user_breaks` snapshots and admin tooling that reference it keep working.

**Verification (post-migration apply).** (1) Pick a live product with healthy CH data, trigger pricing refresh, expect EV values ~20% higher than pre-Plan-C (1.20 default-live multiplier). Cron log should show `lifecycle=live mult=1.200`. (2) `/break/[slug]` slot prices visibly rise ~20% with "model $X" beneath. (3) A known BUY-signaling break in `/analysis` shifts to WATCH or PASS. (4) Toggle a product `pre_release → live` in admin; verify `live_since` stamps to now() and next refresh shows `lifecycle=live mult=1.200`. Hand-edit `live_since` 10 days back, refresh — expect `mult=1.100`. 30+ days, expect `mult=1.000`. (5) PostHog `pricing_feedback_submitted` category=`pricing_too_low` share should trend down over the following week.

**Files:**
- New: [lib/market-markup.ts](lib/market-markup.ts), [supabase/migrations/20260512170000_products_live_since.sql](supabase/migrations/20260512170000_products_live_since.sql)
- Modified: [lib/analysis.ts](lib/analysis.ts), [lib/pricing-refresh.ts](lib/pricing-refresh.ts), [lib/types.ts](lib/types.ts), [app/admin/products/actions.ts](app/admin/products/actions.ts), [components/breakiq/PlayerTable.tsx](components/breakiq/PlayerTable.tsx), [components/breakiq/TeamSlotsTable.tsx](components/breakiq/TeamSlotsTable.tsx), [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx), [app/(consumer)/analysis/page.tsx](app/(consumer)/analysis/page.tsx)

---

## 2026-05-11 — Per-product anchor configurator (Plan A of the pricing-model trilogy)

Triggered by the 2026-05-11 Kyle call: he flagged that Bowman draft sapphire slot prices were systematically low, with `Bobby Witt Jr.` slot showing $121 against his $350–400 gut. Diagnosed three separate issues tangled together: (1) CH catalog gap for `2025 Bowman Draft Sapphire` causing fallback to Chrome Sapphire variants, (2) the engine averaging EV across every variant including thin-comp 1/1s and SuperFractors, (3) no allowance for the breaker markup over pure EV. This change addresses #2 by making per-player EV aggregation configurable per product, via a conversational Claude configurator. (1) is part of the [CardHedger data audit P0.1](docs/plans/2026-05-06-cardhedger-data-audit.md); (3) is the planned but un-shipped [Plan B — market markup](docs/plans/2026-05-11-slot-price-market-markup.md).

**Aggregation strategies.** New [lib/pricing-anchors.ts](lib/pricing-anchors.ts) exports `aggregatePlayerEV(variantEVs, strategy, patterns) → AggregatedEV` with three implementations: `sets_weighted_all` (today's default — sets-weighted average across every priced variant), `curated_variants` (filter to variants matching configured regex patterns, sets-weighted over the filtered subset), and `curated_with_tail` (curated subset + `CURATED_TAIL_BONUS = 0.15` representing long-tail option value). Fallback rule: if a curated strategy yields zero matched variants, fall back to `sets_weighted_all` with `fellBack: true` on the result — never zero out a slot on misconfiguration.

[lib/pricing-refresh.ts](lib/pricing-refresh.ts) now loads the product's `anchor_strategy` + `anchor_variant_patterns` once at top of `refreshProductPricing` and dispatches per `player_product`. Variant query selects `variant_name` so the dispatcher can pattern-match. `RefreshSummary` gains `anchorStrategy`, `anchorFellBackCount`, `anchorMatchedVariantsAvg`; the terminal log line surfaces them.

**Schema.** Migration [20260511180000_product_anchor_strategy.sql](supabase/migrations/20260511180000_product_anchor_strategy.sql) adds three columns to `products` (all defaulting to current behavior): `anchor_strategy text` (check-constrained to the three values), `anchor_variant_patterns text[]` (regex strings), `anchor_config_notes text` (conversation rationale).

**Conversational configurator.** [`ManufacturerDescriptor`](lib/card-knowledge/types.ts) extended with `anchorConcepts?: AnchorConcept[]` — a structured list of named anchor concepts (e.g. for Bowman: `base auto`, `gold refractor auto /50`, `color auto /250`, `first bowman raw`, `sapphire base auto`). Concepts are the standardization layer per manufacturer family; the resulting regex patterns are unique per product. [bowman.ts](lib/card-knowledge/bowman.ts) and [panini.ts](lib/card-knowledge/panini.ts) populate this; other descriptors will fill in as products are configured.

[app/admin/products/[id]/anchor-config/page.tsx](app/admin/products/[id]/anchor-config/page.tsx) + [AnchorConfigClient.tsx](app/admin/products/[id]/anchor-config/AnchorConfigClient.tsx) render the chat UI. [app/api/admin/anchor-config/route.ts](app/api/admin/anchor-config/route.ts) bundles a system prompt with manufacturer descriptor, product context (name, year, lifecycle), 20 sample variant names from the product, and current `(strategy, patterns, notes)`. Admin types plain English, Claude returns strict-JSON `{ strategy, patterns, notes, rationale }`, the page renders a live preview using cached variant prices via `ch_price_cache` lookups (no CH calls). Preview shows top 5 players' current EV vs. proposed EV with delta and percentage, so the admin can A/B test before saving.

Save = publish. The product row gets `(strategy, patterns, notes)` updated; next pricing refresh (within 24h via cron or immediately via the existing "Refresh Pricing" button) applies the new strategy. Old `pricing_cache` rows get overwritten naturally — 24h TTL.

[app/admin/products/[id]/page.tsx](app/admin/products/[id]/page.tsx) gains a "Pricing Anchor Strategy" section between the workflow card and Import Odds, showing current strategy + patterns + notes with a "Configure →" link.

**Defaults.** Everything ships with `anchor_strategy = 'sets_weighted_all'` and empty patterns — zero behavior change for existing products until Kyle configures them. No big-bang switch.

**Plan A of three.** This change ships Plan A from the [2026-05-11 pricing trilogy](docs/plans/2026-05-11-per-product-anchor-configurator.md). Plan B (market markup display, planned) and Plan C (release/freshness decay, planned) live in sibling docs and the [icebox](docs/icebox.md) tracks deferred ideas (per-sale time-weighted pricing, per-product chase rule library, asking-price → fair-value calibration, build-vs-buy CH revisited).

**Files:**
- New: [supabase/migrations/20260511180000_product_anchor_strategy.sql](supabase/migrations/20260511180000_product_anchor_strategy.sql), [lib/pricing-anchors.ts](lib/pricing-anchors.ts), [app/api/admin/anchor-config/route.ts](app/api/admin/anchor-config/route.ts), [app/admin/products/[id]/anchor-config/page.tsx](app/admin/products/[id]/anchor-config/page.tsx), [app/admin/products/[id]/anchor-config/AnchorConfigClient.tsx](app/admin/products/[id]/anchor-config/AnchorConfigClient.tsx), [docs/plans/2026-05-11-per-product-anchor-configurator.md](docs/plans/2026-05-11-per-product-anchor-configurator.md), [docs/plans/2026-05-11-slot-price-market-markup.md](docs/plans/2026-05-11-slot-price-market-markup.md), [docs/plans/2026-05-11-release-freshness-decay.md](docs/plans/2026-05-11-release-freshness-decay.md), [docs/icebox.md](docs/icebox.md)
- Modified: [lib/pricing-refresh.ts](lib/pricing-refresh.ts), [lib/card-knowledge/types.ts](lib/card-knowledge/types.ts), [lib/card-knowledge/bowman.ts](lib/card-knowledge/bowman.ts), [lib/card-knowledge/panini.ts](lib/card-knowledge/panini.ts), [app/admin/products/[id]/page.tsx](app/admin/products/[id]/page.tsx), [CLAUDE.md](CLAUDE.md)

---

## 2026-05-10 — Topps Series 1/2 split: derived productScope fallback predicate

Investigation triggered by Kyle flagging that Topps Series 1 Baseball break analysis was pulling Series 2 data. Diagnosed, planned, and implemented same-session. Full plan at [docs/plans/2026-05-10-topps-series-split.md](docs/plans/2026-05-10-topps-series-split.md); BACKLOG entry promoted to P0 in [docs/BACKLOG.md](docs/BACKLOG.md). New CH question Q14 in [docs/cardhedger-questions.md](docs/cardhedger-questions.md) flagging that CH has no `2025 Topps Series 1 Baseball` canonical set name — only the parent `2025 Topps Baseball` covering both Series 1 and Series 2.

**Root cause (verified via DB probes 2026-05-10).** The scoping mechanism already exists — [`player_products.checklist_card_numbers`](lib/variants-from-catalog.ts:144) is populated by the import-checklist parser and consumed by `hydrateVariantsFromCatalog` as a strict per-pp allow-list. The 2026-04-21 catalog pre-load architecture comment explicitly calls out: "This is what scopes Topps S1 vs S2 when they share a ch_set_name." **Scoped pps are pristine** — Judge/Ohtani/Trout/Witt all have 100% of variants matching their checklist. The leak comes entirely from **500 unscoped pps** auto-created via Phase 3 of the hydrate flow. Auto-created pps had no entry in `attachPredicateByPpId`, so the `if (predicate && !predicate(...))` guard at [variants-from-catalog.ts:250](lib/variants-from-catalog.ts) short-circuited and every CH row attached. **Verified leak: 12,112 numeric variants on 500 unscoped pps** (10,525 in S2 range 331–660, 1,587 above 660, plus 1,613 ambiguous-series inserts).

**Insert overlap check.** Spot-checked Aaron Judge's actual Series 1 insert codes (`T90-57`, `T90C-82`, `HA-1`, `MEGA-8`, etc.). Topps continues insert numbering across Series 1 and Series 2 rather than restarting per series — insert overlap is not a meaningful concern for Topps Baseball.

**Design self-correction.** First-pass plan was to add `products.card_number_filter jsonb` as a primary scoping mechanism with admin UI and `{numeric_min, numeric_max, include_prefixes, exclude_prefixes}` JSONB shape. User pushed back: *"we don't actually have a problem, except for the leakage — even for future products, is that correct?"* Correct. The bug is one fallback path in one function. Derived `productScope` (union of `checklist_card_numbers` across the product's scoped pps) is sufficient. No schema, no admin UI, no per-product config — and it automatically handles every future "subset product" case (2026 Bowman Chrome / Prospects consolidation, etc.) as soon as we import its own checklist.

**Implementation ([lib/variants-from-catalog.ts](lib/variants-from-catalog.ts)):**
1. Compute `productScope = Set<string>` as the union of `checklist_card_numbers` across scoped pps at hydrate time.
2. `productScopePredicate = n => productScope.has(n)` when scope is non-empty; `() => true` when empty (preserves today's behavior for brand-new products before first checklist parse).
3. Replace the permissive `() => true` fallback in the per-pp predicate map with `productScopePredicate`.
4. Pre-filter Phase 3 auto-create discovery: skip CH rows whose `card_number` is outside `productScope`.
5. Set `productScopePredicate` on each auto-created pp explicitly so the attach phase has a defined predicate (closes the `predicate && !predicate(...)` short-circuit).
6. `HydrateResult` extended with `productScopeSize` + `phase3FilteredByScope` for admin observability.

**Admin UI ([app/admin/products/[id]/HydrateVariantsButton.tsx](app/admin/products/[id]/HydrateVariantsButton.tsx)):**
- New `scope: N` chip next to the run summary when `productScopeSize > 0`, indicating the safety net is active.
- Filter count surfaced inline (`{N} out-of-scope CH rows filtered`).
- Tooltip on the chip explains why scope is bounded by `checklist_card_numbers`.

**Backward compatible.** Empty scope falls back to today's permissive predicate, so single-set products (the entire current production fleet except Topps Series 1) are unaffected.

**Operational steps (still to do):**
1. Re-import 2025 Topps Series 1 checklist (populates `checklist_card_numbers` for the legitimate Series 1 base players currently in the unscoped bucket).
2. Re-hydrate Series 1 from admin UI. Expected outcome: variant count drops from 43,213 to ~28K–30K (scoped surface).
3. Re-run pricing refresh on Series 1.
4. Create 2025 Topps Series 2 Baseball product, import its checklist, hydrate.

**Files:**
- Modified: [lib/variants-from-catalog.ts](lib/variants-from-catalog.ts), [app/admin/products/[id]/HydrateVariantsButton.tsx](app/admin/products/[id]/HydrateVariantsButton.tsx)
- New: [docs/plans/2026-05-10-topps-series-split.md](docs/plans/2026-05-10-topps-series-split.md)
- Updated: [docs/BACKLOG.md](docs/BACKLOG.md), [docs/cardhedger-questions.md](docs/cardhedger-questions.md), [CLAUDE.md](CLAUDE.md)

---

## 2026-05-09 — Card Ladder analysis, CH question slate expansion + Graded-0 bugfix on player profile

**Card Ladder competitor teardown.** Kyle shared three CL methodology docs. Stored under [docs/competitor-intel/](docs/competitor-intel/) with a side-by-side analysis at [cardladder-vs-breakiq-analysis.md](docs/competitor-intel/cardladder-vs-breakiq-analysis.md). Verdict: **Grade Ratio Value** (per-card historical PSA 10 / Raw / PSA 9 multipliers) is worth investigating as a P2 follow-up — it directly replaces our hard-coded `evMid × 2.5` and `× 0.35` fallbacks with card-specific ratios, biggest accuracy win on chase parallels. Player-index infrastructure (CL's "Card Ladder Value" + divisor math) intentionally **not** adopted — duplicates what CardHedger already gives us; we don't have the 10-year sales DB to make it competitive. Three actionable items added to [BACKLOG.md](docs/BACKLOG.md): Confidence display polish (P1, pure UI), Grade Ratio Value (P2, blocked on CH Q13), Index-rolled-forward stale pricing (P2, lower priority).

**CH question slate.** New P1.5 section in [docs/cardhedger-questions.md](docs/cardhedger-questions.md):
- **Q11:** Is `grade` on `/v1/cards/comps` filtering or weighting? *(Investigated — confirmed it filters cleanly; results below.)*
- **Q12:** Is there a player-scoped sales feed? Today both [`/api/player-profile`](app/api/player-profile/route.ts) and [`/api/player-comps`](app/api/player-comps/route.ts) fan out up to 45 calls per page-view.
- **Q13:** Per-card cross-grade history endpoint to enable Grade Ratio Value.

**Graded-0 bugfix on player profile.** Investigation root-caused the "RAW 25 · GRADED 0" empty state on `/player/[id]` for Victor Wembanyama. Direct CH probes against all 22 candidate cards × 3 grades returned **149 raw + 19 PSA 9 + 27 PSA 10 sales** — the data was there. The bug was downstream: [app/api/player-profile/route.ts:224](app/api/player-profile/route.ts) merged all grades into one pool, sorted by date desc, and **sliced to 25 globally**. Raw is ~3× the volume of graded for active players, so the most-recent-25 ended up entirely raw. Client splits the response by grade for the Raw/Graded tab toggle — graded came back empty.

Fix: dedupe first, then bucket by grade group BEFORE the slice. Each bucket caps at 25 independently. Response is now up to 50 entries (25 raw + 25 graded) instead of 25 globally; client splits the same way and both tabs surface real sales. Same number of CH calls, no change to the call shape, no breaking response change (still `recent_comps: Comp[]`). [PlayerDetailDrawer's `/api/player-comps`](app/api/player-comps/route.ts) only queries PSA 8/9/10 so it isn't affected by the same bug — left alone.

**Note on Q11/Q12 follow-up.** Q11 is now answered (filter works) but Q12 and Q13 still stand — fan-out architecture is fragile, and we don't have the cross-grade history endpoint we'd need for Grade Ratio Value. Both go on the next CH check-in agenda.

---

## 2026-05-09 — Slab Analysis cert-mismatch guard

First reported case of Slab Analysis returning the wrong-card comp: a 1992 Skybox Michael Jordan PSA 9 image returned a Ken Griffey Jr. 1990 Score Rising Stars #3 PSA 10 from CardHedger. Pipeline turned out to have worked correctly — Claude vision OCR misread the cert number off the slab, PSA's database has cert `99687660` registered to the Griffey, and the CH search dutifully found that Griffey. Confirmed against PSA's public cert lookup at psacard.com/cert/99687660.

**Fix** ([app/api/card-lookup/route.ts](app/api/card-lookup/route.ts), [app/(consumer)/card-lookup/page.tsx](app/(consumer)/card-lookup/page.tsx)): when the image-parse path fires `Look Up by Cert`, the page now sends the parsed `playerName` and `year` along with the cert. The API normalizes both sides (lowercase + alpha-only player name, 4-digit year extract) and compares them to PSA's `Subject` / `Year`. On disagreement, the route short-circuits — no CardHedger search, no comps, no max-bid — and returns a `mismatch: { kind, expectedPlayer, expectedYear, psaPlayer, psaYear }` payload. Page renders a red banner naming both cards and asks the user to re-check the cert number; price/comp/max-bid panels are hidden so the user can't act on the wrong card. PSA Verified panel stays visible so the user sees what PSA's data actually says for that cert.

**Player match is permissive** (`a === b || a.includes(b) || b.includes(a)`) so legitimate "Mike Jordan" / "Michael Jordan" parses don't trip the guard. Year match is strict — a 4-digit mismatch is never a real card. Direct-cert path (no parsed identity) is unaffected; PSA stays authoritative there.

**Telemetry.** New `slab_analysis_cert_mismatch` event in [lib/posthog-events.ts](lib/posthog-events.ts) captures cert + parsed-vs-PSA identity on every trip. Existing `slab_analysis_lookup_completed` event also gains a `mismatch` field so we can segment lookup quality. Watch this for OCR reliability over time — if the rate climbs, we've got a Claude prompt or image-quality issue to dig into.

**Why a soft check, not a stricter OCR retry.** This was the first reported case in months of usage. The cross-check costs nothing (we already had both sources of truth in hand) and catches both OCR misreads and any future PSA database weirdness. A retry/confidence-score loop would be more code for a problem we've seen exactly once.

---

## 2026-05-09 — Per-CH-card price cache + incremental flush (timeout-safe pricing refresh)

Production regression repair. Diagnosis of cron_run_log on 2026-05-09 showed the same pattern across 2 days of refresh-pricing crons: 5 firings/night, every firing reports `processed=4 ok=1 errors=3 skipped=15`. Same three big products (2024 Panini Donruss Optic with 471 PPs / never priced; 2025 Topps Pristine Baseball; 2025-26 Topps Finest Basketball) timed out every time, the orchestrator picked them up the next firing, they timed out again. **19 of 20 active products were stale, most by 66–92 hours.** Last successful refresh on those big products was the morning of 2026-05-06 — right before the multi-grade audit shipped that tripled per-product wall time (Raw + PSA 9 + PSA 10 fan-out per chunk).

Root cause was structural: per-CH-card prices accumulated in a memory-only `pricesOnly` map and per-pp `cacheRows` were only upserted to `pricing_cache` at the very end of the function. A timeout meant **every byte of CH work was thrown away** — the worker timed out, the upsert never ran, the next firing started from zero on the same too-large product, repeat forever.

**Schema.** New `ch_price_cache` table ([supabase/migrations/20260509220000_ch_price_cache.sql](supabase/migrations/20260509220000_ch_price_cache.sql)) keyed by `cardhedger_card_id`, stores `raw_price` / `psa9_price` / `psa10_price` / `confidence` / `fetched_at`. Internal cache only — RLS enabled with no policies; service-role-only access. Multiple variants linking to the same CH card share one cache row.

**Pipeline.** [lib/pricing-refresh.ts](lib/pricing-refresh.ts) reworked end-to-end:
- **Cache read on entry.** Before building chunks, look up every variant's `cardhedger_card_id` in `ch_price_cache` and skip-if-fresh (24h TTL). Pre-populate `pricesOnly` directly from cache hits. Build chunks only from card_ids that aren't in cache (or are stale).
- **Per-chunk writeback.** `runChunk` now upserts to `ch_price_cache` *immediately after* the CH calls return, before populating `pricesOnly`. Persist null-price rows too — the cache row's purpose is "we asked CH within the TTL window," not "we got a price." Worst case for a freshly-listed card: 24h staleness before re-check.
- **Incremental pricing_cache flush.** New `maybeFlush()` helper triggers after every ~100 PPs persist their aggregated row. Sync slice + cursor advance prevents double-flush across concurrent workers (`flushedCount = sliceEnd` runs before any await). Final tail flush at the end catches the partial batch.
- **EV math identical across cache-hit and live-fetch paths.** Same `evMid = psa9 ?? raw`, `evLow = raw ?? evMid * 0.35`, `evHigh = psa10 ?? evMid * 2.5` derivation in both branches so cache hits produce identical EV to live fetches.
- **`RefreshSummary` extended** with `variantsFromCache` + `variantsNewlyFetched` so the admin UI and cron logs can report cache hit rate.

**Recovery curve.** First firing on Donruss Optic (471 PPs, ~thousands of unique CH cards) might still time out, but each completed batch chunk persists 100 cards to `ch_price_cache`. Second firing reads those cached cards and only fetches the remainder. Donruss Optic should be fully cached within 2–3 firings of the next cron window.

**Files:**
- New: [supabase/migrations/20260509220000_ch_price_cache.sql](supabase/migrations/20260509220000_ch_price_cache.sql)
- Modified: [lib/pricing-refresh.ts](lib/pricing-refresh.ts) — cache reads, per-chunk writebacks, incremental flush, RefreshSummary extension

Resolves backlog item D ("Per-variant price cache for incremental refresh") via a different schema shape than the original proposal — keying by `cardhedger_card_id` (CH's identity) rather than per-`player_product_variants` row turned out to share more cleanly across products and avoid duplicating prices for variants that point at the same CH card.

---

## 2026-05-07 — Jumbo case-cost fields + Panini chase-cards fallback + product card redesign

Three P1/P2 backlog items shipped together. All admin-shaped, no schema changes, no engine changes.

**Jumbo case-cost fields in NewProductForm.** [app/admin/products/NewProductForm.tsx](app/admin/products/NewProductForm.tsx) gains `Jumbo / Case ($)` and `Jumbo AM / Case ($)` inputs alongside Hobby/BD/Hobby AM/BD AM. Pre-existed on the edit form ([components/admin/ProductForm.tsx](components/admin/ProductForm.tsx)) since the Break Analysis v2 ship in April but never landed on create. Also fixes [app/admin/products/actions.ts](app/admin/products/actions.ts) — `updateProduct`'s param type didn't accept `jumbo_case_cost` / `jumbo_am_case_cost` / `jumbo_autos_per_case`, which TypeScript was silently letting through (separately-declared `data` variable bypasses excess-property checks). The edit form was passing them, the action was dropping them. No admin had ever successfully set jumbo costs via the UI. Schema columns already existed, engine already wired — pure form-field add + type-tightening.

**Panini chase-cards print-run fallback.** [app/api/admin/chase-cards/route.ts](app/api/admin/chase-cards/route.ts) used to filter recommendations by `hobby_odds` only, which left the admin Chase Cards Manager **empty for every Panini product** (Panini doesn't publish odds). Selector now ladders: if any variant has odds, rank by lowest odds (existing behavior); otherwise fall back to lowest `print_run` (with `<= 999` threshold for chase-card eligibility). Each rarest-variant carries a `rankBy: 'odds' | 'print_run'` discriminator. Response includes a top-level `productHasOdds` boolean. [app/admin/products/[id]/ChaseCardsManager.tsx](app/admin/products/[id]/ChaseCardsManager.tsx) renders a yellow "Ranked by print run" indicator chip on the Chase Cards section header when `productHasOdds === false`, and per-row rarity labels switch from `1:360` → `/199` style when fallback is active. `addFromRecommendation` formats `odds_display` accordingly so the persisted row reads sanely.

**Consumer product card redesign.** [components/breakiq/ProductCard.tsx](components/breakiq/ProductCard.tsx) replaces the inline card render in [app/(consumer)/ActiveProductsBrowser.tsx](app/(consumer)/ActiveProductsBrowser.tsx). Old card was admin-shaped (Case Cost as the headline metric). New card is consumer-shaped — drops the big case-cost block to a single mono-line footer (`Hobby $X · BD $Y · Jumbo $Z`), tightens padding/density (~40% shorter), and surfaces two consumer signals as inline chips: (1) **Activity counter** — "N this week" pulled from `user_breaks` rows where `created_at >= now() - 7d AND status != 'abandoned'`, grouped by `product_id`; (2) **Hype tag pill** — most-recent active product-scope `market_observations` row of `observation_type='hype_tag'` where the payload tag is positive (`release_premium` or `underhyped`). Negative tags (`cooled` / `overhyped`) are suppressed at the card surface — they don't fit a "this product is hot" pill. Grid bumps to 4-up at xl breakpoint to take advantage of the new compact density.

[app/(consumer)/page.tsx](app/(consumer)/page.tsx) `getProducts` now does three parallel queries (products + 7d break counts + active hype observations) instead of one. Aggregation happens in JS — fine at current beta volume; revisit if observation table grows past tens of thousands of rows. Top Mover chip from the original spec is **deferred** pending Kyle's confirmation on whether CH's `top-movers` endpoint returns a price delta or just rank order; will layer in once Phase 5 C-score lands.

---

## 2026-05-06 — Panini Master Checklist parser

Resolves the P1 Panini parser backlog item filed earlier today during the 2025 Panini Prizm Football import attempt. Panini ships a fully-denormalized `Master Checklist` sheet that is the canonical record of every (parallel × athlete) row — header `CARD SET / CARD NUMBER / ATHLETE / TEAM / SEQUENCE`, 34,723 rows for 2025 Prizm Football. The Topps/Bowman parser only consumed the metadata sheets (`Base / Inserts / Autographs / Memorabilia`) and missed ~90% of parallels: 24 detected sections out of the actual 316.

**Parser.** New `parsePaniniXlsx` in [lib/checklist-parser.ts](lib/checklist-parser.ts) auto-detects Panini format by checking the `Master Checklist` sheet's header row. When detected, it routes there directly and skips the Bowman/Topps logic entirely. Each unique CARD SET becomes one `ParsedSection`. Each row in that CARD SET becomes one `ParsedCard` — no `parallels` array, because the parallel IS the section. The importer's `parallels.length > 0 ? expand : [section.sectionName]` fallback then creates exactly one variant per card with `variant_name = sectionName`. Mirrors how CardHedger names these cards in its catalog, so the matcher's exact-variant tier should land most rows on the first try without falling through to Claude. SEQUENCE → `printRun`. Player names cleaned (trailing comma + trademark symbols stripped).

**Format detection lives at the top of `parseChecklistXlsx`.** Single workbook read, header sniff, route to either path. No new entry point in the API layer; the existing `/api/admin/parse-checklist` route picks up Panini transparently.

**Verification.** Real-fixture sanity check at [scripts/verify-panini-parser.mjs](scripts/verify-panini-parser.mjs) — parses 2025 Panini Prizm Football to 316 sections / 34,723 cards / Travis Hunter as the most-variants player at 163 distinct parallels. Test pass: every row in the Master Checklist round-trips to a typed `ParsedCard` with team, card_number, print_run intact.

**Known gaps documented but deferred** (see [docs/manufacturer-rules/panini.md](docs/manufacturer-rules/panini.md)):
- No rookie flag — Master Checklist doesn't carry RC. Every Panini player imports as `is_rookie: false` until we add a rookie-overlay parser that consults the metadata sheets' "Base — Rookie" subsets.
- No odds — Panini doesn't publish hobby pull rates. Engine math is already null-safe (audit confirmed earlier today). Admin Chase Cards Manager is empty for Panini products until the P2 print-run fallback ships.

**`paniniDescriptor` (lib/card-knowledge/panini.ts) was already in place from a prior session** — kept as-is for now. Will refine `stripPatterns` and `variantSynonyms` once we have CH match-rate data from the first real Panini matching run.

---

## 2026-05-06 — Chunked checklist imports

Panini Prizm Football (32,851 cards across 100+ parallel-heavy sections) hit Vercel's 4.5 MB Function ingress cap on `POST /api/admin/import-checklist`, returning a 413 before the route handler ran. The client did `await res.json()` on the plain-text response body and surfaced a cryptic `Unexpected token 'R', "Request En"... is not valid JSON`. Fix splits the import into multiple sequential POSTs, each well under the cap.

**Shared aggregates helper.** [lib/checklist-aggregates.ts](lib/checklist-aggregates.ts) extracts `computePlayerAggregates(sections)` (player set totals, base-appearance flagging, card-number unioning) plus `isMultiPlayerName`. Both client and server import from here so the rule that drives `insert_only` and `checklist_card_numbers` stays in one place.

**Server.** [app/api/admin/import-checklist/route.ts](app/api/admin/import-checklist/route.ts) now accepts an optional `playersOverride: PlayerAggregate[]`. When present, the server skips its own per-section accumulation and uses the override directly — required for chunked imports where each chunk only sees a slice of the cards but the player + player_product upserts must be invariant (`hobby_sets` are sums over the FULL dataset, not the chunk). Variant insertion is now dedupe-aware: server queries existing `(player_product_id, variant_name, card_number)` tuples for the batch's player_products and skips rows that already exist. Re-imports and chunked imports are idempotent. Response now includes `variantsSkippedAsDuplicates`.

**Client.** [app/admin/import-checklist/page.tsx](app/admin/import-checklist/page.tsx) computes `playersOverride` locally over the full dataset, walks the included sections building batches under `MAX_BATCH_CARDS = 8000` each (a section larger than the cap is split — its `cards` array sliced across multiple batches with metadata replicated), and sequentially POSTs each batch with the same override. Per-batch progress chip ("Batch 2/3 · 16,000/24,000 cards") with progress bar appears for any multi-batch import. `await res.json()` swapped for `await res.text()` + manual JSON parse so a future 413 surfaces as "Batch X exceeded the 4.5 MB request limit" instead of the parser error.

**What this does NOT do.** Existing duplicate variants in production (~9k rows across ~8.8k tuples per a one-off audit) stay untouched — they're a separate cleanup task. The dedupe-on-write only prevents NEW duplicates from being created. No DB constraint added, no migration needed.

---

## 2026-05-06 — CardHedger data audit + all three P0 fixes

Investigated CH API usage end-to-end against [the live MCP probe](https://api.cardhedger.com/mcp) to map gaps between what CH offers and what BreakIQ actually pulls. Findings + prioritized punch list saved to [docs/plans/2026-05-06-cardhedger-data-audit.md](docs/plans/2026-05-06-cardhedger-data-audit.md). All three P0 fixes shipped.

**P0.1 — PSA 9 + PSA 10 alongside Raw in the primary pricing engine.** [lib/pricing-refresh.ts](lib/pricing-refresh.ts) was calling `batchPriceEstimate` with `grade: 'Raw'` only, then synthesizing `evMid` (PSA 9) and `evHigh` (PSA 10) from `Raw × 0.35` and `Raw × 2.5` heuristics. For graded-heavy parallels (Refractors, Gold /50, autos) those multipliers were materially wrong. Each chunk now fires three parallel `batchPriceEstimate` calls — one per grade — and assembles `{ evLow, evMid, evHigh }` using the canonical mapping (Raw→evLow, PSA 9→evMid, PSA 10→evHigh) with the heuristics demoted to last-resort fallbacks for missing grades. Per-grade results are joined by `card_id` so we don't depend on CH echoing the `grade` field in the batch response.

Concurrency knobs bumped to absorb the 3× CH call count: `PRICE_FETCH_CONCURRENCY` 6 → 12; `BATCH_DEADLINE_MS` 270s → 280s; `HARD_DEADLINE_MS` 290s → 295s. Peak in-flight is now 12 chunks × 3 grades = 36 concurrent CH requests; the existing retry-with-backoff in [lib/cardhedger.ts](lib/cardhedger.ts) absorbs intermittent rate-limit hits, and the cron orchestrator's stale-first selection means anything that goes partial is picked up on the next firing.

Confidence aggregation extended: per-card confidence is the average across the grades that returned real prices, so the chip's signal stays meaningful when only one or two grades have data.

**P0.3 — `get90DayPrices` shape fix.**  The endpoint actually returns `{ cards: [{ price, '90_day_sales', grade, ... }] }`, not `{ prices: [...] }` as the wrapper assumed. Two callers — [lib/pricing-refresh.ts](lib/pricing-refresh.ts) (search-priced rung) and [lib/analysis.ts](lib/analysis.ts) (live non-hydrated path) — were throwing on `result.prices.find(...)`, getting swallowed by their try/catch, and silently falling through to the default `$8 / $15-rookie` rung. Rewrote `get90DayPrices` to compute a sales-weighted aggregate (`avg_price`, `min_price`, `max_price`, `sale_count`) per requested grade and return it as a single object. Both callers updated. The intended fallback rung is finally live.

**P0.2 — pricing confidence captured + surfaced.** `batch-price-estimate` returns a per-card `confidence` (0..1) on every response — we were dropping it at the cache upsert. Migration [20260506180000_pricing_cache_confidence.sql](supabase/migrations/20260506180000_pricing_cache_confidence.sql) adds a nullable `confidence` numeric to `pricing_cache`. [lib/pricing-refresh.ts](lib/pricing-refresh.ts) now persists a sales-weighted average across each player's priced variants; fallback rungs (sibling/search/default) write `null` since they aren't CH-modeled. [app/api/pricing/route.ts](app/api/pricing/route.ts) projects the column through `PlayerWithPricing.confidence`. [components/breakiq/PlayerTable.tsx](components/breakiq/PlayerTable.tsx) renders a `low conf` chip next to the EV Mid value when confidence < 0.5, with the actual percentage in the tooltip. Threshold is a starting cut — tune once we see the distribution across products.

Schema rollout: migration is additive (`ALTER TABLE … ADD COLUMN`) and nullable, so it can be applied without backfill. Run `supabase db push` before merging this branch; staging gets the column on the next staging push. Existing cache rows return `null` until their next refresh writes a value.

---

## 2026-05-06 — Pricing feedback placement fix

Same-day follow-up to the inline pricing feedback drop. The 👍/👎 buttons were rendered inside the player/team name cell with `ml-auto`, which visually attached them to the entity name — read like a vote on the player or team rather than the row's pricing data. Moved into a dedicated rightmost column on both row tables.

- [components/breakiq/PlayerTable.tsx](components/breakiq/PlayerTable.tsx) — added trailing `feedback` column to `COLUMNS`, removed the inline span from the Player cell, rendered `<PricingFeedback>` in a new trailing `<td>` for both priced and unpriced branches (unpriced rows still get feedback — "missing data" is a valid category).
- [components/breakiq/TeamSlotsTable.tsx](components/breakiq/TeamSlotsTable.tsx) — extended the grid template from 8 to 9 columns (`+_64px`), removed the inline feedback from the Team cell, added a new trailing cell with `onClick={e => e.stopPropagation()}` so clicking thumbs no longer toggles the team's expand/collapse. Expanded player rows got one more `<div />` to stay grid-aligned.

Out of scope: `/analysis` and `/card-lookup` placements (single result-level widget — placement was already correct).

---

## 2026-05-06 — PostHog hardening + inline pricing feedback

Two-part pass on the analytics layer: clean up the existing PostHog wiring and ship a row-level feedback capture surface that complements the Discord `/insight` flow.

**PostHog hardening:**

1. **Centralized event taxonomy.** New [lib/posthog-events.ts](lib/posthog-events.ts) exports `PH_EVENTS` (event names) and `PH_PERSON_PROPS` (person-property keys). Every call site — server and client — now imports from this constant map instead of bare strings. Renaming an event is a one-line change.
2. **Awaited server captures.** New `captureServer({ distinctId, event, properties, setProperties })` helper in [lib/posthog-server.ts](lib/posthog-server.ts) wraps capture + an awaited `flush()`. PostHog Node's `flushAt: 1` queues async, so on Vercel Functions the process can exit before the network call completes — events were silently dropping. All server captures (auth callback, my-breaks, Stripe webhook, new feedback API) routed through the helper.
3. **Browser identity tied to the user.** New [`<PostHogIdentify />`](app/(consumer)/PostHogIdentify.tsx) in the consumer layout calls `posthog.identify(userId, { email })` once on mount. Server identifies in `auth/callback`, but `posthog-js` in the browser kept an anonymous distinct_id for the rest of the session — pageviews, autocaptures, web-vitals, rageclicks all landed on a stranger. Now they tie to the real user.
4. **`posthog.reset()` on sign out.** `SignOutButton` resets the browser SDK identity before the redirect runs. Without this, the next user on a shared device inherits the previous distinct_id (same problem the SW cache wipe already solves for HTML).
5. **Subscription person-property sync.** Stripe webhook (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`) now writes `subscription_plan` + `subscription_status` to the PostHog person profile via `$set`. Filtering "Pro users who logged a break" is now a one-cohort query.
6. **Removed duplicate `checkout_initiated` event.** Was firing alongside the client-side `subscription_checkout_started` for the same action. Kept the client-side one (already has plan context).
7. **`identifyServer()` helper** for awaited server-side identify with person-property updates.
8. **CLAUDE.md env-var name fixed** — was listing `NEXT_PUBLIC_POSTHOG_KEY`, code reads `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`. Code wins; doc updated.

**Inline pricing feedback (the thumbs):**

9. **`pricing_feedback` table.** [supabase/migrations/20260506160000_pricing_feedback.sql](supabase/migrations/20260506160000_pricing_feedback.sql) — `rating` (`up`/`down`), `surface`, `entity_type`, `entity_id`, `product_id`, `category`, `notes`, `page_url`, plus admin-triage fields (`reviewed_at`, `reviewed_by`, `resolution_note`). RLS owner-only `SELECT`; writes go through service role.
10. **`POST /api/feedback/pricing`.** [app/api/feedback/pricing/route.ts](app/api/feedback/pricing/route.ts) — validates rating + surface + entity_type + category against allowed sets, inserts the row, fires `pricing_feedback_submitted` PostHog event with the same payload.
11. **`<PricingFeedback />` component.** [components/breakiq/PricingFeedback.tsx](components/breakiq/PricingFeedback.tsx) — small thumbs-up / thumbs-down pair. 👍 captures silently. 👎 opens an inline popover with category select (Pricing too high / too low / Wrong player / Missing data / Risk flag wrong / Other) + optional notes textarea. Submits to the feedback API + the PostHog event lands. Click-outside dismisses; thanks-state replaces the buttons after submit. Designed lighter than the PostHog Survey UI (no full-screen modal — just an inline popover).
12. **Wired into four surfaces:** player rows in `PlayerTable`, team rows in `TeamSlotsTable`, break-analysis result panel on `/analysis`, slab-analysis result on `/card-lookup`. Each passes `surface` + `entity_type` + `entity_id` + `product_id` so triage can route to the right product.

**Admin triage queue is intentionally not part of this drop** — see BACKLOG. The capture surface is shippable on its own; admin queue is a follow-on once feedback volume justifies the UI.

**Migration history reconciliation.** `supabase db push` initially failed because the remote tracked `20260506025100` (user_chase_list — applied via Supabase Studio yesterday, not the CLI) while the local tree carried the same DDL under `20260506030000`. Aligned by renaming `supabase/migrations/20260506030000_user_chase_list.sql` → `20260506025100_user_chase_list.sql` so local matches the canonical remote timestamp. SQL content unchanged. After alignment, only the new pricing-feedback migration was actually applied. Heads-up for anyone rebasing onto this commit: pull will move that file under its earlier timestamp, no action needed locally.

`pricing_feedback` table verified live in production: 14 columns, three secondary indexes (partial on unreviewed, composite on product+created_at, composite on entity_type+entity_id), `pricing_feedback_owner_select` RLS policy active.

---

## 2026-05-05 — My Chase / Players Hub Phase 1

Personal player watchlist. Save players from anywhere they appear in the app, see them in one place at `/chase` with current market value + buzz indicators. Naming collision with the existing admin "Chase Cards" feature is intentional — both are watchlists; data models are separate.

What landed:

1. **Schema.** `user_chase_list` table with composite PK `(user_id, player_id)` so "is saved?" is a primary-key lookup, no UNIQUE needed. RLS scoped to `auth.uid() = user_id`. Index on `(user_id, added_at desc)` for the list view.
2. **API.** `GET /api/chase` (full list with computed market data per player), `GET /api/chase?ids=p1,p2,...` (set lookup for hydrating heart-button state across a visible list), `POST /api/chase {player_id}` (idempotent — `ON CONFLICT DO NOTHING`), `DELETE /api/chase/[playerId]`. All auth-gated.
3. **`<ChaseHeartButton playerId>`.** Client component, optimistic toggle, reverts on failure. Reads initial state from a `<ChaseSetProvider>` context that batch-hydrates the visible set with one fetch — no per-row API call. Falls back to its own fetch when used outside a provider (e.g. in `PlayerDetailDrawer`).
4. **`/chase` page.** One card per saved player: heart, name, team, RC/icon badges, B-score / risk-flag chips, latest EV Mid from the most-recently-priced `player_product`, link through to that break page. Empty state explains how to add players.
5. **Heart placements.** `PlayerTable` (live break pages), `PreReleaseLayout` `PlayerRow` (pre-release product pages), `PlayerDetailDrawer` header. `ChaseSetProvider` wraps the player list in the first two so all hearts share one hydration fetch.
6. **Nav.** "Chase" link added to `ConsumerNav` desktop bar (between brand and My Breaks) and mobile drawer top.

`lib/chase.ts` houses the SQL → DTO logic for the list endpoint: three round-trips (chase rows, pricing across all of those players' products, active risk flags), stitched in JS. Lightweight; sub-100ms with realistic chase-list sizes.

What this doesn't do (Phase 2+ in BACKLOG Vision 5):

- Cross-product slot EV per saved player (which active products a player is in + slot cost in each)
- Live break links to Fanatics Collect / Whatnot / eBay
- Push notifications when a saved player's break goes live
- Sort / filter beyond `added_at desc`
- Bulk save / share lists

Files: `supabase/migrations/20260506030000_user_chase_list.sql` (also applied to prod via Supabase MCP), `lib/chase.ts`, `app/api/chase/route.ts`, `app/api/chase/[playerId]/route.ts`, `components/breakiq/ChaseHeartButton.tsx`, `app/(consumer)/chase/page.tsx`, `components/breakiq/PlayerTable.tsx`, `components/breakiq/PlayerDetailDrawer.tsx`, `components/breakiq/PreReleaseLayout.tsx`, `app/(consumer)/ConsumerNav.tsx`, `middleware.ts`, `app/api/player-comps/route.ts` (added `player_id` to the response), `lib/types.ts` (ChaseListEntry DTO). See `docs/plans/2026-05-05-my-chase-phase1.md` and `docs/my-chase.md`.

---

## 2026-05-05 — PWA: consumer app installable on mobile + desktop

Consumer surface is now a Progressive Web App. Admin stays a desktop-only web app — explicitly out of scope and never cached.

What landed:

1. **Manifest + icons.** `app/manifest.ts` (Next native manifest route) describes the app as `display: standalone`, `start_url: /`, `scope: /`, theme/background `#0a0e1a` (matches `--background`). Icons live in `public/icons/` — `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` (180×180) — generated from `public/brand/icon-gradient.svg` via `scripts/generate-pwa-icons.mjs` (uses sharp, already a devDep).

2. **Service worker via `@serwist/next`.** `app/sw.ts` is the SW entry; Serwist compiles it to `public/sw.js` at build time. SW is **disabled in dev** to avoid stale-cache pain. Runtime caching: bypass (`NetworkOnly`) on `/admin/*`, `/api/*`, `/auth/*` so live pricing and auth never serve stale; `NetworkFirst` for consumer HTML/RSC with `/offline` as the navigation fallback; standard `CacheFirst` / `StaleWhileRevalidate` for fonts, images, and `_next/static`. `next.config.ts` adds `Service-Worker-Allowed: /` and `Cache-Control: no-cache` headers on `/sw.js` so updates ship cleanly.

3. **Logout cache wipe.** Sign-out path now goes through `app/(consumer)/SignOutButton.tsx`, which posts `{type:'BREAKIQ_LOGOUT'}` to the SW (which deletes every Cache Storage bucket) before invoking the existing `logout` server action. Stops the next user on a shared device from seeing the previous user's cached HTML/RSC.

4. **Install prompt UX.** `app/(consumer)/InstallPrompt.tsx` captures `beforeinstallprompt` on Android Chrome / desktop Chrome / Edge and renders a dismissible chip. iOS Safari (no `beforeinstallprompt`) gets a one-time "Tap Share → Add to Home Screen" hint. Dismissal persists in localStorage. Mounted in `app/(consumer)/layout.tsx` only when a user is signed in.

5. **Root layout metadata.** `app/layout.tsx` adds `applicationName`, `appleWebApp` (capable + black-translucent status bar), explicit icons, and a `viewport` export with `themeColor: '#0a0e1a'` and `viewportFit: 'cover'` so iOS notches don't truncate the shell.

6. **Offline fallback.** `app/offline/page.tsx` — minimal `force-static` page returned by the SW for navigation requests when both network and cache miss. Uses an `<a href="/">` retry link (no JS dependency).

What this doesn't do: push notifications, background sync of My Breaks logs, share targets, file handlers, mobile-layout audit of consumer pages (likely needed but separate plan), admin PWA. All deferred.

Files: `app/manifest.ts`, `app/sw.ts`, `app/offline/page.tsx`, `app/(consumer)/InstallPrompt.tsx`, `app/(consumer)/SignOutButton.tsx`, `app/(consumer)/layout.tsx`, `app/(consumer)/ConsumerNav.tsx`, `app/layout.tsx`, `next.config.ts`, `scripts/generate-pwa-icons.mjs`, `public/icons/*`, `docs/pwa.md`. Deps added: `@serwist/next`, `serwist` (devDeps).

---

## 2026-05-05 — Privacy / Terms pages live, acceptance gated at signup, audit trail on profile

Yesterday the Privacy Policy and Terms drafts landed in `docs/legal/`. Today they're wired into the app: public pages, required acceptance at signup, persisted record on the user's profile.

What landed:

1. **Public pages.** `app/(legal)/privacy/page.tsx` and `app/(legal)/terms/page.tsx` are server components that read `docs/legal/*.md` at request time and render via `react-markdown` + `remark-gfm`. Both are statically prerendered (`○ /privacy`, `○ /terms` in the build output) and sit outside the middleware matcher so unauthenticated visitors can read them straight from the waitlist or a marketing email. `next.config.ts` adds `outputFileTracingIncludes` so Vercel ships the markdown files alongside the page bundles. Shared layout in `app/(legal)/layout.tsx` provides the `legal-prose` typography for the markdown output.

2. **Acceptance gate at signup.** `SignupForm.tsx` adds a single required checkbox (`I'm 18 or older and I agree to the Terms & Privacy Policy`) above all sign-in buttons. The Google/Discord/email-signup buttons are disabled until the box is checked; submitting via Enter without acceptance shows an inline error. The version strings are appended to the OAuth `redirectTo` and email-confirm `emailRedirectTo` URLs, so acceptance round-trips through Supabase's auth flow without needing a separate cookie. Versions live in `lib/legal.ts` (`TERMS_VERSION` / `PRIVACY_VERSION`, both `'2026-05-05'` to start).

3. **Persistence in `auth/callback`.** The callback parses `accept_terms` + `accept_privacy` from the URL, validates them against the current published constants (rejects stale/spoofed versions), and writes `terms_accepted_at` / `terms_version` / `privacy_accepted_at` / `privacy_version` to `profiles` only on first signup. Returning sign-ins don't overwrite — the original timestamp is the audit record.

4. **Profile UI.** `/profile` now has a Legal section with one row per doc: status pill (Accepted / Update available / Not accepted), accepted date, version stored vs. current, and a click-through link to the live page. Drives the future re-acceptance prompt by simply bumping `TERMS_VERSION` or `PRIVACY_VERSION` — existing profiles flip to the yellow "Update available" state automatically.

5. **Migration.** `20260505120000_legal_acceptance.sql` adds the four columns and grandfathers all pre-rollout profiles by setting `terms_accepted_at = privacy_accepted_at = created_at` with version sentinel `'pre-2026-05-05'`. Beta users keep their account without a forced re-accept on first login; they'll see the yellow update banner the next time we bump versions, which is the right behavior.

6. **Footer links.** Waitlist form and `/subscribe` page both got footer-style links to `/terms` + `/privacy`. Subscribe page also gained an explicit "subscriptions auto-renew until canceled" line above the legal links — matches the no-refunds posture in the T&C.

What this doesn't do: re-acceptance flow (just surfaces "Update available" — when versions bump we'll need to decide whether to nag, gate, or just log); cookie banner (we have no third-party advertising cookies, so likely don't need one, but EU users may eventually warrant one); admin login page legal links; data-export self-serve. All deferred.

Files: `lib/legal.ts`, `app/(legal)/layout.tsx`, `app/(legal)/privacy/page.tsx`, `app/(legal)/terms/page.tsx`, `app/auth/signup/SignupForm.tsx`, `app/auth/callback/route.ts`, `app/api/profile/route.ts`, `app/(consumer)/profile/page.tsx`, `app/waitlist/page.tsx`, `app/(consumer)/subscribe/page.tsx`, `next.config.ts`. Migration: `20260505120000_legal_acceptance.sql`. Deps added: `react-markdown@10`, `remark-gfm@4`.

---

## 2026-05-05 — Cron success rule: partial runs count as success

The Cron Status panel was flagging Pricing Refresh as `STALE` ("Last success: 3d ago") while the products table showed every product as `Last Priced: Today`. Two things measured two different events: `Last Priced` reads `pricing_cache.fetched_at` (any writer counts — cron, admin button, even orchestrator-aborted-but-still-running workers); `cron_run_log.success` was strictly `errors === 0`. Combined with the 22h staleness filter that shrinks the queue to a handful of products per firing, one aborted worker tipped the run from clean to "failed" even though the cache writes landed.

Loosened `recordCronRun` in `lib/cron-log.ts` so `success = errors === 0 || ok > 0`. Partial runs now log green; the existing detail line on `<CronStatusPanel>` already prints `{ok} ok / {errors} err`, so the panel keeps the nuance without needing a third visual state. Existing rows aren't reclassified — the next 4–6:30 AM UTC firing will write the first success row under the new rule and clear the stale badge.

What this doesn't do: distinguish "aborted but completing" from "hard error" in the orchestrator's tally, or verify success by reading `pricing_cache` writes during the run window. Those are larger structural changes if we ever want a stricter signal.

Files: `lib/cron-log.ts`.

---

## 2026-05-04 — Privacy Policy and Terms & Conditions drafts

Pre-public-launch gap: the app had no Privacy Policy or T&C routes anywhere. Drafted both as markdown working drafts in `docs/legal/` for attorney review before publication.

Drafts are written from real code substrate, not generic boilerplate, so the lawyer review focuses on language not product comprehension. Privacy Policy enumerates every data field collected (with the explicit "DOB never stored, only `is_over_18`" callout matching `app/(consumer)/onboarding/page.tsx`), all 10 subprocessors (Supabase, Stripe, Anthropic, CardHedger, PSA, Resend, PostHog, Discord, Google, Vercel), and the Discord contributor public-attribution model. T&C names Mervin LLC as operator, sets governing law to Pennsylvania, encodes the actual Free / Hobby ($9.99) / Pro ($24.99) tiers and Stripe cancel-at-period-end behavior, and includes a load-bearing Section 8 ("not financial, investment, gambling, or purchasing advice") covering EV / fair value / BUY-WATCH-PASS / BreakIQ Bets language.

Items intentionally bracketed for counsel: effective date, mailing address, optional arbitration clause (Section 18.4), state-of-formation confirmation, log retention period, Terms-change notice window. Both docs are cross-linked and reference `support@getbreakiq.com` for all privacy/legal/deletion contacts. No app routes wired up yet — that's a separate task once the legal copy is finalized.

Files: `docs/legal/privacy-policy.md`, `docs/legal/terms-and-conditions.md`.

---

## 2026-04-30 — Pre-release product page polish

The pre-release lifecycle infrastructure shipped 2026-04-27 but the consumer surface read as a stripped-down live page. This pass turns it into a hype-rich pre-launch surface in three buckets, all rendered in `components/breakiq/PreReleaseLayout.tsx`.

What landed:

1. **Countdown hero with sub-hero context.** Days/hours/minutes when ≥1 day out; ticks to HH:MM:SS on launch day; pulses "Live now" in red if `release_date` has passed but admin hasn't flipped to live yet. Sport gradient passed in from the parent break page (no more hardcoded purple). Sub-hero ribbon below the countdown reads launch date + hobby case price + BD case price (each row drops out cleanly when the data isn't set). Asking-price chip ("Streams asking $1,400–$1,600 · 3 obs") rides on the same ribbon when product-scope `asking_price` observations are present.

2. **Player intel — sort, filter, group, PSA 9.** New `<SegmentedControl>` above the roster: `Raw avg` / `PSA 10` / `A→Z` / `Rookies` (default `Raw avg desc`). Filter chips: `All / Rookies / Has history / Risk flag`. Group-by-team toggle that sticky-headers each team. PSA 9 column split out from PSA 10 (snapshot route now pulls all three grades from `get90DayPrices`; new `psa9_avg_90d` / `psa9_sales_90d` columns on `pre_release_player_snapshots` via `20260430210000_pre_release_psa9.sql`). Risk-flag pills bumped from 9px to 10px with a filled background and a subtle pulse on `injury` / `suspension`. Top-3 by current sort get a `▲1 / ▲2 / ▲3` rank flair.

3. **Phase 3 chip rendering (display-only).** Pre-release version of the Phase 3c chip slice. `app/(consumer)/break/[slug]/page.tsx` already fetched `hype_tag` rows for engine math; now the rows themselves are lifted to state and a parallel `asking_price` query runs only when `lifecycle_status === 'pre_release'` (live/dormant pages skip the second fetch — no latency regression). Product-scope hype tags render as a banner above the chase cards with the source narrative excerpt + relative time. Player-scope hype tags render as chips next to player names (tooltip shows the source narrative). No engine reads, no scoring change — the engine slice stays Phase 3c.

What this doesn't do: variant-aware engine reads (Phase 3c), asking-price chips on the live page, admin readiness checklist before flipping a product to live, pre-order/notify capture. All explicitly out of scope per the plan.

Files: `components/breakiq/PreReleaseLayout.tsx` rewritten, `app/(consumer)/break/[slug]/page.tsx` adds the `asking_price` fetch + new props, `app/api/pre-release/player-snapshots/route.ts` adds PSA 9, `lib/types.ts` adds `HypeObsRow` / `AskingPriceObsRow`, migration `20260430210000_pre_release_psa9.sql`.

Plan: `docs/plans/2026-04-30-pre-release-polish.md` (saved this session). Architecture doc: `docs/product-lifecycle.md` (updated).

---

## 2026-04-30 — Insight capture granularity: sentiment scope, variant scope, asking-price source, odds observations

Conversation with Kyle (2026-04-30) surfaced three holes in what Discord `/insight` could actually capture. We're staying in capture-only mode — the engine doesn't read variant scope yet — so contributors can start producing the data while the engine wiring lands later.

What landed:

1. **Sentiment scope `'global' | 'product'`.** Today's parser fanned every `breakerz_score` write across all of a player's product entries. That was wrong for narrative like "Wemby in 2024 Topps Chrome is wild" — should bump only that one entry, not Bowman / Donruss / etc. Parser now emits `scope` on sentiment updates; apply path branches accordingly. `breakerz_sentiment_history.player_product_id` (already nullable) gets the specific product's player_product_id when scope='product'; null preserves the global-fan-out semantics.

2. **Variant scope on hype + asking_price.** Kyle's framing: hype lives at Product → Player → Variant — Ohtani's base might be saturated while his orange ref is wild. Parser learned to emit `scope_type='variant'` with free-text `variant_name` in the payload. variant_id resolution is deferred — see Phase 3c in the plan. `scope_id` rolls variant scope up to the player_id so queries that filter by player still match variant rows.

3. **Asking-price `source` enum.** CardHedger only sees sold comps; the whole point of capturing observations is the leading-indicator signals it can't see. Parser now tags every asking_price with `source: 'ebay_listing' | 'stream_ask' | 'social_post' | 'other'`. eBay listing is the unsold-listing signal that matters most during release week.

4. **New `odds_observation` parser kind.** For "this hit pulls 1:80 cases on hobby, not the 1:48 odds sheet says." Variant-by-default, format-keyed (`hobby` / `jumbo` / `bd`). Stored in `market_observations` via a one-line CHECK extension (`20260430182400_observation_types_extend.sql`). Engine doesn't read these yet — they accumulate as field intel until the variant-aware engine reads land.

5. **Plan file updated** — `docs/plans/2026-04-29-break-analysis-v2.md` Phase 3 split into 3a (✅ engine reads, player-level), 3b (✅ this slice, capture-side granularity), 3c (deferred — variant-aware engine reads, asking-price feedback, consumer chip display).

What this doesn't do: engine is still player-level for hype + sentiment. Variant-scope observations sit unused until Phase 3c. Asking-price still display-only (and there's no display surface yet either — also Phase 3c).

---

## 2026-04-30 — Score modulation: risk_flags + hype_tags into effectiveScore

The Phase 2 Discord pipeline captures four signal types but only `sentiment` (writing `breakerz_score`) actually moved the engine. `risk_flag` rows surfaced to the UI but didn't influence slot pricing; `hype_tag` observations sat unread in `market_observations`. This is the BreakIQ Bets engine half of that gap.

What landed:

1. **`lib/score-modulation.ts`** — new module. `RISK_ADJUSTMENTS` table per `flag_type` (retirement -0.80, suspension -0.50, legal -0.40, injury -0.30, off_field -0.25, trade -0.15). `HYPE_MAX = 0.30` caps any single hype-tag's contribution. `computeRiskAdjustment` returns the **single most-negative** active flag (no stacking). `computeHypeAdjustment` sums per-observation `direction × strength × HYPE_MAX × decayFactor` where decayFactor is linear from `observed_at` to `observed_at + decay_days`. Multiple hype tags **do** stack.

2. **Engine** — `lib/engine.ts:computeEffectiveScore` and the inline `effectiveScore` lambda in `computeSlotPricing` fold `risk_score_adj + hype_score_adj` into the sum before the existing clamp `[-0.9, 1.0]`. Icon override (force 0) stays.

3. **`PlayerWithPricing`** — extended with optional runtime-only `risk_score_adj?` / `hype_score_adj?` (default 0, not persisted).

4. **`/break/[slug]` consumer page** — already loaded `player_risk_flags`. Now also fetches `market_observations` (hype_tag, product-scoped, non-expired, non-superseded) in parallel, buckets by `scope_type` (product / team / player), computes adj per player_product, and merges into `rawPlayers` before `setRawPlayers`.

5. **`runBreakAnalysis` (`/analysis` BreakIQ Sayz)** — same pattern: pool-wide flags + observations fetch upfront, attach adj before `computeSlotPricing`. The pool-wide flags fetch is reused for the bundle-level `riskFlags` response — no second round-trip.

What this doesn't do: no UI changes. Consumers feel the change as movement in slot costs only. The display slice (asking-price chips, hype/risk chips next to player names) is a separate Phase-3 follow-up. Asking-price stays display-only. No DB migration; no admin UI; no `pricing_cache` change.

Math note on product-scope hype: a uniform bump on every player **collapses out of slot redistribution** (slot cost is a normalized share of the pool). That's correct behavior — product-wide hype shouldn't redistribute slots within the product. It will matter once cross-product comparisons or fair-value-vs-ask weighting land.

See `docs/score-modulation.md` for math + verification.

---

## 2026-04-29 — Discord insight capture (Phase 2)

Replaces the original Phase 2 plan for extending BreakIQ Bets / building a dedicated mobile capture route. Kyle (and any allowlisted contributor) types `/insight <narrative>` in `#breakiq-insights` on the BreakIQ Discord server; Claude parses; bot replies with proposed updates and ✅ Apply / ❌ Discard buttons. No long-running gateway connection required — runs entirely on Vercel via Discord's HTTP Interactions API.

What landed:

1. **Schema migration `20260429190000_discord_insights.sql`** — three tables. `discord_contributors` (allowlist of Discord user IDs with `admin` / `contributor` roles). `pending_insights` stages parser output until ✅/❌ resolves it; preserves the raw narrative + parsed_updates JSON + status (`pending` / `applied` / `discarded` / `expired`) for analytics. `market_observations` is the consumer-visible asking-price + hype-tag table, scoped by product/team/player with a default 14-day expiry (overridden by hype-tag `decay_days`).

2. **`lib/discord.ts`** — Ed25519 signature verification using Node native crypto (no extra deps; we wrap Discord's raw 32-byte public key in a SubjectPublicKeyInfo DER prefix so `crypto.createPublicKey` accepts it). REST helpers for editing interaction responses + channel messages. Constants for interaction/component types so call sites stay readable.

3. **`lib/insights-parser.ts`** — shared Claude parser. Emits four update kinds in one call: `sentiment` (player ±0.5 score), `asking_price` (team/player/product slot price range), `hype_tag` (release_premium / cooled / overhyped / underhyped with decay), `risk_flag` (injury/suspension/legal/trade/retirement/off_field). Strict id validation against products + players from the DB. Roster includes every solo player in the DB (excluding multi-player concatenated rows like `Skubal / Blanco`) so Claude has the full population to match against. The prompt explicitly forbids substitution — "wrong attributions are worse than missing ones."

4. **`/api/discord/interactions`** — single endpoint handles PING, slash command, and button click. Both slow paths (Claude parse on the slash command + DB fanout on Apply) defer the response with `next/server`'s `after()` so we never trip Discord's 3-second response budget. Allowlist enforced per interaction, not per session, so a dropped contributor stops resolving immediately.

5. **`scripts/register-discord-commands.mjs`** — one-shot guild-scoped registration of the `/insight` slash command. Re-runnable any time the schema changes.

Several gnarly issues surfaced and got fixed during setup:

- **PostgREST `products!inner` + filter combination silently returned 0 rows** — caused a session where every `/insight` call returned `roster=0` and Claude was never invoked. Replaced with an explicit two-step paginated query (active product ids → page through `player_products` → chunked `.in()` against `players`).
- **Slot-eligibility filter excluded entities the user wanted to discuss** — C.J. Stroud is in the DB only as `insert_only=true`, so excluding insert-only players let Claude substitute Shedeur Sanders (closest popular young QB) instead of admitting "no match." Fixed by including all solo players regardless of slot-eligibility, plus the anti-substitution prompt.
- **Apply button hit Discord's 3s timeout** — `applyUpdates` runs sequential DB writes (sentiment fans out across all of a player's product entries; risk_flag inserts one row per `player_product`). Now both buttons defer with `DEFERRED_UPDATE_MESSAGE` and edit the message after work completes.
- **Diagnostic surface in the bot reply** — when the parser returns 0 updates, the bot now includes roster size, products count, parsed-raw count, drop reasons, and the first 700 chars of Claude's raw response so silent failures don't repeat.

Allowlist seeded with Brody (admin) and Kyle (contributor). Phase 2 of `docs/plans/2026-04-29-break-analysis-v2.md` rewritten to reflect this Discord-driven design; the dedicated-mobile-capture line item is explicitly retired (Discord on phone *is* the mobile surface).

What this doesn't do yet: consumer surface for the captured `market_observations` (still display-only when we wire it up on `/break/[slug]`), feeding asking-price observations back into the model's weighting, image attachments on slash commands, voice-memo transcription pipeline (Discord's mobile keyboard dictation handles voice today).

---

## 2026-04-29 — Insight source tracking (sentiment history + risk-flag attribution)

So we can analyze contributor themes longitudinally — what topics Kyle/Brody flag most often, how each person's read on a player shifts week over week, which kinds of insights tend to convert to applied vs discarded — every applied insight now traces back to who submitted it and what they said.

Two specific gaps closed (migration `20260429210000_insight_source_tracking.sql`):

1. `player_risk_flags` previously had no source attribution. Discord-applied flags now populate `source_pending_id`, `source_user_id`, `source_narrative`, `confidence` — same shape as `market_observations`. Pre-existing rows stay NULL.

2. `breakerz_score` is a single mutable column — when a contributor revises a sentiment, the prior value vanishes. New `breakerz_sentiment_history` table captures every score change with prev/new score + note, source narrative, and contributor. Currently written from the Discord apply path; admin UI edits will write here once that flow is wired.

Followup migration `20260429220000_sentiment_history_allow_null_new_score.sql` made `new_score` nullable — reverts back to "no score" are a legitimate state change (needed when correcting a misattribution from a bad parser run).

Example queries this enables: "what does Kyle most often flag?", "how has Wemby's sentiment evolved?", "which products attract the most market observations?" — all in `pending_insights` joined to the appropriate downstream table by `source_pending_id`.

---

## 2026-04-29 — Cron pipeline fixes (silent fan-out failure + status panel)

Discovered during a QA pass that consumer pricing kept "disappearing" — root cause: the nightly pricing cron had been writing zero rows for at least 2 days. Vercel showed the cron firing on schedule and the orchestrator returning 200, but every fan-out POST to `/api/admin/refresh-product-pricing` failed silently. The orchestrator's response payload showed `processed=16 ok=0 err=16` while the dashboard happily reported success. Three coupled fixes:

1. **Vercel Deployment Protection (SSO) was 401-ing every fan-out** (commits `f552cd7` + `185893a`). The orchestrator built the fan-out URL from `req.url`. When Vercel cron invoked the orchestrator, `req.url` was the protected `*.vercel.app` deployment host. Each POST hit the SSO challenge before reaching the route. Fix: prefer `NEXT_PUBLIC_APP_URL` whenever the orchestrator runs on a `*.vercel.app` host, normalize to www-prefix so the apex→www redirect doesn't strip the bearer header, and `redirect: 'manual'` on the fetch so any future redirect surfaces as a visible failure instead of being followed to a wrong endpoint.

2. **Orchestrator survived past Vercel's 300s kill** (commit `7e3523f`). With CONCURRENCY=3 and PER_FETCH_TIMEOUT=240s, an in-flight fan-out fetch could keep the orchestrator alive past its own 270s budget — well past Vercel's 300s function-invocation cap. The function got killed before it could write `cron_run_log` or return a JSON summary, hiding the failure. Fix: shared `AbortController` fires at `ORCHESTRATOR_BUDGET_MS=240s` and aborts every in-flight fan-out. Workers exit deterministically; the orchestrator returns inside its budget. Per-product workers run on their own Vercel invocations and finish independently — aborting the orchestrator's view of them doesn't lose work.

3. **Cron Status panel** (commit `769ad96`, migration `20260429160000_cron_run_log.sql`). New `cron_run_log` table records every orchestrator invocation: `started_at`, `duration_ms`, `processed`/`ok`/`errors`/`skipped`, plus a `details` JSON payload (failure samples, fan-out host, etc.). All four cron orchestrators (`refresh-pricing`, `refresh-dormant-pricing`, `refresh-ch-catalogs`, `update-scores`) write a row at end of run and on fatal catch. New `<CronStatusPanel>` on `/admin/products` shows last-success age + last-attempt result with healthy/stale/failed/never-run badges. Stale threshold is 26h for daily crons, 17 days for the biweekly dormant refresh.

---

## 2026-04-29 — Multi-player checklist rows are inserts, not slot-eligible players

Combined-name rows (`Skubal / Blanco / Valdez` — League Leaders, dual autos, etc.) were being stored as single `players` rows by the importer with concatenated team strings, then surfaced as bogus team chips in the consumer analyzer. Per Kyle's domain knowledge: every individual player has exactly one team; a combined-name row isn't a real player, it's a subset card. 437 multi-player rows on prod; 101 had `insert_only=false` and were polluting team filters.

- Forward fix: `import-checklist` sets `insert_only=true` on `player_products` whose player name contains `/`, same way it already does for players with no base-card appearance.
- Backfill migration `20260429140000_multi_player_rows_insert_only.sql` flipped the 101 leftover rows.
- Effect: team chip filter (queries `insert_only=false`) drops these entries; slot pricing excludes them. CardHedger pricing on these rows is preserved — they're flagged, not deleted.

---

## 2026-04-29 — My Breaks v2: multi-team / multi-player / mixed-format

My Breaks (consumer break log) now matches the same bundle shape as `/analysis`. Schema migration `20260429180000_my_breaks_multi.sql` adds `teams text[]`, `extra_player_product_ids uuid[]`, `formats jsonb`. Old single-value columns (`team`, `break_type`, `num_cases`) made nullable; existing rows backfilled to single-element arrays.

Form rebuilt with the same multi-select team chip picker (logos + tooltips), searchable player slot picker, three-format counters gated by what the product supports. List view shows "Product — Team A, Team B" plus the format mix in the meta line. CSV export + import template updated: `Teams` (semicolon-separated) + separate `Hobby/BD/Jumbo Cases` columns replace the old single-team / single-format shape.

---

## 2026-04-29 — Break Analysis v2: multi-format, multi-team, multi-player + 1/1 filter

After a working session with Kyle (transcript captured in `docs/plans/2026-04-29-break-analysis-v2.md`), we surfaced that the consumer break analyzer didn't match how breaks are actually sold. Real breaks mix formats (hobby + BD + jumbo), often span multiple teams, and frequently include standalone player slots. Phase 1 of the rethink lands here.

Five coupled changes:

1. **Schema migration `20260429120000_jumbo_format.sql`** — adds `products.jumbo_case_cost`, `products.jumbo_am_case_cost`, `products.jumbo_autos_per_case`, `player_product_variants.jumbo_sets`, `player_product_variants.jumbo_odds`. Backfill is a no-op; products without jumbo leave the columns null and the format is hidden in the UI.

2. **Engine + analysis multi-format support** — `BreakConfig` extends to `{ hobbyCases, bdCases, jumboCases, hobbyCaseCost, bdCaseCost, jumboCaseCost }`. `computeSlotPricing` adds a third pool parallel to hobby (jumbo uses the same `effectiveScore` multiplier; BD keeps raw `evMid` weighting). `computeTeamSlotPricing` rolls jumbo into team totals.

3. **`runBreakAnalysis` now takes a bundle** — new signature: `{ productId, teams: string[], extraPlayerProductIds?: string[], formats: { hobby, bd, jumbo }, caseCosts?, askPrice }`. Returns one bundle fair value, one signal, top players unioned across selected teams + standalone player slots. Claude prompt expanded to explain mixed-format / multi-slot bundles. Unknown teams surface as a single combined error instead of failing on first.

4. **Consumer + admin UX** — `/(consumer)/analysis` rebuilt: multi-select team chips, searchable player picker for standalone slots, three format counters (hobby/BD/jumbo, hidden when product lacks that format's case cost), single bundle price input. `/(consumer)/break/[slug]` replaces hobby/BD segmented control with three format counters; segmented control retained as a "View Format" toggle for the slot tables. `TeamSlotsTable` + `PlayerTable` accept `viewFormat: BreakFormat`. Admin product editor and dashboard display add jumbo MSRP/AM fields.

5. **1-of-1 sales no longer pollute slot pricing** — `lib/pricing-refresh.ts` and `lib/analysis.ts` filter out variants with `print_run <= 1` from per-player aggregation. Variant-level EV for actual 1/1 cards is preserved (still rendered in the player drawer), but a single $2,200 SuperFractor sale no longer pulls Austin Reaves' slot to $4,400 by skewing the sets-weighted average.

API breaking change: `POST /api/analysis` rejects the legacy single-team payload (`{ team, breakType, numCases }`) with a 400. The internal `/api/my-breaks` caller was updated to map its single-team / single-format inputs into the new shape; external clients (none today) would need to update.

What this doesn't touch yet (Phase 2/3 in the plan): asking-price observation capture, hype tags, mid-tier (orange/gold) weighted anchor, release-window premium decay, dedicated mobile insight-capture surface. See `docs/plans/2026-04-29-break-analysis-v2.md` for the full roadmap.

---

## 2026-04-27 — Checklist becomes authoritative for product organization

Architectural shift: the checklist (parsed from manufacturer PDFs/XLSXs) is now the source of truth for "what's in this product." CardHedger is the source of truth for pricing, but no longer dictates which players or variants are slot-eligible. This was the root cause of multiple bugs surfaced today (1,569 inflated player count on Topps Chrome, the 6,341 corrupt rows, and the latent Topps S1/S2 sharing problem with the upcoming Series 2 release).

Four coupled changes:

1. **New column `player_products.checklist_card_numbers TEXT[]`** (migration `20260427210000`). Persists the union of card numbers per player from the parsed checklist. Hydrate uses it to scope CH variant attachment.

2. **`import-checklist`** now populates `checklist_card_numbers` and computes `insert_only` per player based on whether they appear in any base-set entry (numeric card number) vs only insert/auto subsets (prefixed codes like `SF-13`, `TCA-JM`).

3. **`variants-from-catalog` Phase 4** now scopes CH variant attachment: a CH variant only attaches to a player_product if the variant's `card_number` is in that player_product's `checklist_card_numbers`. Legacy player_products with `null` checklist_card_numbers fall back to permissive name-only matching, so existing products keep working until they're re-imported. New `scopedOutByCardNumber` field in HydrateResult for telemetry.

4. **Backfill migration `20260427220000`** flips `insert_only=true` on player_products whose variants have no numeric card_numbers — catches the existing retired-legends-on-inserts that the earlier morning's fix only addressed for *new* auto-creates.

Why this matters now: Topps Series 2 drops soon and shares CH's `2025 Topps Baseball` set with Series 1. Without per-checklist scoping, both products would show all 56k variants from the combined catalog. Future Bowman/Topps releases that bundle similar series will hit the same pattern.

What this doesn't touch: parser coverage gaps (if a manufacturer PDF is missing a section, those CH variants won't attach — separate parser work), the Find on CH widget, or the 5 products still missing `ch_set_name`.

---

## 2026-04-27 — CH catalog refresh: retry on 5xx, lower concurrency, longer timeouts

Setting up `2025 Topps Baseball` (56,027 cards / ~561 pages) as a `ch_set_name` exposed that the catalog refresh pipeline had no resilience to CH transient errors. First attempt: `500 — Server disconnected`. Retry: `502 Bad Gateway`. CH responded fine to one-off MCP queries — the issue was specifically our 8-way parallel pagination overwhelming the backend on large sets.

Three changes:
1. **Retry-on-5xx in `lib/cardhedger.ts` `post()`** — backoff 500ms → 1500ms → 4500ms (3 retries). Also retries `AbortError` (timeout) and network errors. 4xx still throws immediately. Worst-case retry chain bounded at ~36s, well within route budgets. Logs `[cardhedger] retry N/3` to Vercel for observability.
2. **30s timeout for catalog page-fetches** (was inheriting the 10s default). CH `/card-search` is normally <1s per page, but tail latency creeps under load on big sets.
3. **`PAGE_CONCURRENCY` from 8 → 4** in `lib/cardhedger-catalog.ts`. Same lesson as the pricing cron throttle from earlier today: CH degrades faster than expected under aggressive parallelism, so lean conservative.

Topps Series 1 / Series 2 Baseball products (which both use `2025 Topps Baseball` as their CH set name — CH lumps the two series together) can now hydrate. Smaller sets are unaffected by the concurrency drop in any meaningful way (~50–100s vs ~25–50s wall clock).

---

## 2026-04-27 — Cleanup: 6,341 corrupt player_products from a bad 2026-03-29 import

While investigating Topps Chrome Basketball's inflated 1,569 player count, found that the `players.name` column had been polluted by a buggy import script that ran once on 2026-03-29 — card numbers (`"77"`, `"170"`, `"289"`) and subset codes (`"TCA-JM"`, `"RR-4"`, `"LD-10"`, `"SF-21"`) were saved as player names and given full `player_products` rows. 6,341 corrupt rows across 9 active products, all created at the same timestamp `2026-03-29 01:32:13.067755`. Every other import date is clean.

**Verified before deleting:** 0 variants attached, 0 chase card references, 0 CH-matched variants, 2,528 cascading `pricing_cache` rows (themselves bogus). Whatever code path created these has been replaced — April imports show only real names.

**Deleted:**
- 6,341 `player_products` rows (with `pricing_cache` cascade)
- 4,918 orphaned `players` rows whose only references were the deleted `player_products`

**Post-cleanup counts:**
- Topps Chrome Basketball: 1,569 → **391**
- Topps 3 Basketball: 1,369 → 344
- Topps Pristine Baseball: 1,152 → 344
- Topps Finest Basketball: 1,012 → 248
- Bowman Draft Baseball: 971 → 235
- Bowman's Best Baseball: 880 → 417
- Topps Chrome Sapphire Basketball: 866 → 331
- Topps Chrome Basketball Midnight: 801 → 232

Some count is still elevated by retired-legend insert subjects (Allen Iverson, Vince Carter, etc. on throwback inserts) auto-created by the hydrate flow with `insert_only: false`. The earlier code fix to write `insert_only: true` will land those correctly going forward; existing retired-legend rows can be flipped via PlayersManager when they're identified.

---

## 2026-04-27 — Hydrate: insert subjects no longer inflate "auto-eligible" count

Topps Chrome Basketball's product page showed 1,569 "auto-eligible" players — way too many for a basketball set with ~150–300 base players. Investigation:

- CardHedger's catalog for that set returns ~29,936 cards across base, parallels, autos, *and* inserts. Inserts include legends (Allen Iverson, Vince Carter, Dwyane Wade) and other retired players that don't appear in the checklist.
- `lib/variants-from-catalog.ts` Phase 3 auto-creates a `player_product` row for every CH-catalog player not present in the checklist — by definition these are insert subjects. But it was marking them `insert_only: false`, so they counted as base slots and showed up in "auto-eligible."

Two changes:
1. **Code:** auto-created rows now get `insert_only: true`. They still exist (so insert variants can attach for chase-card lookups) but don't count as slots and are excluded from the pricing engine.
2. **Backfill migration** (`20260427180000_backfill_insert_only_for_auto_created.sql`): flips existing rows where `hobby_sets = 0 AND bd_only_sets = 0 AND insert_only = false` — the exact signature of buggy auto-created entries. Checklist players have at least one of `hobby_sets` / `bd_only_sets` set by the parser. Admins can manually flip false positives via PlayersManager.

After running the backfill and re-hydrating Topps Chrome Basketball, the auto-eligible count should drop from 1,569 to the actual checklist size.

---

## 2026-04-27 — CH catalog refresh: remove 20k-card cap, fix dead sanity check

Topps Chrome Basketball's product page showed exactly "20,000 CH-native variants" — a suspicious round number. Found two bugs in `refreshSetCatalog`:

1. **The 20k cap was real and silently truncating.** `maxPages` defaulted to 200, page size 100 = 20,000 cards hard cap. Topps Chrome Basketball's full catalog is ~280 pages (~28k cards), so we were missing ~8k cards every refresh. Hit rate on player matching for the truncated tail dropped accordingly.

2. **The "set fall-through to corpus" sanity check was dead code.** It compared `totalPages > maxPages` *after* `totalPages` was clamped via `Math.min(firstPage.pages, maxPages)`. Always evaluated false. Wouldn't have caught a real corpus fall-through (~29k pages).

Fix: replace the conflated cap with a separate `CORPUS_FALLTHROUGH_THRESHOLD = 1000` constant. Real single sets max around 250–400 pages; anything over 1000 is a set-name mismatch we refuse upfront. `maxPages` becomes optional with no default — caller can still impose a hard cap (e.g. for testing) but production fetches all pages CH reports.

After re-running the catalog refresh, products with more than 20k CH-native variants will reflect actual catalog size.

---

## 2026-04-27 — Product lifecycle: pre_release / live / dormant

Made "what kind of product is this" a first-class concept that drives admin UX, cron behavior, and consumer rendering. Previously a product was just `is_active` (Draft / Active) and we inferred pre-release from `release_date`. That conflated two different ideas and forced pre-release products through a live pipeline they couldn't satisfy.

New `product_lifecycle` enum with three states:

- **`pre_release`** — Hype-only mode. All crons skip. Consumer page renders a new `PreReleaseLayout` with a countdown, the existing `ChaseCardsPanel`, and a player checklist enriched with 90-day historical comps from each player's existing CH cards. Rookies are deliberately data-light (no CH lookup — first-year cards mostly don't exist yet and querying for "Wemby" pre-launch returned college noise).
- **`live`** — Current behavior. Daily pricing + CH-catalog crons, full pricing engine on the consumer page.
- **`dormant`** — Wound-down state for products no one is breaking anymore. Daily crons skip; a separate biweekly cron (`/api/cron/refresh-dormant-pricing`, 1st + 15th at 7 AM UTC) keeps the snapshot from drifting too far. Consumer cases counter is hidden — the page becomes a historical reference.

Lifecycle is **orthogonal to `is_active`**: `is_active` is the publish/Draft gate, `lifecycle_status` is the kind-of-product axis. A product can be Draft + pre-release (admin prepping), Active + pre-release (consumers see hype), Active + dormant (consumers see frozen reference), etc.

**Key implementation details:**

- New `pre_release_player_snapshots` cache table backs the pre-release historical-comp lookup (24h TTL). Endpoint at `/api/pre-release/player-snapshots` fans out to CH `get90DayPrices` with a concurrency cap of 5; 100-player rosters cold-cache in well under 60s.
- Threshold of 3 raw sales in 90d separates `has_history` from data-light. Below the threshold, the player renders as "No data."
- Lifecycle transitions are admin-driven via a new `LifecycleTransitionButton` with confirm dialogs. `pre_release → live` is blocked unless `ch_set_name` is set — without it, the catalog/hydrate/pricing pipeline has nothing to anchor on. **Deliberately does NOT auto-chain catalog refresh / hydrate / pricing on flip-to-live** — admin clicks the existing Quick Actions buttons, so any failure is visible instead of silently producing a broken live product.
- All four crons (`refresh-pricing`, `refresh-ch-catalogs`, `update-scores`, plus the lib helper `listActiveProductsWithCHSet`) gate on `lifecycle_status = 'live'` in addition to the existing `is_active` filter.
- New `pre_release` and `dormant` filters on the admin products table. Lifecycle column with colored badges. Lifecycle picker on both create and edit forms (auto-derives from `release_date` on create — future = pre-release, past/today = live).

Migrations: `20260427120000_product_lifecycle.sql`, `20260427130000_pre_release_player_snapshots.sql`. Existing products were backfilled to `'live'` so behavior is unchanged on deploy.

See `docs/product-lifecycle.md` for the full architecture doc and `docs/plans/2026-04-27-product-lifecycle.md` for the planning record.

---

## 2026-04-27 — Pricing cron: throttled, stale-aware, staggered

Follow-up to the morning's middleware fix. Three more bugs surfaced once the cron actually started running:

1. **Apex → www redirect downgraded POST to GET → 405.** The orchestrator built fan-out URLs from `NEXT_PUBLIC_APP_URL` (`https://getbreakiq.com`, the apex). Vercel's apex-to-www redirect is a 301, which converts POST to GET on follow, and the worker route only accepts POST. Fix: derive base URL from `req.url` so the fan-out always hits the same canonical host the orchestrator was invoked on.

2. **"Priceable" filter checked the wrong table.** Filter queried `player_products.cardhedger_card_id`, but the matcher writes matches to `player_product_variants.cardhedger_card_id`. Recently-matched products got skipped entirely. Fix: dropped the filter — the per-product worker already short-circuits cleanly on empty input.

3. **16-way parallel fan-out starved CH bandwidth, blowing per-worker 300s caps.** Pushed 9/16 products through but the 7 heaviest (Topps Chrome Basketball family, Topps Pristine, etc.) timed out. Rebuilt the orchestrator with:
   - **Concurrency cap of 3** — keeps CH happy.
   - **Stale-first selection** — only picks products whose latest `pricing_cache.fetched_at` is null or > 22h old, oldest first. Re-runs skip already-fresh products.
   - **5 staggered cron firings** — 4:00, 4:30, 5:30, 6:00, 6:30 UTC (5 AM slot reserved for `update-scores`). Each invocation processes ~3–5 products in 270s; whatever doesn't fit gets picked up by the next firing. Across the hour-long window, all 16 products cycle through with comfortable margin.
   - Per-fetch abort at 240s, orchestrator-budget abort at 270s — the function always returns within Vercel's 300s cap, and aborted workers keep running on their own invocations.

## 2026-04-27 — Fix nightly pricing cron (silent failure since fan-out switch)

The pricing refresh cron has been silently no-op'ing every night since 2026-04-22 (commit cfdb397, "unbounded cron fan-out"). Discovered while looking at the admin Products table — most "Last Priced" timestamps were stuck at 17–35 days old.

**Root cause:** `/api/cron/refresh-pricing` fans out HTTP POSTs to `/api/admin/refresh-product-pricing` with `Authorization: Bearer ${CRON_SECRET}`. The route handler accepted that, but `middleware.ts` matches `/api/admin/*` and only checks Supabase cookie sessions — so the inner request was 307'd to `/admin/login`. Node's `fetch` follows redirects, the login HTML returned 200, the orchestrator's `await res.json().catch(() => null)` swallowed the JSON parse error, and every product reported "ok" with `summary: null`. No errors in logs, no rows written.

**Fix:** middleware now lets requests with a matching `Authorization: Bearer ${CRON_SECRET}` header pass through before the cookie check. Route handlers still validate the secret themselves.

Only `refresh-pricing` was affected — `update-scores` and `refresh-ch-catalogs` do their work inline, so they never crossed the middleware boundary.

---

## 2026-04-23 — Chase Board + Player Detail Drawer

Two new consumer-facing features: a chase card board on the break page and a per-player detail drawer with CardHedger comps.

**Chase Board:**
- New `product_chase_cards` table (migration `20260423120000`). Stores chase cards and chase players per product — type, display name, odds text, hit state, self-reported hit timestamp.
- Admin product page: new "Chase Cards" section with `ChaseCardsManager` component. Auto-recommends candidates from checklist data (lowest-odds variants → Chase Cards, highest buzz_score players → Chase Players). Admin can add from recommendations, manually add by player_product_id, and mark cards as hit.
- Hits are explicitly self-reported — no automatic pricing update. Hit cards show a "Self-Reported Hit" banner and a disclaimer note.
- Consumer break page: `DashboardConfig` replaced by `ChaseCardsPanel` — a responsive tile grid (2–5 cols) showing up to 10 chase cards and players per product. Hit cards show a prominent red "HIT — Self-Reported" banner.
- Cases count / total cost moved to a compact inline row above the tab bar (replaces the full DashboardConfig card).

**Player Detail Drawer:**
- Clicking a player name in the Player Slots table opens a `PlayerDetailDrawer` slide-over panel.
- Fires live CardHedger API call on open (not pre-cached) — shows a loader while fetching.
- Shows: all variants for that player in this product with PSA 8/9/10 prices from CH `all-prices-by-card`; recent comps (PSA 8/9/10, last 180 days) from CH `comps` endpoint.
- New API route `/api/player-comps` (GET `?playerProductId=`): fetches variants from DB, deduplicates CH card IDs, calls `getAllPrices` in parallel (capped at 15 cards), fetches comps for the base card across grades 8–10.
- Drawer is mobile-aware (full-width on small screens), closes on backdrop click or Escape key.
- `PlayerTable` gains an optional `onPlayerClick` prop — names render as blue clickable links when provided.

**Backlogged (noted in session):**
- Community "Report a Hit" form → feedback feed
- Automatic pricing recalculation when a chase card is hit (needs real-time data feed)
- PWA/mobile drawer pattern (post-beta)

---

## 2026-04-23 — After-market case pricing

Products have two distinct case prices now: MSRP (what the manufacturer sells at) and an after-market price (what cases trade for on the secondary market after launch). The two can diverge sharply — some products move 5-10x above MSRP within days of release.

**What changed:**

- New columns on `products`: `hobby_am_case_cost` and `bd_am_case_cost` (nullable NUMERIC). Admin sets these manually when the market has moved. Migration: `20260422190000_add_am_case_cost.sql`.
- Admin product form (create + edit): new "Hobby AM / Case" and "BD AM / Case" inputs in the Pricing section, labeled "(after-market)". Existing MSRP fields now labeled "(MSRP)".
- Admin product details page: AM prices appear in the Product Details grid alongside MSRP when set.
- Consumer break page: `hobbyCaseCost` / `bdCaseCost` now default to the AM price when available, falling back to MSRP. Fallback chain: `hobby_am_case_cost → hobby_case_cost → 0`.
- `DashboardConfig`: "Hobby / Case" label renamed to "Your Cost / Case". A reference row appears below the cost input showing `MSRP $X · Market $Y` (market in orange when set) — gives the user context while adjusting to their actual paid price.

No changes to `lib/engine.ts`. The slot cost equation already handles variable case costs correctly — the AM price just gives the consumer a more accurate default to start from.

**Also added:** `docs/breaker-identity-prd.md` — PRD for Phase 2, a full Breaker role with crowdsourced case pricing. Breakers enter what they actually paid per case; we aggregate across breakers (30-day median) to compute a live market rate that replaces the admin AM field automatically. Backlogged until public beta when there's enough volume to make aggregation meaningful. See backlog for phasing.

---

## 2026-04-22 — Pricing pipeline: rip out consumer refresh UI, unbounded cron fan-out, docs

With the pricing-refresh fire out and Bowman Chrome priced end-to-end, cleanup + documentation pass to lock in the architecture and make sure it scales beyond today's ~10 active products.

**Consumer break page:**
- Removed the "Refresh" / "Fetch Pricing" button at the top of `/break/[slug]`. With `/api/pricing` now a pure cache read, the button's only effect was a confusing no-op re-fetch of data the server already had. No more user-facing lever on pricing.
- Replaced the action-banner ("Live pricing not loaded — hit Fetch") with a passive informational banner ("Pricing not yet available — refreshes nightly at 4 AM UTC"). If the cache is empty, the user can't do anything about it anyway; don't pretend otherwise.
- Removed `fetching` state and `fetchLivePricing()` from `app/(consumer)/break/[slug]/page.tsx`.

**Cron fan-out:**
- Removed `FAN_OUT_CONCURRENCY = 3` throttle in `app/api/cron/refresh-pricing/route.ts`. Made sense when the orchestrator did heavy work on Hobby's 60s cap; on Pro with per-product invocations each spawning their own 300s budget, the throttle only serialized dispatch artificially. Now: `Promise.all(priceable.map(...))` — one HTTP call per product, all in flight simultaneously.
- Scales comfortably to ~50 active products. Past that, CH per-IP rate limits become the bottleneck — reintroduce a small cap at that point. Noted inline.

**Docs:**
- New `docs/pricing-architecture.md` — full pipeline diagram, design principles, scaling notes, what-we-tried-and-threw-away. Written as the canonical reference for any future "why does pricing work this way" question.
- `CLAUDE.md` Current State: "Pricing Cache Cron" entry rewritten as "Pricing Pipeline" covering the full consumer-cache-read + admin/cron writer split. Key Files section updated with `/api/pricing`, `lib/pricing-refresh.ts`, the admin worker route, and the admin button.

No schema changes. No behavior change for the cron on small products; the change only matters once there are more products than the old throttle allowed in parallel.

---

## 2026-04-22 — Hot-fix: pricing_cache upsert silently wrote 0 rows (NOT NULL on cardhedger_card_id)

After clearing the timeout + iterable bugs, the Bowman Chrome refresh ran to completion (218.5s, 278 players priced in the summary) — but the consumer break page still showed "Live pricing not loaded" with every EV column dashed. The cache was empty.

**Root cause:** `pricing_cache.cardhedger_card_id` was `text NOT NULL` from the initial schema. For CH-hydrated products, the card_id lives on variants, not on the player_product row — `pp.cardhedger_card_id` is `null`. Every row in our bulk upsert violated the constraint. The upsert error was caught and logged to `console.error` but didn't throw, so the function returned a success-looking summary based on in-memory counts of rows *we intended to write*.

**Fixes:**
- Migration `20260422170000_pricing_cache_nullable_card_id.sql`: drops NOT NULL on the column. The field is never read meaningfully anywhere in the codebase — aggregate pricing across variants has no single card_id to attribute to. Safe to nullify.
- `lib/pricing-refresh.ts`: upsert now throws on error instead of logging. If the DB ever rejects again we'll see it immediately in the UI.
- Added `cacheRowsWritten` to `RefreshSummary` + displayed it in the admin button status pill (`… · 278 cached · 218.5s`). Future schema drift can't silently zero out the write count anymore.

Deploy requires both the migration (`supabase db push` from main repo) *and* the code change. Run the migration first; the code without the migration would error loudly but not progress.

---

## 2026-04-22 — Hot-fix: `e.pricing_cache is not iterable` in cross-product fallback

With Vercel Pro's 300s budget, the per-player fallback phase in `lib/pricing-refresh.ts` finally ran to completion on Bowman Chrome — and exposed a latent bug we'd never reached before: when a player's variants all priced at 0, we fall back to `loadSiblingPricing()`, which joins `player_products` → `pricing_cache` and iterates each row's `pricing_cache` as an array. Supabase-js returns that join as a *single object* (not a one-element array) when the FK resolves to one row, so `for (const pc of row.pricing_cache)` threw `pricing_cache is not iterable`.

**Fix:** normalize the join to an array (`Array.isArray(pc) ? pc : pc ? [pc] : []`) before iterating. Added a comment calling out that Supabase's FK join shape varies by cardinality.

This bug has almost certainly been in the codebase since the original cross-product fallback was introduced — it just never fired in production because we always timed out before reaching it. Classic "the feature was broken all along, the timeout was hiding it."

---

## 2026-04-22 — Vercel Pro upgrade: `maxDuration = 300` on pricing routes

Upgraded to Vercel Pro ($20/mo) and bumped `maxDuration` from 60 → 300s on:
- `app/api/admin/refresh-product-pricing/route.ts` (admin "Refresh Pricing ↻" button)
- `app/api/cron/refresh-pricing/route.ts` (nightly orchestrator)

Graceful-deadline constants in `lib/pricing-refresh.ts` also scaled up (`BATCH_DEADLINE_MS = 270_000`, `HARD_DEADLINE_MS = 290_000`). They remain as a safety net for unusually slow CH responses — under typical latency, jumbo products (Bowman Chrome, Topps Finest) now finish in one invocation (~160s observed) without ever tripping them.

Net: the 9-PR firefight ends. No more `FUNCTION_INVOCATION_TIMEOUT` on any product we've tested. Backlog D (per-variant price cache) stays on the list — it's a "nice to have" for staggered refreshes, not a firefight response anymore.

---

## 2026-04-22 — Hot-fix: refresh-product-pricing — graceful partial completion + useful client errors

First production run of the new "Refresh Pricing ↻" admin button on 2025 Bowman Chrome (278 players, 6,481 variants) hit Vercel Hobby's 60s cap. The button surfaced the failure as `Unexpected token 'A', "An error o"... is not valid JSON` — meaningless to the user. Underlying: Vercel returns a plain-text `An error occurred...` page on function timeouts, and the client was `res.json()`-ing it. Exactly the jumbo-product case we'd called out as a known limit, but the UX was worse than "partial data" — it was "cryptic crash."

**Fixes:**
- **Server: soft + hard deadlines in `lib/pricing-refresh.ts`.** New `BATCH_DEADLINE_MS = 45s` stops enqueueing new CH chunks before we run out of runway. `HARD_DEADLINE_MS = 55s` bails out of the per-player fallback phase. Cache rows accumulated up to that point still get upserted — partial progress survives.
- **Server: `partial: true` + `batchChunksCompleted` in the summary.** Lets callers see how far we got (`45/65 chunks`, `N partial variants priced`) without inspecting logs.
- **Client: read text before JSON.** The refresh button now parses `res.text()` first, then attempts `JSON.parse()`. On 504/non-JSON, it shows the first ~140 chars of the body + a hint: *"— likely 60s cap on this jumbo product; nightly cron will complete it, or upgrade to Vercel Pro (backlog C)"*.
- **Client: partial banner.** Successful-but-partial runs render an orange `⚠ partial` prefix in the status line so admins know the data is still incomplete even though the call returned 200.

Net: on Bowman Chrome, expect ~45s of batch fetch → ~20 chunks complete → ~2,000 variants priced → ~85 players get live pricing → rest fall to cross-product / default. Re-clicking the button picks up remaining work next time (cache rows already written persist). The nightly cron still has the full 60s budget per-product and will close the gap at 4 AM UTC.

Permanent fix remains backlog items **C** (Vercel Pro → 300s, covers everything) and **D** (per-variant price cache → skip already-priced variants for incremental refresh).

---

## 2026-04-22 — Architectural pivot: `/api/pricing` is now cache-read only; heavy fetch moved off the consumer path

After eight rounds of firefighting (PRs #13–#20), we confirmed the problem was not solvable by tuning concurrency, timeouts, or retries. CH's `batch-price-estimate` legitimately takes 5–30s per 100-item chunk under our load. At 6,481 variants on 2025 Bowman Chrome, that's 65 chunks. With Vercel Hobby's 60s `maxDuration`, completing a full live refresh inside a single consumer request is mathematically impossible. So we stopped trying.

**New architecture:**
- **`POST /api/pricing` is now a cache-read.** Both GET and POST return whatever's in `pricing_cache`. The "Refresh" button on the break page no longer triggers a live CH fetch. If the cache is empty, the response is empty — users see an explicit "no prices loaded" state instead of a 504.
- **New admin endpoint: `POST /api/admin/refresh-product-pricing`.** This is where the heavy batch fetch now lives. `maxDuration = 60`. Admin cookie auth *or* `Authorization: Bearer ${CRON_SECRET}` (used by the cron).
- **`/api/cron/refresh-pricing` now fans out.** Nightly at 4 AM UTC, it queries active products with matched card IDs and HTTP-calls `/api/admin/refresh-product-pricing` once per product at concurrency 3. Each product gets its own 60s Vercel invocation instead of all of them sharing one. One slow product can't starve the others.
- **New admin button: "Refresh Pricing ↻"** on the product dashboard (`app/admin/products/[id]/page.tsx`, new WorkflowStep 6). Click to refresh a single product on demand without waiting for 4 AM. Shows a structured summary when it completes: `N players · live=X cross=Y search=Z default=W · A/B variants · Ns`.
- **Extracted logic: `lib/pricing-refresh.ts`.** Single source of truth for the refresh pipeline (batch fetch → variant-aware fallback ladder → bulk upsert). Called from both the admin endpoint and — in the future — anywhere else we need to trigger a refresh.

**What consumers see:** The break page loads instantly from cache. No more 504s, no more "no prices at all." The Refresh button still works — it just reads cache now (kept for frontend compatibility; will be renamed/removed in a follow-up).

**Known limit:** On jumbo products (6,000+ variants), the on-demand admin button can still hit 60s. Partial cache rows that were written before the cutoff survive, and the next run picks up where it left off when combined with backlog item D. See `docs/BACKLOG.md` items **C** (Vercel Pro upgrade → 300s) and **D** (per-variant price cache with `last_priced_at`) for the permanent fix.

---

## 2026-04-22 — Hot-fix: CH batch-price-estimate — 30s timeout + one retry

PR #19 moved the bottleneck. New failure mode observed in Vercel logs on 2025 Bowman Chrome: the batch phase itself was failing with `The operation was aborted due to timeout` across 5+ chunks, leaving `pricesOnly` partially empty and the function running past 60s → `FUNCTION_INVOCATION_TIMEOUT`. Root cause: `lib/cardhedger.ts`'s `post()` helper hardcodes `AbortSignal.timeout(10_000)`, and CH's `batch-price-estimate` endpoint legitimately takes 5-20s per 100-item request under our 6-way concurrent load. A 10s cap aborts valid slow requests and zeroes out 100 variant prices per abort.

**Changes:**
- `post()` now accepts an optional `{ timeoutMs }`; other callers keep 10s.
- `batchPriceEstimate` defaults its own timeout to 30s.
- `route.ts` wraps each batch chunk in a `runChunk(idx, chunk, attempt=0)` helper that retries once on any failure before giving up. One hiccup shouldn't cost us 100 variants.
- Enhanced batch-phase log now reports wall-clock time + chunk count + concurrency so latency regressions show up in Vercel observability without guessing.

---

## 2026-04-22 — Hot-fix: /api/pricing skip per-player search fallback + bulk upsert cache

PR #18 hit 60s `maxDuration` and 504'd ~26% of Refresh requests on 2025 Bowman Chrome. Vercel observability showed ~230 CardHedger calls per invocation vs. the ~60 that batch pricing alone should produce. The extra ~170 were every player whose variants all priced at 0 in the batch falling through to Level 2 `get90DayPrices(name)` — a slow per-player search call, 8 at a time. On a set where most /5, /10, /25 parallels have no recent Raw sales, that's 170+ wasted searches per refresh. Piled on top of batch fetches and 278 inline `pricing_cache` upserts, it blew the 60s budget.

**Changes:**
- **Split the worker into two paths.** If the player has variants (hydrated product), we already know CH's canonical card IDs — the batch call is authoritative. When it returns 0 for every variant, skip Level 2 entirely. Jump to Level 3 (cross-product) → Level 4 (default). Level 2 now only runs for non-hydrated products where we don't have a batch to lean on.
- **Level 3 is now a single pre-fetched map, not a per-player query.** Previously each fallback player did its own `siblings + in() + order + limit 1` Supabase query. Now we lazy-load one `player_id → latest pricing` map on first demand and look up from memory. One request total instead of N.
- **Bulk `pricing_cache` upsert at the end of the request.** Workers collect cache rows into an array; we upsert in 500-row chunks after `mapLimit` returns. Saves ~5-10s of sequential Supabase round-trips.
- **Structured log per refresh**: `live=X cross=Y search=Z default=W cache=N` so future regressions are obvious from the observability tab.

Net: Bowman Chrome goes from ~60s (timeout) to ~10-15s. CH call count drops from ~230/invocation to ~60-80.

---

## 2026-04-22 — Hot-fix: /api/pricing maxDuration + parallel batch fetches

`POST /api/pricing` had no `maxDuration` export — Vercel defaulted to 10 seconds. Batch-fetching 6,481 variant prices at 65 sequential chunks × ~240ms ≈ 15s meant every Refresh request 504'd silently. PR #17 was sound; the reason "still not doing anything" after deploy was that the function timed out before writing anything to `pricing_cache`.

**Changes:**
- `export const maxDuration = 60` at the top of `app/api/pricing/route.ts`.
- Parallelize the 100-item batch chunks with a 6-worker semaphore (same `mapLimit` shape used elsewhere). 65 chunks at concurrency 6 ≈ 2.7s wall clock instead of 15s.
- Added a single `console.log` reporting `pricesOnly.size / allVariantCardIds.length` after the batch phase so the next debug pass has an observable signal.

---

## 2026-04-22 — Hot-fix: POST /api/pricing now always refreshes live (no cache early-return)

After PR #16 shipped, clicking **Refresh** on the break page silently returned the same wrong prices the broken runs had written to `pricing_cache` — because `POST` had an early-return that replied `pricingSource: 'cached'` whenever a valid cache row existed. Worse: `'cached'` isn't counted as estimated in the UI, so the "N players using estimated pricing" banner disappeared along with the `est` badges. Users saw $8 everywhere with no indication anything was wrong.

**Fix:** `POST` no longer reads `pricing_cache`. It always runs the batch-price path and writes fresh rows. `GET` still reads cache (the fast consumer path is unchanged). The Refresh button now does what its name says.

Side effect: the nightly cron at 4 AM UTC also always does full refreshes now — previously it was a partial refresh (only unpriced pps). Cost is small — ~65 batch calls per hydrated product.

---

## 2026-04-22 — Hot-fix: CH batch-price-estimate caps at 100 items

PR #15 sent 500-item chunks to `batch-price-estimate`. CH's endpoint rejects anything over 100 items with HTTP 400 (`"List should have at most 100 items after validation"`). The try/catch around the batch call swallowed the error, logged to console, and moved on — so `pricesOnly` stayed empty, every variant hit `evMid=0`, and every player landed in the fallback chain. Net effect: the batch migration silently produced the exact same "all estimated" result that PR #15 was supposed to fix.

**Fix:** `PRICE_CHUNK = 100`. Verified directly by curling the endpoint — 500 returns 400, 100 works. For Topps Finest (6,481 variants) that's 65 sequential batch calls at ~240ms each = ~15s of batch-fetch time before the per-pp loop, well within Vercel's 60s function budget.

Lesson learned: next time, probe the endpoint's actual limits before picking a chunk size.

---

## 2026-04-22 — Pricing refresh: switch to CH `batchPriceEstimate` (Raw grade)

Per-variant `computeLiveEV` was still rate-limit-bound even after PRs #13 and #14: 8 outer workers × ~25 inner `Promise.all` calls = ~200 concurrent CH requests. Most variants came back zero → filtered out → weighted avg computed on a tiny sample → unreliable prices.

**Change:** single pre-fetch via `batchPriceEstimate({ card_id, grade: 'Raw' }, ...)` chunked at 500 items. On a hydrated product with 6,481 variants, that's ~13 HTTP calls total, done before any per-player_product work begins. The per-pp loop now just looks prices up from the pre-built `pricesOnly` map — no CH calls in the hot path for hydrated products.

**Tradeoffs:**
- EV Mid is now based on CH's "Raw" grade estimate, not the PSA 9 ladder that `computeLiveEV` preferred. Numbers will be visibly lower on cards that were previously priced off graded comps (e.g. Judge autos showing raw price instead of PSA 9). More honest — raw is what comes out of the box.
- PSA 9 / PSA 10 breakdown is no longer computed in the aggregate refresh. Deferred to a future per-player graded-comp drilldown (click row → side panel calls `getAllPrices` on demand). Added to `docs/BACKLOG.md` as "Per-player graded comp drilldown".
- Non-hydrated products (where `pp.cardhedger_card_id` is set and there are no variant rows) still use `computeLiveEV` on the `else` branch. That path is one call per pp and works fine as-is.

**UX:** added a subtle info banner on `/break/<slug>` when pricing loaded: *"EV values reflect raw card sale prices. Graded (PSA 9 / PSA 10) comps are not included — per-player graded drilldown coming soon."*

---

## 2026-04-22 — Hot-fix: zero-priced variants drag weighted EV to $0

After PR #13 shipped, the break page showed `278/278 priced` but every row still wore an "est" badge (Judge at $400, most others at the $8/$15 Level-4 defaults). The refresh was running successfully, but **every** player_product was landing in the fallback chain because `ev.evMid === 0 → throw`.

**Root cause.** Hydrated products create a row per CH card, including /5, /10, /25 parallels that have never traded individually. `computeLiveEV` returns `{evMid: 0}` for those. Every variant has `sets: 1` (hydrator default), so the weighted average `Σ(evMid × sets) / Σ(sets)` includes all the zeros — even when a player has real prices on the base card, the zero-priced parallels drag the average under the `evMid === 0` threshold and trip the throw.

**Fix (`app/api/pricing/route.ts`).** Filter out zero-priced variants before computing the weighted average. If at least one variant returned a real price, use it; only fall through to the search/default fallback chain if the *entire* variant set returned zero.

Known follow-up: parallel inner fan-out (`Promise.all(variants.map(computeLiveEV))`) can still hit CH rate limits on players with many variants. `batchPriceEstimate` in `lib/cardhedger.ts` could reduce that to one HTTP call per player_product — deferred to a separate PR since it changes the EV shape (single price vs raw/PSA 9/PSA 10 breakdown).

---

## 2026-04-22 — Hot-fix: pricing route couldn't price CH-hydrated products at scale

Consumer break page on a freshly-hydrated Topps Finest (278 player_products, 6,481 variants) was showing "269 of 278 players using estimated pricing" — `pricing_cache` was empty and the `POST /api/pricing` refresh path had three blocking issues that sent almost every player down the "estimated" fallback chain.

**Root causes** (5th instance of the PostgREST limits bug family — see PRs #4, #6, #8, #10):
1. **Variant load capped at 1000 rows + URL too long.** `.in('player_product_id', [278 UUIDs])` produced a ~9.7KB URL (Kong limit ~8KB); the response was also capped at 1000 rows, so ~85% of variants were invisible to the refresher.
2. **Hydrated `player_products.cardhedger_card_id` is null** (the CH ID lives on each variant now). When a pp's variants fell past the 1000-row cap, the code dropped into the `variants.length === 0` branch → threw → fell into the estimated fallback.
3. **Unthrottled parallel fan-out.** `Promise.all(playerProducts.map(...))` fired 278 outer workers, each firing `Promise.all(variants.map(computeLiveEV))` inside. Even if pagination had worked, the CH API would have rate-limited most of the thousands of parallel calls.

**Fix (`app/api/pricing/route.ts`):**
- `POST` and `GET` now chunk every `.in('player_product_id', ids)` lookup at 200 UUIDs.
- `POST` paginates the variant load in 1000-row pages within each chunk.
- `POST` replaces `Promise.all(...)` with a local `mapLimit` helper capped at 8 concurrent outer workers; inner per-variant `computeLiveEV` calls stay as-is, but peak CH concurrency is now bounded.

**Expected effect:** "Refresh" on the break page (or the 4 AM UTC cron) now actually populates `pricing_cache` for hydrated products. `pricingSource` should flip from `none`/`default` to `live` for the vast majority of players.

---

## 2026-04-22 — Product dashboard: hide parser workflow from UI (beta)

Post-Phase 3, the CH-Hydrate workflow reliably produces 100% variant coverage with auto-created players — so the parser workflow is no longer part of the happy path for new products. For beta we hide the parser card to eliminate decision paralysis, while keeping all parser code paths (`/admin/import-checklist`, `match-cardhedger`, `lib/checklist-parser.ts`) intact.

**Changes:**
- Removed the "Parser Workflow · Fallback" `WorkflowCard` from `app/admin/products/[id]/page.tsx`.
- CH-Hydrate card spans full width; step 2 copy updated to note that players auto-create during hydrate.
- Small footer link below the card points to `/admin/import-checklist` + the new `docs/parser-workflow-legacy.md` for admins who need the fallback.
- New `docs/parser-workflow-legacy.md` documents the 5-step parser flow, when to use it, and how to re-enable the UI card.

**Not removed:** the `WorkflowCard` component, `RunMatchingButton`, `/admin/import-checklist`, `/api/admin/match-cardhedger`, `lib/checklist-parser.ts`. Re-enabling the card is a diff against PR #9 for anyone who needs it. PR #12.

---

## 2026-04-21 — Phase 3: auto-create players + player_products from CH during hydrate

Collapses the CH-hydrate workflow from 6 steps to 4 for new products. Previously admins had to manually add every player via Manage Players before hydrating — if CH had a player that our `players` table didn't, the hydrator would skip that player's variants and surface them in the skipped-players panel. Admin then had to add them manually and re-hydrate.

Now `hydrateVariantsFromCatalog` walks the CH catalog for every player_name not already in the product's `player_products`, then:
1. Upserts into `players` with `onConflict: (name, sport_id)` — safe against players that exist globally but weren't on this product.
2. Upserts into `player_products` with `onConflict: (player_id, product_id)`.
3. Adds the new ppId to the normalized-name map, so subsequent variant inserts bind correctly.

Dedupe by normalized name so `"Luka Dončić"` and `"Luka Doncic"` in the same catalog don't create two player rows.

**Result:** `skippedPlayers` should be empty for healthy products post-hydrate. Non-zero now means an auto-create failed (concurrent write, constraint violation) rather than "admin forgot to add this player."

**New response fields:** `autoCreatedPlayers`, `autoCreatedPlayerProducts`. UI surfaces `+N new players` in the success line when > 0.

**Workflow impact:** The "Add players" step in the CH-Hydrate workflow card is now optional for new products — the hydrator handles it. Keeps the UI step for clarity but the ✓ will populate automatically once you hydrate. PR #11.

---

## 2026-04-21 — Hot-fix: odds import silently dropped 94% of variants

On Topps Finest (12,075 variants) only 732 got odds applied — a 6% bind rate. The "Unmatched odds rows" panel listed virtually every insert (Arrivals, Muse, Finishers, etc.) as not found.

**Two bugs stacked — same 1000-row cap family:**

1. `apply-odds/route.ts` loaded all variants for the product via `.eq(product_id)` — capped at 1000 rows by PostgREST. With 12,075 variants, only the first ~1000 reached the matcher. Insert variants past that window appeared "missing" from the match pool, so their odds rows landed in `unmatched`.
2. Even when a match hit, the update used `.in('id', variantIds)` where `variantIds` came from the same 1000-row sample. So `Red Refractor /5` variants past the cap never had odds applied.

**Fix:**
- Paginate the initial variant load in 1000-row chunks (same pattern as `loadCatalogIndex` and the hydrator).
- Build an `idsByName` map across the full result, then update by chunked `.in('id', slice)` of 200 UUIDs per request to stay under Kong/PostgREST's ~8KB URL limit.
- Response shape now includes `rowsUpdated` per matched subset for easier debugging.

Expected result on Topps Finest: jumps from 732 → thousands of odds-bound variants. PR #10.

---

## 2026-04-21 — Product dashboard: workflow-aware Quick Actions + skipped-players detail

Two small UX passes on top of the hydrator feature.

**Quick Actions → two numbered workflow cards.** Previously buttons were jumbled in one list; unclear which belonged to the new CH-hydrate flow vs. the legacy parser flow. Now side-by-side cards:

- **CH-Hydrate Workflow (recommended)** — 6 steps: set CH set name → add players → refresh CH catalog → hydrate variants → upload odds → view break page.
- **Parser Workflow (fallback)** — 5 steps: add players → import checklist → re-run matching → upload odds → view break page.

Each step renders with a numbered circle and a green ✓ when its state condition is met. Driven by existing + two new cheap count queries: `ch_set_cache` rows for the product's CH set name (drives step 3 done), and `player_product_variants` with `match_tier='ch-native'` (drives step 4 done). No mutation or refactor of the underlying button components — just repositioned into labeled steps.

**Skipped-players detail under Hydrate button.** Previously the "1 player skipped" line was a dead number. Now when skipped > 0, an expandable `<details>` block shows the player names + CH row counts, with a Download CSV button. Makes it trivial to paste into Manage Players. PR #9.

---

## 2026-04-21 — Hot-fix: hydrator 400 Bad Request on >1000-player products

First real click on **Hydrate Variants from CH** against Topps Finest (1011 player_products) returned `Variant delete failed: Bad Request`. Two sibling bugs of the same PostgREST 1000-row family we've been squashing:

1. `player_products` load wasn't paginated — capped at 1000, losing 11 players from the name→id map.
2. `.in('player_product_id', [1000 UUIDs])` blew past PostgREST's URL length limit (~8KB) → 400.

**The DB was not touched** — the failure happened before any delete or insert ran.

Fix: paginate the `player_products` load in 1000-row chunks; chunk the DELETE `.in()` into batches of 200 UUIDs so the URL stays under the Kong/PostgREST limit. Same pattern as PR #4 catalog pagination + PR #6 count-query fix. PR #8.

---

## 2026-04-21 — Hydrate variants from CH catalog (invert the matching pipeline)

New **Hydrate Variants from CH Catalog** button on the product dashboard. Replaces `player_product_variants` with rows sourced directly from `ch_set_cache` — every row pre-linked via `cardhedger_card_id` (match_tier = `ch-native`, match_confidence = 1.0). Matching pipeline becomes a no-op for CH-known variants; only the tail of CH-missing cards needs rescue.

Inverts the legacy flow where the XLSX/PDF parser was the source of truth for "what variants exist." On Topps Finest this meant 225 of 19,399 variants sat unmatched because the parser missed their parallel blocks. After hydrate, variants come from CH's canonical 12,097-row catalog — zero parser intermediation for that dimension.

**Opt-in per product.** Non-destructive across the codebase:
- Checklist parser + `import-checklist` route untouched — re-running "Import Checklist" restores parser-driven rows if we ever pivot off CH
- Only the hydrated product's variants are replaced; other products unaffected
- Confirmation modal on the button to prevent accidental clicks

**Field mapping:** `ch_set_cache.card_id` → `cardhedger_card_id`, `number` → `card_number`, `variant` (minus trailing `/N`) → `variant_name`, trailing `/N` → `print_run`. `is_sp` derived from SP token / SuperFractor / print_run ≤ 99. Defaults `hobby_sets=1, bd_only_sets=0` (odds PDF binds the real weighting via `hobby_odds`).

**Player match:** diacritic-stripped normalized names (Dončić ↔ Doncic). CH rows whose player isn't on the product are surfaced in `skippedPlayers` without crashing.

**Blast radius verified:** pricing (`lib/analysis.ts`, `/api/pricing`, `/api/admin/pricing-breakdown`) reads only `id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, hobby_odds` — no `variant_name` dependency. Odds import's token-fuzzy matcher works fine against CH's canonical names.

Deferred (future PRs): auto-create players from CH rows, strip variant creation from `import-checklist`, delete XLSX `parallels` detection. PR #7. Plan: `/Users/brody/.claude/plans/polymorphic-gathering-valley.md`.

---

## 2026-04-21 — Hot-fix: product dashboard counts truncated at 1000

Same Supabase 1000-row cap as PR #4 but on the UI side. Product dashboard was loading full rowsets from `player_products`, `player_product_variants`, and `pricing_cache` just to `.filter().length` them in memory. On Topps Finest every count silently pinned at 1000.

Fix: switch to `count: 'exact', head: true` for stat counts (no row cap, much less data over the wire) and push the unmatched-variants preview filter to the server with `.is('cardhedger_card_id', null).limit(50)`. PR #6.

---

## 2026-04-21 — Hot-fix: paginate `ch_set_cache` load (Supabase 1000-row cap)

`loadCatalogIndex` was only reading the first 1000 rows of `ch_set_cache` because Supabase/PostgREST caps any single response at 1000 rows by default. For small sets this was invisible — for 2025 Topps Finest Basketball (12,097 cards), ~92% of the catalog never made it into the in-memory index, so every variant missed `byNumber` and fell through to no-match.

Symptom: matching against Topps Finest immediately after the v2 descriptor deploy showed 0/40 matches. Vercel logs: `loaded catalog "2025 Topps Finest Basketball" — 1000 cards, 449 unique numbers` (actual: 12,097 cards, ~10k unique numbers).

Fix: paginate `.range(offset, offset+999)` in 1000-row chunks until a short page comes back. Applies to every catalog load — Topps Finest just made it visible. PR #4.

---

## 2026-04-21 — Topps Finest descriptor + XLSX parallel expansion

Two fixes on top of v2 matching to address the 2025-26 Topps Finest Basketball 50% match rate.

### `toppsFinestDescriptor` — new, registered before `bowmanDescriptor`
- Registry order matters: `topps finest` pattern must win over the broader `topps|bowman` match.
- Unlike Bowman, Topps Finest uses colored parallels that CH appends " Refractor" to — `"Red Geometric /5"` in the checklist is `"Red Geometric Refractor"` in CH. Added explicit `variantSynonyms` for every color + every `<color> Geometric` combo seen in the catalog.
- Removed the `/\bSuperfractor\b/gi` strip that Bowman used — Topps Finest's catalog actually uses `"SuperFractor"` (capital F) as a variant name, so stripping it killed exact-variant matches. `byNumberVariant` compares case-insensitively, so keeping the string lets it hit.
- `insertSetNames` covers section-header leakage: `"Finest Autographs"`, `"Colossal Shots Autographs"`, `"Headliners"`, `"The Man"`, `"Muse"`, `"Aura"`, `"Arrivals"`, `"First"`, `"Parallels"`, `"Teams"` (the last one is an XLSX column-header artifact).
- `cardCodePattern` + `autoPrefixes` cover Topps Finest's insert codes: `FAU-`, `RFA-`, `CS-`, `MA-`, `ESG-`, `BA-`, `AU-`, `H-`, `TM-`, `F-`, `A-`, `M-`, `P-`.

### XLSX parser — parallel expansion
The old XLSX parser collapsed every label-only row into `currentSectionName`, so each card only got one variant row equal to the LAST label before it — e.g., every Finest Autograph came out as `"SuperFractor /1"` or `"Red Geometric /5"` depending on which was last. Real checklists list 13–20+ parallels per card.

**Fix:** `ParsedCard` now has a `parallels: string[]` field. The XLSX parser tracks a per-block list of parallel labels (`"Refractor"`, `"Gold /50"`, `"SuperFractor /1"`, etc.) and attaches the full list to each data row. The base section header (`"Base - Common"`, `"Finest Autographs"`) becomes the `sectionName`. The import route expands each card into one variant row per parallel, plus a synthetic `"Base"` row (Topps checklists don't list Base explicitly but every numbered card has one).

Result on 2025-26 Topps Finest Basketball: 300 base cards × ~22 parallels + 289 autos × ~14 parallels + ~150 insert cards × various = ~12,000 variant rows, matching the CH catalog's 12,097.

### Existing imports
The DB still has skewed variants from the old parser (every card stuck on its section's last parallel label). Re-importing the checklist is the clean fix. The new `toppsFinestDescriptor` also rescues a lot of existing rows on re-match — `"Superfractor /1"` → `"SuperFractor"` via case-insensitive byNumberVariant lookup, `"Red Geometric /5"` → `"Red Geometric Refractor"` via synonym.

---

## 2026-04-21 — CH matching v2: catalog pre-load + descriptor-based knowledge

### New architecture — catalog pre-load + tiered local matcher
Fundamental refactor of the CardHedger matching pipeline. Instead of fuzzy-searching CH per variant, we pre-load the full canonical set once into a persistent Postgres cache, then match every variant locally against that index. Claude is now only invoked for the small tail of variants that miss every local tier, and it scores against in-set candidates rather than a free-form search.

**Why:** The prior 76–88% match ceiling on Bowman products wasn't structural — it was fuzzy-fallback contamination. River @ CardHedger confirmed that `/v1/cards/card-search?set=<canonical>` with pagination returns the complete set (autos included, correct `number` fields). Once the set catalog is in hand, matching by `card_number` is a local Map lookup.

**Pipeline** (see `docs/catalog-preload-architecture.md`):
1. Resolve `ch_set_name` via `/v1/cards/set-search` (one-time per product, stored on `products`)
2. Refresh catalog → paginate `card-search?set=` into `ch_set_cache` (daily cron + admin button)
3. Load `CatalogIndex` with `byNumber` and `byNumberVariant` maps
4. Per variant, walk the tier ladder: exact-variant → synonym → number-only → card-code → claude(candidates) → no-match
5. Persist `cardhedger_card_id`, `match_confidence`, `match_tier`

### Descriptor-based manufacturer knowledge (data, not classes)
`lib/card-knowledge/` refactored from imperative `BowmanKnowledge`/`PaniniKnowledge` classes to plain `ManufacturerDescriptor` objects. Each descriptor is a single `const` with `stripPatterns`, `insertSetNames`, `variantSynonyms`, `cardCodePattern`, `autoPrefixes`, and optional `claudeRules`. Adding a manufacturer = one object literal; no class/registry edits. Trivially diffable and admin-editable later.

**Registry:** `bowmanDescriptor`, `paniniDescriptor` (starter), fallback `defaultDescriptor`.

**Generic matcher** `lib/card-knowledge/match.ts` consumes descriptors against `CatalogIndex` — the same tier ladder applies to every manufacturer.

### New tables, cron, admin UI
- `ch_set_cache` — keyed by `(ch_set_name, card_id)`, indexed on `(ch_set_name, number)` and `(ch_set_name, number, lower(variant))`
- `ch_set_refresh_log` — telemetry per refresh run (pages, cards, duration, errors)
- `player_product_variants.match_tier` — tier name persisted alongside `match_confidence` for debugging
- `/api/cron/refresh-ch-catalogs` — daily at 3 AM UTC, deduplicates by `ch_set_name`, serial per-set
- `/api/admin/refresh-ch-catalog` + `RefreshCatalogButton` — on-demand refresh from product page (auto-resolves canonical name if `ch_set_name` is missing)
- Silent-failure protection: refuses to cache results exceeding `maxPages=200` (guards against set-name mismatch returning CH's full 2.9M corpus)

### Telemetry improvements
`RunMatchingButton` now shows the match tier per variant (exact-variant / synonym / number-only / card-code / claude) and catalog card count in the last-run summary. Tier column exported in debug CSV.

### MCP persisted
Added `card-hedge` MCP server to `.mcp.json` (HTTP streamable, `https://api.cardhedger.com/mcp`, `X-API-Key`) so future sessions auto-load CH tools.

**Files:** `lib/cardhedger-catalog.ts`, `lib/card-knowledge/{types,bowman,panini,default,match,index}.ts`, `lib/cardhedger.ts` (claudeCardMatchFromCandidates), `app/api/admin/match-cardhedger/route.ts` (full rewrite), `app/api/admin/refresh-ch-catalog/route.ts`, `app/api/cron/refresh-ch-catalogs/route.ts`, `app/admin/products/[id]/RefreshCatalogButton.tsx`, `supabase/migrations/20260421120000_ch_set_cache.sql`, `vercel.json`, `docs/catalog-preload-architecture.md`

---

## 2026-04-20 — CH matching improvements, ch_set_name, RLS, edit product UI

### CardHedger matching improvements
Per confirmed data from River @ CardHedger:
- **Autograph query fix:** append "Autograph" to queries for auto-prefix card codes (BMA/CPA/BPA/FDA/CA/BSA/BRA etc). Without it, base BCP cards outrank autos. Implemented in `BowmanKnowledge.AUTO_CODE_RE`.
- **Set-catalog mode:** new matching mode pre-loads full CH set via paginated `card-search?set=` (~94 calls instead of 1,000+), builds `card_number → card_id` map locally, matches at confidence 0.95. Falls back to individual Claude matching for unmatched variants. Now the default in RunMatchingButton.
- **Correct prefix names confirmed:** BMA = Best Mix Auto, BPA = Best Performances Auto, FDA = Family Tree Dual Auto, CA = Chrome Auto.
- **2025 Bowman's Best result: 88% → 96%** after River added BMA/BPA/FDA cards to catalog and set-catalog mode went live.

### ch_set_name field + set-search widget
New `ch_set_name TEXT` column on products stores the exact CardHedger canonical set name. Separates the display name (shown to consumers) from the matching key (must match CH exactly).

Product creation/edit form has a new "CardHedger Matching" section: type a query, hit "Find on CH" to call `/v1/cards/set-search`, select the canonical name from a results dropdown. Matching route uses stored `ch_set_name` directly — skips set-search at match time.

**Files:** `supabase/migrations/20260420120000_product_ch_set_name.sql`, `app/api/admin/set-search/route.ts`, `components/admin/ProductForm.tsx`, `app/api/admin/match-cardhedger/route.ts`

### RLS enabled on all tables
Closes the pre-beta security audit item. All 11 tables now have RLS enabled:
- `sports`, `products`, `players`, `player_products`, `player_product_variants`, `pricing_cache`: SELECT for anon (consumer break pages read these)
- `player_risk_flags`: SELECT for anon, active flags only (`cleared_at IS NULL`)
- `waitlist`: INSERT for anon only (public signup form), no anon reads
- `profiles`, `user_roles`, `user_breaks`: already had RLS from earlier migrations

**File:** `supabase/migrations/20260420140000_enable_rls.sql`

### Edit product page cleanup
Replaced redundant hero banner + floating "Back to Dashboard" link with a compact inline header (back arrow + icon + title + product name).

### Manufacturer rules doc updated
`docs/manufacturer-rules/bowman.md` rewritten with correct prefix names, autograph query pattern, set-catalog mode docs, CH canonical naming conventions, 2026+ Bowman Chrome merge note, and updated match rate history.

### README rewritten
Full rewrite — correct URL (getbreakiq.com), updated stack (Stripe/PSA/PostHog), all current routes (consumer + admin), product setup workflow, subscription tiers, matching overview.

---

## 2026-04-13 — Stripe subscriptions, cost analysis

### Stripe subscriptions — Hobby / Pro tiers
Two-tier subscription model: Hobby ($9.99/mo, 10 analyses + 10 slab lookups) and Pro ($24.99/mo, unlimited). 3 free lifetime analyses as trial before paywall. Promo codes enabled on Stripe Checkout.

**Infrastructure:** `lib/stripe.ts` (checkout sessions, customer portal), `lib/usage.ts` (plan-aware usage gating with atomic counter), `/api/checkout` (create session / portal), `/api/webhooks/stripe` (handles checkout.session.completed, invoice.paid, subscription.updated, subscription.deleted). Usage gates on `/api/analysis`, `/api/card-lookup`, `/api/my-breaks`.

**Schema:** `profiles` extended with `stripe_customer_id`, `stripe_subscription_id`, `subscription_plan` (free/hobby/pro), `subscription_status`, `current_period_end`, `analyses_used`, `analyses_reset_at`. Counter resets on each `invoice.paid` webhook.

**Subscribe page** at `/subscribe` — plan cards with feature comparison, "Continue with free trial" option. Onboarding now redirects to `/subscribe` after completion.

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_PRO`

---

### Cost analysis doc
`docs/cost-analysis.md` — full unit economics: fixed costs, variable costs per action, revenue vs. cost at 50/200/500 users (80/20 Hobby/Pro split), breakeven at ~27 paying users (COGS) or ~76 (with dev). Claude API costs negligible (~$12/mo at 500 users); CardHedger $300/mo flat is the only real COGS.

---

## 2026-04-11 — Onboarding wizard, security hardening, Discord + email signup

### Onboarding wizard — 3-step post-signup flow
New users redirect to `/onboarding` after OAuth callback (checks `onboarding_completed_at` on profiles). Step 1: age gate (hard block under 18). Step 2: experience level, what you collect (baseball through Other TCG), collecting eras (modern through 80s), primary break platform, monthly spend (under $150 through $5k+). Step 3: attribution source, best pull (optional free text).

**Schema:** `experience_level`, `collecting_eras TEXT[]`, `monthly_spend`, `primary_platform`, `referral_source`, `best_pull`, `onboarding_completed_at` added to profiles.

**Files:** `supabase/migrations/20260411120000_onboarding_fields.sql`, `app/api/onboarding/route.ts`, `app/(consumer)/onboarding/page.tsx`, `app/auth/callback/route.ts` (redirect logic).

---

### Security hardening — pre-beta audit
**Critical fixes:** Deleted legacy password-based admin auth route. Added `requireRole('admin','contributor')` to all 10 admin server actions. Added `checkRole()` helper in `lib/auth.ts` for API routes.

**High fixes:** Auth guards on all 9 admin API routes (403 if not admin). Auth checks on all 7 consumer API routes (401 if unauthenticated, dev bypass). 

**Medium fixes:** Security headers (X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy). Open redirect fix in admin login. XSS fix in email template (HTML-escape firstName).

---

### Discord OAuth + email signup
Replaced Apple OAuth with Discord on signup page. Added email+password signup with confirmation flow. Auth callback updated to handle both OAuth code exchange and email confirmation (token_hash + verifyOtp).

---

### PostHog analytics
PostHog installed via wizard. Server-side user identification + `user_signed_up` event tracking in auth callback.

---

## 2026-04-09 — My Breaks feature, buzz indicators fix, pricing cache cron

### My Breaks — consumer break tracking
New consumer feature at `/my-breaks`. Users log breaks they've participated in with product, team, break type, cases, asking price, and platform (Fanatics Live, Whatnot, eBay, Dave & Adam's, Layton Sports, Local Card Shop, Other). Two entry points:

- **"New Break"** (pre-break) — runs live BreakIQ analysis, snapshots signal/fair value/narrative to the DB, status=pending. User comes back after to rate the outcome.
- **"Log Previous"** (post-break) — logs everything at once including outcome rating (Win/Mediocre/Bust).

Pending breaks can be completed (outcome + optional notes + analysis feedback) or abandoned ("Didn't buy in" — outbid, changed mind, etc.).

**Analysis snapshot:** Every break stores `snapshot_signal`, `snapshot_value_pct`, `snapshot_fair_value`, `snapshot_analysis`, `snapshot_top_players` (JSONB), `snapshot_risk_flags` (JSONB), `snapshot_hv_players` at creation time. Frozen — doesn't shift as prices change.

**Analysis feedback:** "Was our analysis helpful?" (thumbs up/down) asked during break completion. Stored as `analysis_feedback` column. Enables measuring analysis quality separate from break outcomes.

**Stats row:** Breaks count, Total Spent (excludes abandoned), W/M/B record breakdown (color-coded).

**Filters:** Time (Week/Month/Quarter/6 Months/Year), Platform, Outcome. Filters apply to both stats and break list.

**CSV export:** Downloads all non-abandoned breaks. **CSV import:** Drag-and-drop upload zone on "Log Previous" form with downloadable template. Fuzzy-matches product names.

**Shared analysis module:** Extracted `runBreakAnalysis()` from the analysis route into `lib/analysis.ts`. Both BreakIQ Sayz and My Breaks call this function.

**Schema:** `user_breaks` table with RLS (self read/insert/update), indexes on user_id, status, product_id, platform, created_at. Chase/hit card tables designed but deferred to Phase 2.

**Files:** `supabase/migrations/20260409120000_my_breaks.sql`, `supabase/migrations/20260409140000_analysis_feedback.sql`, `lib/analysis.ts` (new), `lib/types.ts` (UserBreak, Platform, BreakOutcome types), `app/api/my-breaks/route.ts` (new), `app/api/my-breaks/[id]/route.ts` (new), `app/(consumer)/my-breaks/page.tsx` (new), `app/api/analysis/route.ts` (refactored to thin wrapper), `app/(consumer)/ConsumerNav.tsx` (My Breaks link), `middleware.ts` (/my-breaks route), `app/(consumer)/page.tsx` (My Breaks promo replacing BreakIQ Sayz promo)

---

### Buzz indicators data fix
The social currency badges (↑↓ ★ ⚡ ⚑) were already implemented in PlayerTable and TeamSlotsTable but `buzz_score`, `breakerz_score`, and `is_high_volatility` weren't being selected in the pricing API's GET path. Fixed both GET and POST selects.

---

### Pricing cache nightly cron
`app/api/cron/refresh-pricing/route.ts` — loops through all `is_active` products with matched card IDs, calls the pricing POST for each. `vercel.json` schedules at 4 AM UTC daily. Protected with `CRON_SECRET` bearer token.

---

### Responsible gambling footer
"Gambling problem? Call or text 1-800-GAMBLER" banner on homepage above the stats footer.

---

### Component rename
`components/breakerz/` → `components/breakiq/` for brand consistency.

---

## 2026-04-06 — PSA API integration, Slab Analysis UX redesign, CardHedger matching strategy

### PSA API integration — Slab Analysis cert verification
Slab Analysis now calls the PSA public API (`api.psacard.com`) for PSA cert lookups. PSA provides authoritative card identity + population data. CardHedger provides market-wide grade pricing and recent comps.

**Lookup flow:** PSA API → card identity + pop data → CH name search for card_id → `getAllPrices` + `getComps` at the cert's grade. If PSA fails, falls back to CH cert identity for the name search.

**Pricing change:** switched from cert-specific sale history (`pricesByCert`) to market-wide grade pricing (`getAllPrices` + `getComps`). Avg of all PSA 7 sales is more reliable than the history of one specific cert.

**PSA Insights panel:** cert #, label type, pop at this grade, pop higher (in amber). Mirrors eBay's PSA insights modal.

**Env var:** `PSA_API_KEY` — bearer token for `api.psacard.com`. Set in Vercel (all environments) and `.env.local`. Gotcha: variable name typo in Vercel will silently fall back to CH identity only — watch for "PSA_API_KEY not configured" in the amber debug strip.

**Files:** `lib/psa.ts` (new — `getCertByNumber()`), `app/api/card-lookup/route.ts` (updated cert action).

---

### Slab Analysis UX redesign
- Renamed "Card Lookup" → "Slab Analysis" throughout
- Added **Enter Cert #** tab alongside Upload Image — users can look up a cert directly without an image (enter cert number + select PSA/BGS/SGC grader, press Enter or Look Up)
- PSA Verified badge shows grade description (e.g. "GEM-MT 10") + pop count + pop higher when PSA confirms
- Extracted `ResultsPanel` as a shared component used by both input paths

**File:** `app/(consumer)/card-lookup/page.tsx`

---

### CardHedger matching strategy doc + refined questions list
First-principles analysis of the CH entity matching problem saved to `docs/cardhedger-matching-strategy.md`. Refined questions/scenarios list for the CH team conversation at `docs/cardhedger-questions.md` — organized into Priority 1 (blocking, 3 questions), Priority 2 (structural, 4 questions), Priority 3 (efficiency/partnership, 4 questions).

---

### Waitlist redesigned as landing page
Full landing page layout replacing the minimal form. Two-column desktop layout: left = BreakIQ brand + "Private Beta" pill + feature list (BreakIQ Sayz, Live Slot Pricing, Slab Analysis), right = beta access form. Background gradient with glow effects. Updated success state copy.

**File:** `app/waitlist/page.tsx`

---

## 2026-04-06 — Pricing Audit Panel, Slab Analysis, profile page, staging tooling

### Pricing Audit Panel — admin product dashboard
Kyle needed a spreadsheet-like view of the full pricing calculation to verify the math and compare against his manual Excel model. Added a collapsible "Pricing Audit" section to `/admin/products/[id]/` that shows every player with EV Low/Mid/High, odds coverage, effective score, weight, weight %, hobby slot cost, and BD slot cost.

Break config (cases × cost) is editable inline — changing a value recalculates all slot costs client-side instantly with no new API calls. Export to CSV for direct comparison against Kyle's spreadsheet.

**Key implementation detail:** Fetching pricing_cache and variants with `.in(player_product_id, ppIds)` for large products (866 players on Topps Finest) generates URLs that exceed PostgREST's limit and return 400 Bad Request. Fixed by using join-based filters (`player_products!inner(product_id)`) instead, matching the pattern already used in the product dashboard page.

**Files:** `app/api/admin/pricing-breakdown/[productId]/route.ts` (new), `app/admin/products/[id]/PricingBreakdownPanel.tsx` (new), `app/admin/products/[id]/page.tsx` (updated).

---

### Consumer profile page
Added `/profile` for beta users. Fields: first name, last name, date of birth (used to compute `is_over_18` boolean — DOB is not stored), favorite sports, chasing teams, chasing players (free text → TEXT[] arrays). Age verification badge renders live as DOB is entered.

**Files:** `app/(consumer)/profile/page.tsx` (new), `app/api/profile/route.ts` (new GET + PUT), `supabase/migrations/20260403140000_profiles_consumer_fields.sql` (adds `first_name`, `last_name`, `is_over_18`, `favorite_sports`, `chasing_teams`, `chasing_players` to profiles + self-update RLS policy).

---

### Slab Analysis on consumer hero
Replaced the "Browse Products" CTA with a "Slab Analysis" button linking to `/card-lookup`. Moved `card-lookup` page into the `(consumer)` route group so it gets the nav bar and auth gating. Added `/card-lookup` to middleware matcher and `isConsumerRoute` check.

---

### Admin login link on waitlist page
Added a dim "Admin login" link at the bottom of `/waitlist` so admins can find their way in without knowing the direct URL.

---

### Copy-prod-to-staging script
`scripts/copy-prod-to-staging.mjs` — Node.js script using `@supabase/supabase-js` to copy product data (sports, products, players, player_products, player_product_variants) from production to staging. Clears staging tables in reverse dependency order first (so foreign keys don't block deletes), then paginates fetches with `.range()` to handle Supabase's 1000-row default limit. Uses `columnsExclude` to strip staging-only generated columns (e.g. `total_sets`) from upsert payloads.

**Usage:** `STAGING_SERVICE_ROLE_KEY=<key> node scripts/copy-prod-to-staging.mjs`

---

## 2026-04-03 — Consumer auth gating + nav bar

### Consumer routes were publicly accessible
`/`, `/break/*`, and `/analysis/*` had no auth protection — anyone with the URL could access everything. The middleware comment noted this was disabled pending Phase 3 OAuth, which is now live.

**Fix:** Added a `(consumer)` Next.js route group wrapping all three routes. The shared layout (`app/(consumer)/layout.tsx`) checks the Supabase session server-side and redirects to `/waitlist` if not authenticated. Middleware updated to also gate these routes at the edge as a first-line defense.

### No visible login/logout UI on consumer pages
Authenticated users had no way to see their auth state or sign out without manually navigating to `/admin/login`.

**Fix:** Added `ConsumerNav` — a slim sticky header rendered by the consumer layout. Shows the BreakIQ brand and a Sign Out button. For admin/contributor users, also shows a "Consumer View / Admin Portal" mode switcher dropdown. Sign out redirects to `/waitlist` (not `/admin/login`).

**Files changed:** `middleware.ts`, `app/(consumer)/layout.tsx` (new), `app/(consumer)/ConsumerNav.tsx` (new), `app/(consumer)/actions.ts` (new), `app/(consumer)/page.tsx` (moved from `app/page.tsx`), `app/(consumer)/break/[slug]/page.tsx` (moved), `app/(consumer)/analysis/page.tsx` (moved).

---

## 2026-04-02 — Team Slots bug fix, XLSX parser improvements, CH matching fixes

### Claude JSON parse failures in card matching
Claude Haiku was occasionally returning explanation text after the JSON object (e.g. `{"card_id": null, "confidence": 0}\n\nThe query specifies...`). The closing fence strip regex `/\n?```$/` failed because the string didn't end with backticks, causing a parse error and unnecessary fallback to the token matcher.

**Fix (`lib/cardhedger.ts`):** Replaced fence-strip regex with `indexOf('{')` / `lastIndexOf('}')` extraction — robust to any wrapping or trailing text. Also bumped `max_tokens` from 64 → 128 so the response isn't truncated mid-fence.

### CardHedger questions doc
Created `docs/cardhedger-questions.md` — a running list of 13 questions for the CH team across catalog coverage, API behavior, terminology, and partnership. Seeded from real issues hit during 2025 Bowman Chrome Baseball matching (CPA-* autos not in catalog, missing `number` field on autos, multi-player card handling, etc.).

## 2026-04-02 — Team Slots bug fix + XLSX parser improvements

### Team Slots showing player names instead of team names
The Team Slots table was grouping by `players.team`, which was populated with player names instead of MLB team/college names after importing certain Bowman XLSX files.

**Root cause:** The 2025 Bowman Chrome Baseball XLSX contains two index sheets (`Teams`, `Topps Master Checklist`) with different column layouts or cross-product scope. When processed as regular card data, the `Teams` sheet wrote player names into the `team` field; the `Topps Master Checklist` sheet added ~16,000 unrelated players from all Topps products.

**Fix (`lib/checklist-parser.ts`):**
- Added `"Teams"`, `"MLB Teams"`, and `"Topps Master Checklist"` to `XLSX_SKIP_SHEETS`
- Also strips trailing commas from the `team` field (same cleanup already applied to player names)

**Recovery:** Deleted all `player_products` + orphaned players for the affected product via SQL, then re-imported with the corrected parser.

**Documented in:** `docs/manufacturer-rules/bowman.md` — new "Index sheets to skip" section with full sheet inventory for 2025 Bowman Chrome Baseball.

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

**Design system (`components/breakiq/ds/`)**
- New DS component library: `ElevatedCard`, `StepHeader`, `FormLabel`, `SegmentedControl`, `CounterInput`, `LargeCTAButton` — all using terminal CSS custom properties
- Design tokens stored at `design-assets/design-system-tokens.json`; component specs at `design-assets/DESIGN_SYSTEM_EXPORT.md`
- All DS components exported from `components/breakiq/ds/index.ts`
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

**`components/breakiq/DashboardConfig.tsx`**
- Rebuilt using DS components: `ElevatedCard`, `FormLabel`, `CounterInput`

**`components/breakiq/TeamSlotsTable.tsx`, `PlayerTable.tsx`**
- Restyled with terminal design system vars, Social Currency badges updated

**`components/breakiq/ProductCard.tsx`**
- New component matching Figma Make product card design

**New files:** `components/breakiq/ds/` (6 DS components + index), `components/breakiq/SignalBadge.tsx`, `components/breakiq/SocialBadges.tsx`, `design-assets/DESIGN_SYSTEM_EXPORT.md`, `design-assets/design-system-tokens.json`
**Modified:** `app/analysis/page.tsx`, `app/break/[slug]/page.tsx`, `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/breakiq/DashboardConfig.tsx`, `components/breakiq/PlayerTable.tsx`, `components/breakiq/TeamSlotsTable.tsx`

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
