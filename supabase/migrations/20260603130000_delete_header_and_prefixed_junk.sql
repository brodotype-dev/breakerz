-- Second junk-row sweep: section-header rows + number-prefixed duplicates that
-- survived the 2026-06-03 cleanup because they carry a space / lowercase letter
-- (so the looksLikeRealPlayerName UI filter kept them).
--
-- Two shapes, both already insert_only everywhere (quarantined):
--   A) ALL-CAPS multi-word section/description headers imported as players —
--      "BASEBALL STARS AUTOGRAPHS", "HEAVY LUMBER AUTOGRAPH RELICS",
--      "1990 TOPPS BASEBALL ALL STAR AUTOGRAPH CARDS", etc.
--   B) number-prefixed real players that ALSO have a clean entry —
--      "1 Jacob Wilson" (clean "Jacob Wilson" exists) → the prefixed row is a
--      pure duplicate. Only deleted when a clean dupe exists, so no real player
--      is lost.
--
-- Safety guard: only rows where EVERY player_product is insert_only. Verified
-- before running: 31 rows / 21 player_products, 0 references in user_chase_list,
-- product_chase_cards, user_breaks arrays, market_observations player-scope,
-- risk_flags; 0 carry icon/HV. All FKs ON DELETE CASCADE.
--
-- The import-side guards (normalizePlayerName / isNonPlayerName, shipped same
-- day) stop these from recurring. Reversible: archived first.

CREATE TABLE IF NOT EXISTS archive_junk_players_20260603_b AS
SELECT pl.*
FROM players pl
WHERE (
    (pl.name = upper(pl.name) AND pl.name ~ '\s' AND pl.name ~ '[A-Z]')
    OR
    (pl.name ~ '^[0-9]+\s+\S' AND EXISTS (
       SELECT 1 FROM players p2
       WHERE p2.name = regexp_replace(pl.name, '^[0-9]+\s+', '') AND p2.id <> pl.id))
  )
  AND NOT EXISTS (
    SELECT 1 FROM player_products pp
    WHERE pp.player_id = pl.id AND pp.insert_only = false
  );

CREATE TABLE IF NOT EXISTS archive_junk_player_products_20260603_b AS
SELECT pp.*
FROM player_products pp
WHERE pp.player_id IN (SELECT id FROM archive_junk_players_20260603_b);

REVOKE ALL ON archive_junk_players_20260603_b FROM anon, authenticated;
REVOKE ALL ON archive_junk_player_products_20260603_b FROM anon, authenticated;

DELETE FROM players
WHERE id IN (SELECT id FROM archive_junk_players_20260603_b);
