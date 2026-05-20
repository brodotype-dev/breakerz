-- ch_set_cache: add card_description for unique card identification
--
-- River (CardHedger co-founder, 2026-05-20 email) flagged that some CH cards
-- share the same (set, number, variant) tuple but are genuinely distinct —
-- e.g. Munetaka Murakami 2026 Bowman Baseball #9 "Base" appears as both the
-- regular RC and as the Red Rookie Redemption RC, identical except for
-- card_description ("Munetaka Murakami 2026 Bowman Baseball" vs "Munetaka
-- Murakami 2026 Bowman Red Rookie Redemption Baseball").
--
-- Our catalog cache was silently dropping the description field from CH's
-- card-search response, and the in-memory match index (`byNumberVariant`)
-- was keyed only on number+variant — so the second of any colliding pair
-- got silently overwritten and never bound to a variant during import.
--
-- This migration adds the column nullable. Backfill happens on the next
-- per-product CH catalog refresh (cron at 3 AM UTC, or admin "Refresh CH
-- Catalog" button). Match index is being updated in the same commit to
-- preserve all collision candidates and let the Claude tier disambiguate
-- using description when there's more than one hit on (number, variant).

ALTER TABLE ch_set_cache ADD COLUMN IF NOT EXISTS card_description text;

COMMENT ON COLUMN ch_set_cache.card_description IS
  'Full CH card description (e.g. "Munetaka Murakami 2026 Bowman Red Rookie Redemption Baseball"). Used as the tie-breaker when (set, number, variant) collide across inserts that CH does not encode in the variant field. Populated on catalog refresh (3 AM UTC cron, or admin Refresh CH Catalog button) — nullable until backfill completes.';
