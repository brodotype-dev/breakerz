-- Discord-driven insight capture (Phase 2 of the break-analysis-v2 plan).
-- See docs/plans/2026-04-29-break-analysis-v2.md for the full design.
--
-- Three tables:
--   discord_contributors — allowlist of Discord users who may post insights
--   pending_insights     — staged parser output before ✅/❌ confirmation
--   market_observations  — applied asking-price + hype-tag observations

-- ─── Allowlist ───────────────────────────────────────────────────────────
CREATE TABLE discord_contributors (
  discord_user_id  TEXT PRIMARY KEY,
  display_name     TEXT,
  role             TEXT NOT NULL DEFAULT 'contributor'
                     CHECK (role IN ('admin', 'contributor')),
  profile_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discord_contributors ENABLE ROW LEVEL SECURITY;

-- ─── Pending insights ────────────────────────────────────────────────────
-- Each row is one Claude-parsed narrative awaiting human confirmation.
-- Parsed updates is an array of typed proposals; the apply/discard flow
-- iterates that array and writes to the right backing table per proposal.
CREATE TABLE pending_insights (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_message_id  TEXT,                  -- bot's reply that holds the buttons
  discord_channel_id  TEXT NOT NULL,
  source_user_id      TEXT NOT NULL,         -- Discord user who triggered /insight
  source_text         TEXT NOT NULL,         -- raw narrative
  parsed_updates      JSONB NOT NULL,        -- Array<ParsedUpdate>; see lib/insights-parser
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'applied', 'discarded', 'expired')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX pending_insights_status_idx ON pending_insights (status, created_at DESC);
CREATE INDEX pending_insights_message_idx ON pending_insights (discord_message_id);

ALTER TABLE pending_insights ENABLE ROW LEVEL SECURITY;

-- ─── Market observations ─────────────────────────────────────────────────
-- Applied asking-price + hype-tag observations. expires_at gives natural
-- staleness — old observations stop rendering automatically. Risk flags
-- continue to live in player_risk_flags (existing table); we just write
-- there directly when the parser detects a flag.
CREATE TABLE market_observations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type    TEXT NOT NULL
                        CHECK (observation_type IN ('asking_price', 'hype_tag')),
  scope_type          TEXT NOT NULL
                        CHECK (scope_type IN ('product', 'team', 'player', 'variant')),
  scope_id            UUID,                  -- nullable for scope_type='team' (team is a string)
  scope_team          TEXT,                  -- populated when scope_type='team'
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  payload             JSONB NOT NULL,        -- type-specific shape; see lib/insights-parser
  source_pending_id   UUID REFERENCES pending_insights(id) ON DELETE SET NULL,
  source_user_id      TEXT NOT NULL,         -- Discord user who confirmed
  source_narrative    TEXT NOT NULL,         -- raw quote that produced this
  confidence          NUMERIC,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  superseded_at       TIMESTAMPTZ
);

CREATE INDEX market_obs_product_idx
  ON market_observations (product_id, observation_type, observed_at DESC);
CREATE INDEX market_obs_scope_idx
  ON market_observations (scope_type, scope_id);
CREATE INDEX market_obs_expires_idx ON market_observations (expires_at)
  WHERE superseded_at IS NULL;

ALTER TABLE market_observations ENABLE ROW LEVEL SECURITY;

-- Consumers can read non-expired, non-superseded observations
CREATE POLICY market_obs_consumer_read ON market_observations
  FOR SELECT
  TO authenticated
  USING (expires_at > NOW() AND superseded_at IS NULL);
