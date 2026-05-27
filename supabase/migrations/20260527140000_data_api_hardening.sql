-- Data API hardening — 2026-05-27
--
-- Triggered by Supabase's 2026-05-26 email announcing that on Oct 30,
-- 2026 new tables in `public` will no longer be auto-exposed to the
-- Data API. The Security Advisor surfaced several pre-existing issues
-- in the same audit that are worth fixing now, separate from the email.
--
-- All three changes are independently safe — every code path that
-- touches the affected tables goes through `supabaseAdmin` (service
-- role) which bypasses GRANTs. Consumer and admin behavior unchanged.
--
-- ─── 1. Public RPC bug — `upsert_ch_price_cache_preserving_nulls` ──────
--
-- This SECURITY DEFINER function was introduced 2026-05-20 in migration
-- `20260520220000_ch_price_cache_preserve_nulls_upsert.sql` for the
-- cache write-bug fix. The original migration didn't include a REVOKE,
-- so PostgreSQL's default `EXECUTE TO PUBLIC` left it callable by anon
-- + authenticated via `POST /rest/v1/rpc/upsert_ch_price_cache_preserving_nulls`.
-- That means anyone with the anon API key could write pricing rows by
-- hand. The function is meant to be called only by lib/pricing-refresh.ts
-- (which uses service role and bypasses GRANT anyway).
--
-- Fix: revoke EXECUTE from anon/authenticated/PUBLIC, pin search_path
-- so a malicious session can't redefine `ch_price_cache` to point at
-- a different table.

REVOKE EXECUTE ON FUNCTION public.upsert_ch_price_cache_preserving_nulls(jsonb)
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.upsert_ch_price_cache_preserving_nulls(jsonb)
  SET search_path = public, pg_temp;

-- ─── 2. Revoke Data API exposure on admin-only tables ─────────────────
--
-- The seven tables below all have RLS enabled with no policies, which
-- means clients can't read/write any rows. But they're still listed in
-- the Data API surface (/rest/v1/<table>) and respond to OPTIONS calls.
-- Revoking ALL closes the unnecessary attack surface ahead of the
-- Oct 30 default change.
--
-- Verified each is accessed exclusively via supabaseAdmin in app code:
--   - breakerz_sentiment_history: app/api/player-profile/route.ts,
--     app/api/discord/interactions/route.ts
--   - ch_set_cache, ch_set_refresh_log: lib/cardhedger-catalog.ts,
--     admin product pages
--   - cron_run_log: cron orchestrators, admin Cron Status panel
--   - discord_contributors: app/api/discord/interactions/route.ts
--   - feature_flags: app/admin/market-delta/*, lib/analysis.ts (admin
--     toggle read for verdict-observation-context)
--   - pending_insights: app/(consumer)/page.tsx (count-only via
--     supabaseAdmin for footer stat), Discord interactions, parser

REVOKE ALL ON TABLE public.breakerz_sentiment_history FROM anon, authenticated;
REVOKE ALL ON TABLE public.ch_set_cache               FROM anon, authenticated;
REVOKE ALL ON TABLE public.ch_set_refresh_log         FROM anon, authenticated;
REVOKE ALL ON TABLE public.cron_run_log               FROM anon, authenticated;
REVOKE ALL ON TABLE public.discord_contributors       FROM anon, authenticated;
REVOKE ALL ON TABLE public.feature_flags              FROM anon, authenticated;
REVOKE ALL ON TABLE public.kv_store_bb185425          FROM anon, authenticated;
REVOKE ALL ON TABLE public.pending_insights           FROM anon, authenticated;

-- NOTE on kv_store_bb185425: zero code references across app/, lib/,
-- components/, scripts/. Contains 2 rows of legacy JSON (`products` +
-- `teamSlots:...`) from the pre-relational-schema prototype era; the
-- random `_bb185425` suffix is the Supabase Studio AI-template default
-- naming pattern. Including it in the REVOKE pass for completeness,
-- but full DROP is deferred pending an explicit teardown decision.

-- ─── 3. Reload PostgREST schema cache ─────────────────────────────────
--
-- See CLAUDE.md gotcha #10. Without this, the REVOKE + DROP take effect
-- in Postgres but PostgREST's in-memory schema doesn't know until the
-- next reload (could be minutes).

NOTIFY pgrst, 'reload schema';
