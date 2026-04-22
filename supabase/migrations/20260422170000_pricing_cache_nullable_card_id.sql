-- pricing_cache.cardhedger_card_id was NOT NULL from the initial schema when
-- every pricing_cache row corresponded to a single CH card. With CH-hydrated
-- products (variants carry their own card_ids; player_products may not), the
-- aggregate pricing row legitimately has no single card_id to attribute to.
--
-- The column is also never read meaningfully after being written. Making it
-- nullable unblocks bulk upsert from lib/pricing-refresh.ts for jumbo products.
--
-- Discovered 2026-04-22: admin refresh summary reported "278 priced" while
-- the upsert silently wrote 0 rows because every row failed this NOT NULL.

ALTER TABLE pricing_cache ALTER COLUMN cardhedger_card_id DROP NOT NULL;
