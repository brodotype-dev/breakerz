-- My Breaks: user-logged break history with analysis snapshots
-- MVP: core logging only (chase/hit card tables deferred to Phase 2)

CREATE TABLE user_breaks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id),
  team                TEXT NOT NULL,
  break_type          TEXT NOT NULL CHECK (break_type IN ('hobby', 'bd')),
  num_cases           INTEGER NOT NULL DEFAULT 1 CHECK (num_cases BETWEEN 1 AND 50),
  ask_price           NUMERIC NOT NULL CHECK (ask_price > 0),
  platform            TEXT NOT NULL CHECK (platform IN (
    'fanatics_live', 'whatnot', 'ebay',
    'dave_adams', 'layton_sports', 'local_card_shop', 'other'
  )),
  platform_other      TEXT,

  -- Analysis snapshot (frozen at time of logging)
  snapshot_signal     TEXT CHECK (snapshot_signal IN ('BUY', 'WATCH', 'PASS')),
  snapshot_value_pct  NUMERIC,
  snapshot_fair_value NUMERIC,
  snapshot_analysis   TEXT,
  snapshot_top_players JSONB,
  snapshot_risk_flags  JSONB,
  snapshot_hv_players  TEXT[],

  -- Post-break results
  outcome             TEXT CHECK (outcome IN ('win', 'mediocre', 'bust')),
  outcome_notes       TEXT,

  -- Status + timestamps
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'completed', 'abandoned')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consumer queries: "my breaks"
CREATE INDEX idx_user_breaks_user_id ON user_breaks (user_id);
CREATE INDEX idx_user_breaks_user_status ON user_breaks (user_id, status);
CREATE INDEX idx_user_breaks_user_pending ON user_breaks (user_id, created_at DESC)
  WHERE status = 'pending';

-- Admin analytics
CREATE INDEX idx_user_breaks_product_id ON user_breaks (product_id);
CREATE INDEX idx_user_breaks_platform ON user_breaks (platform);
CREATE INDEX idx_user_breaks_created_at ON user_breaks (created_at DESC);

-- RLS: users can only access their own breaks
ALTER TABLE user_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_breaks: self read"
  ON user_breaks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_breaks: self insert"
  ON user_breaks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_breaks: self update"
  ON user_breaks FOR UPDATE
  USING (auth.uid() = user_id);
