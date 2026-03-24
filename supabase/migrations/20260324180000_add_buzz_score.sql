-- Social currency foundation: reserve buzz_score on player_products
-- When populated, engine weights a player's hobby slot proportionally higher.
-- Formula: hobbyWeight = hobbyEVPerBox × (1 + buzz_score)
-- A buzz_score of 0.2 = 20% boost. NULL/0 = no change from current behavior.

ALTER TABLE player_products
  ADD COLUMN IF NOT EXISTS buzz_score FLOAT DEFAULT NULL;
