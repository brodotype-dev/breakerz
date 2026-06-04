-- Fix /admin/data-health statement-timeout (57014). The per-product coverage
-- rollup was N round-trips each: a distinct-card-ids scan + a chunked
-- ch_price_cache loop (~cards/200 calls) + a pricing_cache fetch, all fanned
-- out in parallel across active products. Re-matching ~doubled Chrome Football's
-- matched cards and pushed it past the statement timeout. This collapses the
-- whole rollup into ONE SQL aggregate per product.
--
-- ch_price_cache.cardhedger_card_id is the PK, so the join is index-backed.

CREATE OR REPLACE FUNCTION get_ch_coverage(p_product_id uuid, p_cutoff timestamptz)
RETURNS TABLE (
  distinct_card_ids bigint,
  cached_total      bigint,
  cards_with_prices bigint,
  cards_all_null    bigint,
  cached_fresh      bigint,
  cached_stale      bigint,
  pp_total          bigint,
  pp_priced         bigint,
  pc_fresh          bigint,
  pc_stale          bigint,
  conf_sum          numeric,
  conf_count        bigint,
  last_priced       timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH card_ids AS (
    SELECT DISTINCT v.cardhedger_card_id AS cid
    FROM player_product_variants v
    JOIN player_products pp ON pp.id = v.player_product_id
    WHERE pp.product_id = p_product_id AND v.cardhedger_card_id IS NOT NULL
  ),
  cache AS (
    SELECT c.raw_price, c.psa9_price, c.psa10_price, c.fetched_at
    FROM ch_price_cache c
    JOIN card_ids ci ON ci.cid = c.cardhedger_card_id
  ),
  pc AS (
    SELECT pcache.confidence, pcache.fetched_at
    FROM pricing_cache pcache
    JOIN player_products pp ON pp.id = pcache.player_product_id
    WHERE pp.product_id = p_product_id
  )
  SELECT
    (SELECT count(*) FROM card_ids),
    (SELECT count(*) FROM cache),
    (SELECT count(*) FROM cache WHERE raw_price IS NOT NULL OR psa9_price IS NOT NULL OR psa10_price IS NOT NULL),
    (SELECT count(*) FROM cache WHERE raw_price IS NULL AND psa9_price IS NULL AND psa10_price IS NULL),
    (SELECT count(*) FROM cache WHERE fetched_at >= p_cutoff),
    (SELECT count(*) FROM cache WHERE fetched_at <  p_cutoff),
    (SELECT count(*) FROM player_products WHERE product_id = p_product_id AND insert_only = false),
    (SELECT count(*) FROM pc),
    (SELECT count(*) FROM pc WHERE fetched_at >= p_cutoff),
    (SELECT count(*) FROM pc WHERE fetched_at <  p_cutoff),
    (SELECT coalesce(sum(confidence), 0) FROM pc),
    (SELECT count(confidence) FROM pc),
    (SELECT max(fetched_at) FROM pc);
$$;

-- Admin-only — called via the service-role client (gotcha #12). Never expose
-- via PostgREST to anon/authenticated.
REVOKE EXECUTE ON FUNCTION get_ch_coverage(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
