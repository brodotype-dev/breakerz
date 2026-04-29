ALTER TABLE products
  ADD COLUMN jumbo_case_cost NUMERIC,
  ADD COLUMN jumbo_am_case_cost NUMERIC,
  ADD COLUMN jumbo_autos_per_case INTEGER;

ALTER TABLE player_product_variants
  ADD COLUMN jumbo_sets INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN jumbo_odds NUMERIC;
