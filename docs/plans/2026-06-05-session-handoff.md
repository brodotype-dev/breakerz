# Session handoff — 2026-06-03 → 06-05

Big multi-day session. Everything below is **merged + live on prod** (PRs #177–#192) unless flagged. Pick up from "Open / next" at the bottom.

## What shipped (by theme)

### My Breaks V2 + analyzer relabels
- **#177** — My Breaks "solidity pass": New Break renders the verdict inline (was discarded), honest stats (Avg vs Fair + Signal Mix with sample-size guardrails), edit/delete on pending+completed cards (`PATCH`/`DELETE` on `/api/my-breaks/[id]`), "Passed on" drawer for abandoned. Plan: [docs/plans/2026-05-30-my-breaks-v2-handoff.md](2026-05-30-my-breaks-v2-handoff.md). QA checklist for Kyle lives in Brody's Obsidian inbox.
- Relabels (in #177): **Teams → "Teams / PYT"**, **Specific player slots → "Player Slots - PTP (Optional)"** across My Breaks, `/analysis`, inline break-page analyzer.

### Players-as-global re-model
- **#178** — HV (`is_high_volatility`) and risk flags moved from product-scoped to **player-global** (cards are product-specific, players are global). B-score stays product-scoped. New **`/admin/players`** directory (search + per-player icon/HV/flag editing); product players page is now a read-only roster + link to global. Two migrations applied to prod (phase-1 additive + phase-2 cleanup that deleted 49 redundant Discord fan-out rows). Full plan: [docs/plans/2026-06-02-players-global-attributes.md](2026-06-02-players-global-attributes.md).
- **#180** — `/admin/players` gains **Sport / Product / Rookie filters** + click-a-name → that player's products (lazy). Admin search API `/api/admin/players/search` (q/sport/productId/rookie).

### Data cleanup + import hardening
- **#181** — `/admin/players` hides card-code junk (`looksLikeRealPlayerName`), widened `CARD_SUBSET_CODE_RE` to `{1,6}-{1,8}`, and **deleted 2,892 quarantined junk player rows** (migration; backed up to `archive_junk_players_20260603` + `_player_products_20260603`).
- **#182** — **import guards** at the aggregation chokepoint (`computePlayerAggregates`): `normalizePlayerName` (strips glued card-number prefix → "1 Jacob Wilson"→"Jacob Wilson") + `isNonPlayerName` (rejects headers/numbers/codes). Stops the junk recurring. Verify: `npx tsx scripts/verify-name-guards.ts`.
- **#183** — **deleted 31** more header/number-prefixed-dupe junk rows (migration; backed up to `archive_junk_*_20260603_b`).

### Discord wrong-player matching (the Russell Wilson saga)
- **#179** — `/break-price`: inject the player **roster into the prompt** (it was validated against but never shown to the model → slug ids).
- **#184 / #185** — soft **mismatch warning** ("⚠ '{name}' isn't in your text") on `/insight` + `/break-price` when the bound player's name isn't in the text. Warn-never-drop, fuzzy/accent/misspelling tolerant.
- **#190** — `/insight` **auto-correct re-resolution**: when the bound name isn't in the text AND exactly one roster player is *strongly* present (surname+first, fuzzy), re-bind at parse time. "Russel Wilson retired" → Russell Wilson.
- **#191** — `/insight` **multi-block JSON salvage**: Haiku self-corrects (emits a wrong block, prose, then a corrected block); `parseInsights` now uses the robust `salvageJsonArrayObjects` walker and takes the **last** fenced block. This was the real reason the retry showed "couldn't extract."
- **#192** — **Model upgrade Haiku 4.5 → Sonnet 4.6** across all 9 call-sites, centralized in **[lib/models.ts](../../lib/models.ts)**. Attacks the associative-substitution class at the source; the three layers above are now backstops. Cost immaterial at our volume; confidence prioritized. Rollback = one line in `lib/models.ts`.

### CardHedger re-matching + feeds (acted on River's email)
- **#186** — `/api/admin/match-cardhedger` accepts `Bearer CRON_SECRET` so re-matching is scriptable.
- Drove a re-match via **[scripts/drive-rematch.mjs](../../scripts/drive-rematch.mjs)** (multi-pass): **2025 Topps Chrome Football ~50% → 99.3% matched (+2,489 cards, 0 review)** + pricing refresh. Playbook: [docs/cardhedger-rematch.md](../cardhedger-rematch.md).
- **#187** — **CardHedger Additions feed** (CH's `additions-summary` = release-calendar proxy): `ch_additions` table + nightly cron `/api/cron/refresh-ch-additions` (02:30 UTC) + Data Health panel that flags additions to sets we track (re-match signal). Populated.
- **#188** — committed the driver + the rematch playbook + CLAUDE.md.
- **#189** — fixed `/admin/data-health` **statement timeout (57014)** (the "everything slow" report) — replaced the per-product query fan-out with a single `get_ch_coverage()` SQL aggregate (MATERIALIZED CTEs + `player_products(product_id)` index): 2.4s → ~104ms. Additions panel moved below coverage + made collapsible.

## Prod / DB state to know
- **Migrations applied via Supabase MCP** (all have files in `supabase/migrations/`): `20260602120000_players_global_attributes`, `20260602130000_..._cleanup`, `20260603120000_delete_junk_player_rows`, `20260603130000_delete_header_and_prefixed_junk`, `20260604120000_ch_additions`, `20260604140000_ch_coverage_rpc` (+ materialized follow-up).
- **Backup/archive tables** (admin-only): `archive_junk_players_20260603`, `archive_junk_player_products_20260603`, `archive_junk_players_20260603_b`, `archive_junk_player_products_20260603_b`. Safe to drop once the cleanup is trusted (no rush).
- Players table: ~7,789 → **~4,900** after junk deletion.
- CardHedger **coverage gaps** (CH doesn't have these — not a matcher fix): **O-Pee-Chee Platinum Hockey** (9,922 unmatched, no `ch_set_name`), **2025-26 Topps Motif Basketball** (769). These are an ask for River.

## Open / next (resume here)
1. **Draft the reply to River (CardHedger)** — the original goal of the CH thread; all data now in hand:
   - Sparse/Chrome-low → we re-ran matching per your tip, Chrome Football 50%→99%.
   - Release calendar → using `additions-summary`, thanks.
   - Series 1/2 → concern is duplicate `ch_set_name` bleeding Series 2 into Series 1 pricing (the 2026-05-10 split bug).
   - Please add: **O-Pee-Chee Platinum Hockey** + **2025-26 Topps Motif Basketball**.
   - Source emails: River's responses + Brody's questions (screenshots in the 06-04 chat).
2. **QA the Sonnet 4.6 upgrade** — eyeball a few `/insight` captures (incl. "Russell Wilson retired" → should bind Russell Wilson) + a break verdict. Rollback knob: `lib/models.ts`.
3. **Extend auto-correct to `/break-price`** player rows (deferred; less urgent now that the model is stronger).
4. **Drop the archive_* tables** once junk cleanup is confidently verified.
5. Pre-existing roadmap (unchanged) still in CLAUDE.md "Next up": web-sourced-intel Slices 5/6, streaming pricing refresh before product count crosses 25, Phase 5 C-score (blocked on Kyle), My Breaks Phase 2.

## Notes / gotchas reinforced this session
- Apex `getbreakiq.com` 307-redirects to `www` — scripts must hit `www` (CLAUDE.md). `drive-rematch.mjs` forces it.
- This worktree's `.env.local` has a blank `SUPABASE_SERVICE_ROLE_KEY` (build-only) — local scripts that need the DB won't auth; drive things via prod routes (cron bearer) or Supabase MCP.
- Function-adding migrations: `NOTIFY pgrst, 'reload schema';` + `REVOKE EXECUTE` (gotchas #10/#12) — done for `get_ch_coverage`.
