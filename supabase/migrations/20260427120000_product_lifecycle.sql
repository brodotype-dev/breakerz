-- Product lifecycle: pre_release | live | dormant
--
-- Lifecycle is orthogonal to is_active (the publish/Draft gate). It drives:
--   - Which crons run against a product (only `live`)
--   - Consumer break page rendering (pre-release hype layout vs. live engine
--     vs. dormant summary)
--   - Admin UX (gates quick-actions, drives the table filter)
--
-- All existing products are backfilled to `live` so behavior is unchanged
-- on deploy. New columns and indexes only — no destructive ops.

CREATE TYPE product_lifecycle AS ENUM ('pre_release', 'live', 'dormant');

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS lifecycle_status product_lifecycle NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS products_lifecycle_idx
  ON products (lifecycle_status);
