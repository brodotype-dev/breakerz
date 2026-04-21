-- CardHedger set catalog pre-load (2026-04-21)
-- See docs/catalog-preload-architecture.md for the full rationale.
-- Replaces the per-variant fuzzy-search pipeline with a cached full-set pull.

-- ─────────────────────────────────────────────
-- ch_set_cache — full CH catalog per canonical set, refreshed daily
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ch_set_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ch_set_name  text NOT NULL,
  card_id      text NOT NULL,
  number       text,
  player_name  text,
  variant      text,
  year         text,
  category     text,
  rookie       boolean,
  raw          jsonb,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ch_set_cache_card_id_uniq
  ON ch_set_cache (ch_set_name, card_id);

CREATE INDEX IF NOT EXISTS ch_set_cache_lookup_idx
  ON ch_set_cache (ch_set_name, number);

CREATE INDEX IF NOT EXISTS ch_set_cache_lookup_variant_idx
  ON ch_set_cache (ch_set_name, number, lower(variant));

-- ─────────────────────────────────────────────
-- ch_set_refresh_log — observability on catalog pulls
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ch_set_refresh_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ch_set_name    text NOT NULL,
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  pages_fetched  integer,
  cards_fetched  integer,
  success        boolean,
  error          text
);

CREATE INDEX IF NOT EXISTS ch_set_refresh_log_set_idx
  ON ch_set_refresh_log (ch_set_name, started_at DESC);

-- ─────────────────────────────────────────────
-- player_product_variants.match_tier — which matching tier produced the card_id
-- exact-variant | synonym | number-only | card-code | claude | no-match | null (not yet matched)
-- ─────────────────────────────────────────────
ALTER TABLE player_product_variants
  ADD COLUMN IF NOT EXISTS match_tier text;

-- ─────────────────────────────────────────────
-- RLS — catalog cache is read by admin actions only (service role bypasses RLS).
-- Enable RLS but add no policies; anon/authenticated readers get nothing.
-- ─────────────────────────────────────────────
ALTER TABLE ch_set_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ch_set_refresh_log ENABLE ROW LEVEL SECURITY;
