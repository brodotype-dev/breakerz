-- Track A — Objective prospect attributes (bulk-importable, institutional source).
--
-- One column set, all sports. Per-sport interpretation lives in the source
-- string ("MLB Pipeline 2026-05", "ESPN Big Board 2025-11", etc.) and in
-- lib/prospect-score.ts's per-sport multiplier.
--
-- See docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.

alter table players
  add column if not exists prospect_rank integer,
  add column if not exists prospect_status text,
  add column if not exists prospect_rank_source text,
  add column if not exists prospect_rank_updated_at timestamptz;

alter table players
  drop constraint if exists players_prospect_status_check;
alter table players
  add constraint players_prospect_status_check
  check (prospect_status is null or prospect_status in ('graduated_rc', 'international_signee'));

comment on column players.prospect_rank is
  'Ordinal rank within sport pipeline (1 = top). Source attribution lives in prospect_rank_source.';
comment on column players.prospect_status is
  'graduated_rc | international_signee | NULL. Drives a small additive bump in computeProspectAdjustment.';
comment on column players.prospect_rank_source is
  'Institutional provenance string, e.g. "MLB Pipeline 2026-05". Personal names rejected at import time.';
