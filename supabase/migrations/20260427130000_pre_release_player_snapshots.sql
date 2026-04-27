-- Pre-release player snapshots
--
-- During pre-release, we have no live pricing for the new product itself
-- (CH hasn't catalogued it yet). What we *can* do is surface comps from the
-- player's existing cards on CH — "what does Wemby's stuff currently do?"
-- as a proxy for what their cards in this new product might be worth.
--
-- Cached per player_product with a 24h TTL. Populated on-demand by the
-- /api/pre-release/player-snapshots endpoint when the consumer break page
-- loads. Rookies / players with no CH presence are stored with
-- has_history = false and rendered as "first-year card / no historical data."

CREATE TABLE IF NOT EXISTS pre_release_player_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_product_id uuid NOT NULL REFERENCES player_products(id) ON DELETE CASCADE UNIQUE,
  has_history       boolean NOT NULL DEFAULT false,
  raw_avg_90d       numeric(10, 2),      -- 90-day average raw sale price, USD
  psa10_avg_90d     numeric(10, 2),      -- 90-day average PSA 10 sale price, USD
  raw_sales_90d     integer,             -- raw sales count in 90d window
  psa10_sales_90d   integer,             -- PSA 10 sales count in 90d window
  fetched_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pre_release_snapshots_pp_idx
  ON pre_release_player_snapshots (player_product_id);

CREATE INDEX IF NOT EXISTS pre_release_snapshots_fetched_at_idx
  ON pre_release_player_snapshots (fetched_at);

-- Service-role only writes; anon can read for the consumer break page.
ALTER TABLE pre_release_player_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pre-release snapshots"
  ON pre_release_player_snapshots FOR SELECT
  USING (true);
