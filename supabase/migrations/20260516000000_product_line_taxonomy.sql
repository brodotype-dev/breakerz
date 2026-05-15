-- Product line taxonomy ("taxonomy lite") — single enum-like text column on
-- products distinguishing brand-line (Bowman flagship vs Bowman Chrome vs
-- Bowman Best vs Topps Chrome Cosmic vs Panini Prizm vs …). Adds the
-- structural signal needed by the parser to disambiguate "JUMBO" titled
-- breaks on hobby-only specialty products like Bowman's Best.
--
-- Why TEXT not a CHECK constraint or PG enum: keeps the canonical list in
-- code (lib/product-lines.ts) where the form dropdown, parser prompt, and
-- type system already share it. New lines = TypeScript change, not a
-- migration. Trade-off accepted: admin form is the only writer, so the
-- text validation lives at the boundary.
--
-- Backfill at the end runs against the 16 active products live as of
-- 2026-05-15. New products created after this migration will set
-- product_line via the form's new dropdown.

ALTER TABLE products
  ADD COLUMN product_line TEXT;

-- Backfill — by product slug, since slugs are deterministic and stable.
UPDATE products SET product_line = CASE slug
  WHEN '2025-26-topps-cosmic-chrome-basketball'       THEN 'topps_cosmic_chrome'
  WHEN '2026-bowman-baseball'                         THEN 'bowman_flagship'
  WHEN '2025-26-bowman-basketball'                    THEN 'bowman_flagship'
  WHEN '2025-bowman-chrome-baseball'                  THEN 'bowman_chrome'
  WHEN '2025-bowmans-best-baseball'                   THEN 'bowman_best'
  WHEN '2025-panini-donruss-football'                 THEN 'panini_donruss'
  WHEN '2025-panini-prizm-football'                   THEN 'panini_prizm'
  WHEN '2025-topps-pristine-baseball'                 THEN 'topps_pristine'
  WHEN '2025-26-topps-3-basketball'                   THEN 'topps_three'
  WHEN '2025-26-topps-chrome-basketball'              THEN 'topps_chrome'
  WHEN '2025-26-topps-chrome-basketball-midnight'     THEN 'topps_chrome'
  WHEN '2025-26-topps-chrome-sapphire-basketball'     THEN 'topps_chrome'
  WHEN '2025-26-topps-finest-basketball'              THEN 'topps_finest'
  WHEN 'topps-series-1-baseball-2025'                 THEN 'topps_flagship'
  WHEN 'topps-series-2-baseball-2025'                 THEN 'topps_flagship'
  WHEN '2024-panini-donruss-optic'                    THEN 'panini_donruss_optic'
  ELSE product_line
END
WHERE product_line IS NULL;

COMMENT ON COLUMN products.product_line IS
  'Brand-line taxonomy (e.g. bowman_flagship, bowman_chrome, bowman_best, topps_chrome, panini_prizm). Canonical values live in lib/product-lines.ts. Drives parser context, format expectations, and future cross-product anchoring.';
