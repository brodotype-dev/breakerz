-- Per-CH-card price cache. The previous design held all per-variant prices
-- in memory inside lib/pricing-refresh.ts and only persisted aggregated rows
-- to pricing_cache at the end of the function. When a refresh timed out
-- (which started happening regularly after the 2026-05-06 multi-grade audit
-- bumped per-product wall time over the 240s orchestrator deadline) every
-- byte of CH work was thrown away.
--
-- This table caches per-card prices keyed by CardHedger card id, so:
--   1. partial-progress writes happen DURING the chunk loop, not after it
--   2. re-runs skip cards priced in the last 24h
--   3. multiple variants linking to the same CH card share one cache row
--
-- Internal cache only — no RLS policies; service role access only.

CREATE TABLE ch_price_cache (
  cardhedger_card_id  TEXT PRIMARY KEY,
  raw_price           NUMERIC,
  psa9_price          NUMERIC,
  psa10_price         NUMERIC,
  confidence          NUMERIC,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stale-first lookups query by fetched_at; covering index keeps the freshness
-- subquery cheap even at 100k+ rows.
CREATE INDEX idx_ch_price_cache_fetched_at ON ch_price_cache (fetched_at);

-- Service role only. Never exposed to anon/authenticated clients — pricing
-- always reads from pricing_cache, never directly from this table.
ALTER TABLE ch_price_cache ENABLE ROW LEVEL SECURITY;
