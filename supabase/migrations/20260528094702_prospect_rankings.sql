-- prospect_rankings — Track A objective player-attribute store (Slice 1)
--
-- Time-series table of player rankings scraped from external sources
-- (MLB Pipeline Top 100 first; ESPN Big Board / NHL Central Scouting /
-- NFL consensus boards later). One row per (player, source, scrape) so
-- the history is complete and we can detect "Williams jumped 12 spots"
-- in Slice 2's diff logic.
--
-- Plan: web-sourced-intel brainstorm, 2026-05-27 (Bucket B). Slice 1
-- writes raw rankings directly (rank position is objective fact, no
-- Discord approval — see architecture step 3). The engine does NOT read
-- this table yet; activation is gated behind feature_flags.prospect_rank_enabled
-- and lands in a later slice after shadow-mode validation.
--
-- ADMIN-ONLY (CLAUDE.md gotcha #12): only supabaseAdmin (service role)
-- reads/writes this. REVOKE ALL from anon/authenticated so it's never
-- exposed via the Data API.

create table if not exists prospect_rankings (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players(id) on delete cascade,
  -- Source identifier, snake_case. Slice 1: 'mlb_pipeline'. Future:
  -- 'espn_big_board', 'nhl_central_scouting', '247sports', etc.
  source      text not null,
  -- The numeric rank within the source's list at capture time (1 = top).
  rank_value  integer not null,
  -- What population the rank is over: 'top_100', 'draft_board',
  -- 'positional', etc. Free text — the scraper sets it per source so a
  -- "#3 catcher" (positional) doesn't get compared against a "#3 overall".
  rank_scope  text not null default 'overall',
  -- The exact URL the ranking was scraped from, for the audit trail.
  source_url  text,
  -- Publication / capture timestamp. For sources that stamp a "rankings
  -- updated" date we use that; otherwise scrape time.
  captured_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- Diff logic (Slice 2) reads "most recent row per (player, source)" a lot,
-- and the importer dedups on (player, source, captured_at). Index both.
create index if not exists prospect_rankings_player_source_idx
  on prospect_rankings (player_id, source, captured_at desc);
create index if not exists prospect_rankings_source_captured_idx
  on prospect_rankings (source, captured_at desc);

alter table prospect_rankings enable row level security;
-- No policies — service-role only (RLS-enabled-no-policy locks out
-- anon/authenticated even before the REVOKE below).
revoke all on table prospect_rankings from anon, authenticated;

comment on table prospect_rankings is
  'Track A objective player rankings scraped from external sources (MLB Pipeline, etc.). Time-series, one row per (player, source, scrape). Service-role only. Engine reads gated behind feature_flags.prospect_rank_enabled.';

-- Engine-activation flag. Defaults false: the engine does not read
-- prospect_rankings until this is flipped (after shadow-mode validation
-- per the plan's Slice 6). Mirrors verdict_observation_context_enabled.
insert into feature_flags (key, enabled, description)
values (
  'prospect_rank_enabled',
  false,
  'When true, lib/engine.ts computeEffectiveScore adds a prospectRankBoost term sourced from the most recent prospect_rankings row. Ship + shadow-validate via Market Delta Watch before enabling. See web-sourced-intel brainstorm Slice 6.'
)
on conflict (key) do nothing;
