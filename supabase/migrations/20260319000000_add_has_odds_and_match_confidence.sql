-- Add has_odds flag to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_odds boolean NOT NULL DEFAULT false;

-- Create player_product_variants (core table for the import pipeline)
CREATE TABLE IF NOT EXISTS player_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_product_id uuid NOT NULL REFERENCES player_products(id) ON DELETE CASCADE,
  variant_name text NOT NULL,
  cardhedger_card_id text,
  hobby_sets integer NOT NULL DEFAULT 1,
  bd_only_sets integer NOT NULL DEFAULT 0,
  card_number text,
  is_sp boolean NOT NULL DEFAULT false,
  print_run integer,
  hobby_odds text,
  breaker_odds text,
  match_confidence float,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_product_variants_pp_id_idx
  ON player_product_variants(player_product_id);

CREATE INDEX IF NOT EXISTS player_product_variants_unmatched_idx
  ON player_product_variants(player_product_id)
  WHERE cardhedger_card_id IS NULL;
