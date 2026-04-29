-- My Breaks v2: support the same multi-team / multi-player / mixed-format
-- bundle shape as the new /analysis flow. Old columns (team, break_type,
-- num_cases) become nullable so legacy rows survive but new inserts skip
-- them. A later migration can drop them once we're confident the new shape
-- is the source of truth.

ALTER TABLE user_breaks
  ADD COLUMN teams TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN extra_player_product_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN formats JSONB NOT NULL DEFAULT '{"hobby":0,"bd":0,"jumbo":0}'::jsonb;

-- Backfill: teams = single-element array; formats = old break_type→cases
UPDATE user_breaks
SET teams = ARRAY[team],
    formats = jsonb_build_object(
      'hobby', CASE WHEN break_type = 'hobby' THEN num_cases ELSE 0 END,
      'bd',    CASE WHEN break_type = 'bd'    THEN num_cases ELSE 0 END,
      'jumbo', CASE WHEN break_type = 'jumbo' THEN num_cases ELSE 0 END
    );

-- Old columns: keep, but make nullable so the new write path can skip them.
ALTER TABLE user_breaks
  ALTER COLUMN team        DROP NOT NULL,
  ALTER COLUMN break_type  DROP NOT NULL,
  ALTER COLUMN num_cases   DROP NOT NULL;

-- snapshot_top_players already includes a `team` field per element since
-- analysis.ts started returning it, so the multi-team list view can render
-- without a join. No change needed there.
