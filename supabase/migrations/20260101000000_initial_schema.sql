-- Initial schema — base tables and sports seed
-- Applied manually to production before migrations were tracked.
-- On production: supabase migration repair --status applied 20260101000000 --linked

-- ─────────────────────────────────────────────
-- SPORTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sports (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE
);

INSERT INTO sports (name, slug) VALUES
  ('Basketball', 'basketball'),
  ('Baseball',   'baseball'),
  ('Football',   'football')
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id              uuid REFERENCES sports(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  slug                  text NOT NULL UNIQUE,
  manufacturer          text,
  year                  text,
  hobby_case_cost       numeric,
  bd_case_cost          numeric,
  hobby_autos_per_case  integer DEFAULT 16,
  bd_autos_per_case     integer DEFAULT 30,
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- PLAYERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  sport_id   uuid REFERENCES sports(id) ON DELETE CASCADE,
  team       text,
  is_rookie  boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- PLAYER × PRODUCT
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           uuid REFERENCES players(id) ON DELETE CASCADE,
  product_id          uuid REFERENCES products(id) ON DELETE CASCADE,
  hobby_sets          integer DEFAULT 0,
  bd_only_sets        integer DEFAULT 0,
  total_sets          integer GENERATED ALWAYS AS (hobby_sets + bd_only_sets) STORED,
  insert_only         boolean DEFAULT false,
  cardhedger_card_id  text,
  created_at          timestamptz DEFAULT now(),
  UNIQUE(player_id, product_id)
);

-- ─────────────────────────────────────────────
-- PRICING CACHE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_product_id   uuid REFERENCES player_products(id) ON DELETE CASCADE UNIQUE,
  cardhedger_card_id  text NOT NULL,
  ev_low              numeric,
  ev_mid              numeric,
  ev_high             numeric,
  raw_comps           jsonb DEFAULT '{}',
  fetched_at          timestamptz DEFAULT now(),
  expires_at          timestamptz
);

CREATE INDEX IF NOT EXISTS pricing_cache_player_product_id_idx ON pricing_cache (player_product_id);
CREATE INDEX IF NOT EXISTS pricing_cache_expires_at_idx ON pricing_cache (expires_at);
