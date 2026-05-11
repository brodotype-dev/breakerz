-- products.anchor_strategy + anchor_variant_patterns + anchor_config_notes —
-- per-product configuration for how pricing-refresh aggregates per-variant CH
-- prices into a single player EV.
--
-- Today's pricing pipeline sets-weighted-averages every priced variant for a
-- player_product. That's correct in theory (rare/expensive × low odds == cheap
-- × high odds in expected value) but breaks down on products where the long
-- tail has thin CH comps (Bowman sapphire 1/1s, SuperFractors). The conversational
-- anchor configurator lets Kyle define which variants anchor the slot price per
-- product, with Claude proposing patterns from manufacturer-specific anchor concepts.
--
-- All three columns default to "current behavior" (sets_weighted_all + empty
-- patterns). No existing data is impacted until an admin configures a product.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS anchor_strategy text NOT NULL DEFAULT 'sets_weighted_all';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS anchor_variant_patterns text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS anchor_config_notes text;

ALTER TABLE products
  ADD CONSTRAINT products_anchor_strategy_check
    CHECK (anchor_strategy IN ('sets_weighted_all', 'curated_variants', 'curated_with_tail'));

COMMENT ON COLUMN products.anchor_strategy IS
  'Aggregation strategy for per-player EV in pricing-refresh. sets_weighted_all (default) uses every priced variant; curated_variants filters by anchor_variant_patterns; curated_with_tail adds a fixed tail bonus on top of the curated subset.';

COMMENT ON COLUMN products.anchor_variant_patterns IS
  'Case-insensitive regex strings tested against player_product_variants.variant_name. Only used when anchor_strategy is curated_*. Empty array yields a fallback to sets_weighted_all with a warning logged in the refresh telemetry.';

COMMENT ON COLUMN products.anchor_config_notes IS
  'Conversation history / rationale from the anchor configurator. Surfaced back into the configurator UI as system context on every reopen so the chain of reasoning is preserved across edits.';
