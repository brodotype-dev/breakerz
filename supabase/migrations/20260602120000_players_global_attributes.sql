-- Players-as-global re-model — Phase 1 (additive only, safe to apply ahead of code).
--
-- Two player attributes were product-scoped but describe the PLAYER, not the
-- card-in-a-product: high-volatility and risk flags. An injury / suspension /
-- "this market whips around" follows the player across every product. The
-- Discord /insight apply path already fanned risk flags out to every one of a
-- player's player_products (63 rows collapsing to 14 logical flags), which is
-- the redundancy this re-model removes.
--
-- This migration is intentionally ADDITIVE and invisible to current code:
--   - players.is_high_volatility is a new column current code never reads.
--   - player_risk_flags.player_id is backfilled but current code still joins by
--     player_product_id, so nothing changes until the new read code ships.
-- The physical dedup of the 49 redundant fan-out rows and the eventual column
-- drops live in a SEPARATE later migration so they land WITH the code deploy —
-- deleting copies now would strip flags from a player's other products under
-- the current fan-out read path. New read code dedups defensively instead.
--
-- Grants: no new tables. player_risk_flags stays admin-only (accessed via the
-- service-role client); players already carries its grants. No functions added,
-- so no `NOTIFY pgrst` needed (gotcha #10/#12 n/a).

-- ── HV → players ──────────────────────────────────────────────────────────
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_high_volatility boolean NOT NULL DEFAULT false;

-- Backfill: a player is HV if ANY of their player_products was flagged HV.
UPDATE players p
SET is_high_volatility = true
WHERE EXISTS (
  SELECT 1 FROM player_products pp
  WHERE pp.player_id = p.id AND pp.is_high_volatility = true
);

-- ── Risk flags → keyed by player ──────────────────────────────────────────
ALTER TABLE player_risk_flags
  ADD COLUMN IF NOT EXISTS player_id uuid REFERENCES players(id) ON DELETE CASCADE;

-- Backfill player_id from the existing player_product link.
UPDATE player_risk_flags rf
SET player_id = pp.player_id
FROM player_products pp
WHERE pp.id = rf.player_product_id
  AND rf.player_id IS NULL;

-- New Discord inserts will set player_id and omit player_product_id, so the
-- legacy column must be nullable. (Existing rows keep their value for now.)
ALTER TABLE player_risk_flags
  ALTER COLUMN player_product_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_player_risk_flags_player_id
  ON player_risk_flags(player_id);
CREATE INDEX IF NOT EXISTS idx_player_risk_flags_player_active
  ON player_risk_flags(player_id) WHERE cleared_at IS NULL;
