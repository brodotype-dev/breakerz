-- ch_price_cache: COALESCE-on-upsert so failed chunks can't nuke good prices
--
-- Pre-2026-05-20, lib/pricing-refresh.ts ran a blind UPSERT per chunk after
-- three parallel batch-price-estimate calls (Raw / PSA 9 / PSA 10). When ANY
-- of those calls failed at the chunk level (timeout, rate limit, CH outage),
-- its `*Map` was empty for the whole chunk, every card's `valid*` field went
-- to null, and the upsert wrote `*_price: null` for that grade — overwriting
-- a perfectly correct cached value from a prior successful firing.
--
-- The 2026-05-20 audit found 60,150 cache rows (97% of ch_price_cache!) had
-- all three price columns null. Spot-probing those card_ids against CH showed
-- ~20% had genuinely-priced data in batch-price-estimate at probe time. The
-- 80% empty really are CH-empty (low-trade parallels, /5 print runs etc.),
-- but the 20% were a real bug — chunks timed out under the 240s deadline and
-- nulled good rows on the way out.
--
-- This RPC replaces the blind upsert with a per-grade COALESCE merge:
--   - If a row exists and the new value is non-null → overwrite (fresh data)
--   - If a row exists and the new value IS null → preserve existing value
--     (failed call shouldn't blow away the last-good price)
--   - If no row exists → insert as-is (no harm in null since nothing to preserve)
--   - fetched_at always bumps so the TTL still skips this card on the next
--     cron firing (preserves the "no re-fetch storm on transient outage"
--     property the previous blind-upsert design was reaching for)
--
-- Single SQL statement, atomic — no TOCTOU race when concurrent chunks
-- happen to overlap on the same card_id (rare but real under staggered
-- cron firings × 4 in-flight chunks per worker).

CREATE OR REPLACE FUNCTION upsert_ch_price_cache_preserving_nulls(
  rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ch_price_cache (
    cardhedger_card_id,
    raw_price,
    psa9_price,
    psa10_price,
    confidence,
    fetched_at
  )
  SELECT
    (r->>'cardhedger_card_id')::text,
    NULLIF(r->>'raw_price',   '')::numeric,
    NULLIF(r->>'psa9_price',  '')::numeric,
    NULLIF(r->>'psa10_price', '')::numeric,
    NULLIF(r->>'confidence',  '')::numeric,
    (r->>'fetched_at')::timestamptz
  FROM jsonb_array_elements(rows) AS r
  ON CONFLICT (cardhedger_card_id) DO UPDATE SET
    raw_price   = COALESCE(EXCLUDED.raw_price,   ch_price_cache.raw_price),
    psa9_price  = COALESCE(EXCLUDED.psa9_price,  ch_price_cache.psa9_price),
    psa10_price = COALESCE(EXCLUDED.psa10_price, ch_price_cache.psa10_price),
    confidence  = COALESCE(EXCLUDED.confidence,  ch_price_cache.confidence),
    fetched_at  = EXCLUDED.fetched_at;
END;
$$;

COMMENT ON FUNCTION upsert_ch_price_cache_preserving_nulls(jsonb) IS
  'Per-grade COALESCE upsert into ch_price_cache. Failed chunks (null price columns) preserve existing cached values rather than overwriting with null. fetched_at always bumps. Called by lib/pricing-refresh.ts after each chunk.';
