-- Breakerz Bets editorial layer on player_products
-- breakerz_score: team's directional read (-0.5 to +0.5)
-- breakerz_note: one-sentence reason, required when score is set
ALTER TABLE player_products ADD COLUMN IF NOT EXISTS breakerz_score FLOAT DEFAULT NULL;
ALTER TABLE player_products ADD COLUMN IF NOT EXISTS breakerz_note TEXT DEFAULT NULL;
