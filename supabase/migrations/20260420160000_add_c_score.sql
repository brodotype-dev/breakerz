-- Phase 5: C-score — CardHedger market signal per player_product
-- Updated nightly by the update-scores cron job.
-- c_score = gain - 1 (fractional price change from CH top-movers, e.g. 0.99 = +99%)
-- NULL = no signal data yet. 0 = not a top mover this cycle.
-- Engine blend into buzz_score is deferred until S-score and P-score are available.

ALTER TABLE player_products
  ADD COLUMN IF NOT EXISTS c_score FLOAT DEFAULT NULL;

COMMENT ON COLUMN player_products.c_score IS
  'CardHedger market signal. Fractional price gain from top-movers (gain - 1). Updated nightly. NULL = no data, 0 = not trending.';
