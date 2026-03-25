-- Phase 2: Icon tier
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_icon BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 3: High volatility flag on player_products
ALTER TABLE player_products ADD COLUMN IF NOT EXISTS is_high_volatility BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 3: Risk flags table
CREATE TABLE IF NOT EXISTS player_risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_product_id UUID NOT NULL REFERENCES player_products(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('injury', 'suspension', 'legal', 'trade', 'retirement', 'off_field')),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_player_risk_flags_player_product_id ON player_risk_flags(player_product_id);
CREATE INDEX IF NOT EXISTS idx_player_risk_flags_active ON player_risk_flags(player_product_id) WHERE cleared_at IS NULL;
