-- Source attribution for two existing surfaces so every applied insight
-- can be traced back to who submitted it and what they actually said.
--
-- Why: pending_insights already keeps every raw narrative + status, so we
-- can analyze "what themes does Kyle/Brody/etc. flag most often" today
-- via that table alone. But once an insight is APPLIED, the
-- player_risk_flags rows lose all source context, and breakerz_score is
-- a single mutable column with no history. Both gaps prevent
-- longitudinal analysis ("Kyle was bullish on Wemby Mar–May, cooled in
-- June" or "trades flagged in this product over the last 6 months").
--
-- Going forward:
--   - player_risk_flags rows created via Discord get source_pending_id +
--     source_user_id + source_narrative populated.
--   - sentiment_history captures every breakerz_score change with the
--     old/new value, source narrative, and contributor.
-- Existing rows have NULL source fields — that's fine, we just can't
-- attribute them.

-- ─── Risk-flag source tracking ──────────────────────────────────────────

ALTER TABLE player_risk_flags
  ADD COLUMN source_pending_id  UUID REFERENCES pending_insights(id) ON DELETE SET NULL,
  ADD COLUMN source_user_id     TEXT,
  ADD COLUMN source_narrative   TEXT,
  ADD COLUMN confidence         NUMERIC;

-- ─── Sentiment history ─────────────────────────────────────────────────
-- Append-only log of every breakerz_score change. Writing happens in the
-- Discord apply path; manual edits via the admin UI would also write here
-- when we extend that flow.
CREATE TABLE breakerz_sentiment_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- player_product_id is nullable — Discord-applied sentiment fans out to
  -- ALL of a player's product entries simultaneously, so we record one
  -- history row per change keyed to the player itself, not per product.
  player_product_id   UUID REFERENCES player_products(id) ON DELETE CASCADE,
  prev_score          NUMERIC,
  new_score           NUMERIC NOT NULL,
  prev_note           TEXT,
  new_note            TEXT,
  source              TEXT NOT NULL DEFAULT 'discord'
                        CHECK (source IN ('discord', 'admin_ui', 'cron', 'import')),
  source_pending_id   UUID REFERENCES pending_insights(id) ON DELETE SET NULL,
  source_user_id      TEXT,
  source_narrative    TEXT,
  confidence          NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX breakerz_sent_history_player_idx
  ON breakerz_sentiment_history (player_id, created_at DESC);
CREATE INDEX breakerz_sent_history_user_idx
  ON breakerz_sentiment_history (source_user_id, created_at DESC);

ALTER TABLE breakerz_sentiment_history ENABLE ROW LEVEL SECURITY;
