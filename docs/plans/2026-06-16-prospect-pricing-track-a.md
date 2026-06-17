# Prospect Pricing — Track A Activation + Pre-Release Base EV Floor

**Status (2026-06-16):** Code shipped (Slices 1, 2, 4, 7). Rollout steps (Slice 3 backfill, flag flip, Slices 5/6 verification) are operational, done post-deploy. Concept C ("1st Bowman") deferred to a separate plan.

## Problem (Kyle, 2026-06-13/14)
The pricing model weights "rookie" cards higher, but Bowman products have **no rookies** — every player is a prospect. Headline Bowman 1st / Chrome / Draft cards were systematically underweighted, and the engine had no prospect-rank concept *active*. Track A infra was ~95% built but **off** because the only column the engine reads — `players.prospect_rank` — was never populated (the MLB Pipeline scraper wrote a separate `prospect_rankings` time-series table; the two lanes never connected).

## What shipped

- **Slice 1 — importer dual-write.** [lib/prospect-rankings-import.ts](../../lib/prospect-rankings-import.ts) `importMlbPipelineRankings` now, after the `prospect_rankings` insert, dual-writes `players.prospect_rank` / `prospect_rank_source` / `prospect_rank_updated_at` for each matched row (per-id updates in 50-row parallel chunks). `prospect_status` deliberately untouched (institutional importer owns it). Summary gains `denormUpdated`.
- **Slice 2 — kill switch.** New server-only [lib/feature-flags.ts](../../lib/feature-flags.ts) `isFeatureFlagEnabled(key)` (60s TTL cache) + `PROSPECT_RANK_FLAG`. Gated at the async call sites (Option A — `computeProspectAdjustment` stays sync): [lib/break-page-data.ts](../../lib/break-page-data.ts), [lib/analysis.ts](../../lib/analysis.ts). Flag off → `prospect_score_adj = 0` → WhyThisPriceCard Track A row naturally hides.
- **Slice 4 — rank-tiered base EV floor.** New [lib/pre-release-base-ev.ts](../../lib/pre-release-base-ev.ts) `computeFallbackBaseEV({ isRookie, prospectRank, productLine })` — top-10 $80 / #11–30 $50 / #31–100 $25 / in-Bowman-unranked $15 / legacy rookie $15 / generic $8. Bowman-scoped (`product_line.startsWith('bowman_')`). Swapped the `$15/$8` fallbacks in [lib/pricing-refresh.ts](../../lib/pricing-refresh.ts) (2 sites, + added `product_line`/`prospect_rank` to the selects) and [lib/analysis.ts](../../lib/analysis.ts) (2 sites). Same flag gates it; off → legacy `$15/$8`. **Floor numbers are calibrated guesses — tune via Market Delta Watch.**
- **Slice 7 — visual rank chip.** New [components/breakiq/ds/ProspectRankChip.tsx](../../components/breakiq/ds/ProspectRankChip.tsx) — `#7` chip, tier-colored (gold ≤10 / blue ≤30 / neutral ≤100) matching `PROSPECT_RANK_TIERS`, `title` tooltip with source + date. **Independent of the flag** (rank is a fact). Dropped next to the `RC` badge in [PlayerTable](../../components/breakiq/PlayerTable.tsx), [TeamSlotsTable](../../components/breakiq/TeamSlotsTable.tsx), [PlayerDetailDrawer](../../components/breakiq/PlayerDetailDrawer.tsx) (3 prospect fields threaded through [/api/player-comps](../../app/api/player-comps/route.ts)).

No new schema — the 4 `players` columns + `feature_flags.prospect_rank_enabled` row already existed.

## Rollout (operational, post-merge)

1. **Deploy** with flag OFF — zero behavior change (nobody has a rank yet).
2. **Backfill** `players.prospect_rank` from existing `prospect_rankings` (one-shot SQL via Supabase MCP, idempotent, guarded against overwriting newer institutional data). ~40 baseball players in active products get ranked.
3. **Verify** chips render + pricing UNCHANGED (flag still off).
4. **Flip** `feature_flags.prospect_rank_enabled = true` → Bowman top-prospect base EV + weight share climb. **Outward-facing pricing change — confirm with Brody first.**
5. **Watch** Market Delta Watch 2–3 days; tune `lib/pre-release-base-ev.ts` (floor) or `lib/prospect-score.ts` (share) constants. Flag is the kill switch (~60s TTL).

## Out of scope
Concept C "1st Bowman" detection (deferred — parse the card name, not a cross-product DB lookup, since beta doesn't carry a player's actual 1st Bowman product); non-Bowman prospect products; cron the scraper; source-priority rules; NBA/NFL/NHL sources (no `prospect_rankings` data yet → null rank → legacy behavior, no change); per-Bowman-variant floors; admin flag-toggle UI. See the full brief in the session for rationale.
