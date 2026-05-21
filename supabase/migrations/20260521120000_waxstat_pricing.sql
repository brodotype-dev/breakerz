-- WaxStat box-pricing scraper schema.
--
-- Two pieces:
--   1. Three URL columns on products. Admin pastes a WaxStat URL per format
--      (hobby / BD / jumbo). The cron + manual-refresh route reads these
--      and pulls fresh pricing.
--   2. waxstat_pricing_snapshots — per-fetch time series. Every refresh
--      writes a row, including error rows when the scrape failed (so we
--      can see "stale" vs. "broken" in the admin panel).
--
-- Schema was originally applied directly to the production DB via Supabase
-- MCP during a prior session; this file is for traceability + idempotent
-- repeat-applies. Uses IF NOT EXISTS / DO blocks throughout.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS waxstat_hobby_url text,
  ADD COLUMN IF NOT EXISTS waxstat_bd_url text,
  ADD COLUMN IF NOT EXISTS waxstat_jumbo_url text;

CREATE TABLE IF NOT EXISTS waxstat_pricing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('hobby', 'bd', 'jumbo')),
  source_url text NOT NULL,
  avg_price numeric,
  low_30d numeric,
  high_30d numeric,
  trend_7d numeric,
  error_message text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waxstat_pricing_snapshots_product_format_fetched_idx
  ON waxstat_pricing_snapshots (product_id, format, fetched_at DESC);

-- Admin + service-role only. Consumers don't read this table.
ALTER TABLE waxstat_pricing_snapshots ENABLE ROW LEVEL SECURITY;

-- No policies → all access goes through service role, which bypasses RLS.
-- (Same pattern as ch_set_refresh_log + cron_run_log.)
