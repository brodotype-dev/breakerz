-- Pre-release snapshots: add PSA 9 90-day comp columns.
--
-- The consumer pre-release page splits the graded breakout into PSA 9 / PSA 10
-- micro-cells when both are present. Existing rows leave both new columns null
-- and the next snapshot fetch backfills them.

ALTER TABLE pre_release_player_snapshots
  ADD COLUMN IF NOT EXISTS psa9_avg_90d   numeric(10, 2),
  ADD COLUMN IF NOT EXISTS psa9_sales_90d integer;
