-- Delete card-code junk player rows surfaced by the /admin/players directory.
--
-- These are mis-parsed checklist rows where a card-subset code is the player
-- NAME (e.g. "90CAS-DO", "MLMDA2-X", "221") and the real player landed in the
-- team column. They were already quarantined app-wide (every player_product is
-- insert_only — excluded from team math, parser rosters, consumer pages), so
-- this only removes dead weight. Verified before running: 0 references in
-- user_chase_list, product_chase_cards, user_breaks arrays, market_observations
-- player-scope, risk_flags; 0 carry icon/HV.
--
-- Deletion set predicate: name is code-like (no lowercase letter AND no space)
-- AND the player has NO non-insert player_product. The second clause guarantees
-- we never delete a row with any real roster presence (it excludes the one live
-- edge case, "B25-ÉP" on an inactive product).
--
-- All FKs onto players / player_products are ON DELETE CASCADE, so deleting the
-- player rows tears down player_products → variants / pricing_cache /
-- product_chase_cards / sentiment_history / pre_release snapshots, and the
-- player-level risk_flags / prospect_rankings / chase_list automatically.
--
-- Reversible: the deleted players + player_products are archived first. The
-- archive tables are admin-only (no PostgREST grants — gotcha #12).

-- ── Backup ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_junk_players_20260603 AS
SELECT pl.*
FROM players pl
WHERE pl.name !~ '[a-z]' AND pl.name !~ ' '
  AND NOT EXISTS (
    SELECT 1 FROM player_products pp
    WHERE pp.player_id = pl.id AND pp.insert_only = false
  );

CREATE TABLE IF NOT EXISTS archive_junk_player_products_20260603 AS
SELECT pp.*
FROM player_products pp
WHERE pp.player_id IN (SELECT id FROM archive_junk_players_20260603);

REVOKE ALL ON archive_junk_players_20260603 FROM anon, authenticated;
REVOKE ALL ON archive_junk_player_products_20260603 FROM anon, authenticated;

-- ── Delete (cascade handles the rest) ──────────────────────────────────────
DELETE FROM players
WHERE id IN (SELECT id FROM archive_junk_players_20260603);
