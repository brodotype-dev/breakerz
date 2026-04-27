-- Backfill insert_only=true on player_products whose attached variants don't
-- include any base-style card_number (purely numeric like "1", "251"). Insert
-- subjects use prefixed codes like "SF-13" or "TCA-JM". A player with no
-- numeric variants is therefore an insert subject, not a base slot.
--
-- Conservative — false positives are rare (a real base player who somehow has
-- only insert variants attached) and fixable in PlayersManager. Won't touch
-- the products that already have insert_only counts populated correctly
-- (Topps Midnight Basketball, Donruss Football, Topps Finest Basketball).

UPDATE player_products
SET insert_only = TRUE
WHERE insert_only = FALSE
  AND id IN (
    SELECT pp.id
    FROM player_products pp
    LEFT JOIN player_product_variants v ON v.player_product_id = pp.id
    GROUP BY pp.id
    HAVING bool_and(v.card_number IS NULL OR v.card_number !~ '^[0-9]+$')
       AND bool_or(v.id IS NOT NULL)  -- exclude player_products with zero variants
  );
