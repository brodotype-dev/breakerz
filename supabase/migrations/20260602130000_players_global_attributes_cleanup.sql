-- Players-as-global re-model — Phase 2 (CLEANUP — DO NOT APPLY UNTIL DEPLOYED).
--
-- ⚠️  Apply this ONLY after the feat/players-global code is live in prod.
--     It deletes the 49 redundant Discord fan-out rows and drops the legacy
--     columns. Running it while the OLD code (which reads risk flags by
--     player_product_id and HV off player_products) is still serving traffic
--     would strip flags from a player's other products. Phase 1
--     (20260602120000) is the additive, deploy-safe half; this is the
--     decoupled cleanup.
--
-- Pre-flight check (run first, expect ~49 redundant rows, ~14 survivors):
--   SELECT count(*) AS total,
--          count(*) - count(DISTINCT (player_id, flag_type, note)) AS redundant
--   FROM player_risk_flags WHERE cleared_at IS NULL;

-- ── Dedup the legacy Discord fan-out ───────────────────────────────────────
-- Keep one row per (player_id, flag_type, note): prefer an ACTIVE row
-- (cleared_at IS NULL) over a cleared one, then the earliest created_at, then
-- the row that carries source attribution. Delete the rest.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY player_id, flag_type, note
           ORDER BY (cleared_at IS NULL) DESC,        -- active first
                    created_at ASC,                    -- oldest first
                    (source_pending_id IS NOT NULL) DESC,
                    id
         ) AS rn
  FROM player_risk_flags
  WHERE player_id IS NOT NULL
)
DELETE FROM player_risk_flags
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── Make player_id the hard requirement; drop the legacy product link ───────
ALTER TABLE player_risk_flags
  ALTER COLUMN player_id SET NOT NULL;

DROP INDEX IF EXISTS idx_player_risk_flags_player_product_id;
ALTER TABLE player_risk_flags
  DROP COLUMN IF EXISTS player_product_id;

-- ── Drop the now-unused product-scoped HV column ───────────────────────────
ALTER TABLE player_products
  DROP COLUMN IF EXISTS is_high_volatility;
