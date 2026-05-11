-- ch_price_cache: explicit service_role bypass policy.
--
-- The 2026-05-09 ch_price_cache migration enabled RLS without any policies,
-- expecting service_role to bypass at the postgres level. It does — for direct
-- SQL access. But Supabase's PostgREST layer, on this configuration, appears to
-- silently reject writes via the JS client when no policies target the role at
-- all. The upsert returns no error AND no rows written.
--
-- Confirmed via 2026-05-11 cron diagnosis:
--   - Donruss Optic worker reported batchChunksCompleted=49, ch_price_cache=0
--   - Topps Midnight worker reported batchChunksCompleted=23, ch_price_cache=0
--   - pricing_cache writes (same supabaseAdmin client, table with public-read
--     SELECT policy) worked normally throughout
--
-- Adding an explicit ALL policy for service_role makes the bypass intent
-- explicit at the PostgREST layer. anon + authenticated remain blocked since
-- no policy targets them.
CREATE POLICY ch_price_cache_service_role_all
  ON ch_price_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
