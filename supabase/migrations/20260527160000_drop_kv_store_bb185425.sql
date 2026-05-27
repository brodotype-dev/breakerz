-- Drop unused prototype table `kv_store_bb185425` — 2026-05-27
--
-- Follow-up to migration 20260527140000_data_api_hardening.sql which
-- REVOKE'd Data API access on this table among the 8 admin-only tables.
-- This migration completes the cleanup by dropping it entirely.
--
-- Context:
-- - Random `_bb185425` suffix is the Supabase Studio AI-template default
--   naming pattern; this table was never intentionally created in any
--   numbered migration. It predates the relational schema.
-- - 2 rows of legacy JSON at drop time:
--     key='products' → JSON blob of product list
--     key='teamSlots:2025-topps-finest-baseball' → team-slot snapshot
--   Both superseded by the relational schema (products + player_products
--   + pricing_cache) months ago.
-- - Zero code references across app/, lib/, components/, scripts/
--   (verified via grep on 2026-05-27 prior to drop).
-- - The `kv_store_bb185425` advisor lint (rls_enabled_no_policy) will
--   disappear from get_advisors output after this lands.

DROP TABLE IF EXISTS public.kv_store_bb185425;

NOTIFY pgrst, 'reload schema';
