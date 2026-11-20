-- Record the variant coverage each cached EV was computed from.
--
-- WHY: a player's ev_mid is a sets-weighted average over the variants that
-- priced on that run. When a CardHedger chunk fails mid-run the surviving
-- subset can be small and skewed cheap, so the average collapses — and because
-- the result is still > 0 it was written over a good price as authoritative.
-- Six nights in the 35 days to 2026-11-20 did exactly that (Oct 29: 139
-- players, average −79%; Nov 4: 91; Oct 23: 68), each recovering the next day,
-- while cron_run_log reported errors = 0 throughout. Nothing recorded how many
-- variants backed a given number, so a thin-coverage EV was indistinguishable
-- from a well-covered one — which is why this ran unnoticed for two months.
--
-- Both columns are nullable: the sibling / search / default fallback rungs are
-- not variant-aggregated and legitimately have no coverage to report, and rows
-- written before this migration have none either. lib/pricing-refresh.ts treats
-- null as "unknown" and leaves the coverage guard inert for that row, so the
-- guard can only ever protect a price it has a prior measurement for.
--
-- ORDERING: apply this BEFORE deploying the matching code. The refresh writes
-- these columns on every hydrated row and flushCacheRows throws on upsert
-- errors, so code-first would fail every nightly refresh.

alter table pricing_cache
  add column if not exists variants_priced integer,
  add column if not exists variants_total  integer;

comment on column pricing_cache.variants_priced is
  'Variants that returned a usable price on the run that wrote this row. NULL = not variant-aggregated (fallback rung) or written before 2026-11-20. Compared against the next run to catch thin-coverage collapses.';

comment on column pricing_cache.variants_total is
  'Aggregatable variants that existed for this player_product at write time (1/1s excluded), priced or not.';

-- Same on the history table, so trend features can discount low-coverage days
-- instead of rendering our own pipeline wobble as a market move.
alter table player_product_ev_snapshots
  add column if not exists variants_priced integer;

comment on column player_product_ev_snapshots.variants_priced is
  'Coverage behind this day''s ev_mid. NULL for days captured before 2026-11-20. A day with unusually low coverage should not be read as a market move.';
