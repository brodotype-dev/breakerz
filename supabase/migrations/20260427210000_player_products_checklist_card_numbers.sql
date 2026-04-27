-- Persist the checklist's card numbers per player so the hydrate flow can
-- scope CH variant attachment by what the checklist actually says is in this
-- product. Without this, the hydrate flow's delete-then-insert pattern loses
-- the original checklist signal, and products that share a `ch_set_name`
-- (e.g. Topps Series 1 + Series 2 both pointing at "2025 Topps Baseball")
-- end up with all 56k catalog variants attached, regardless of which series
-- the cards actually belong to.
--
-- Behavior in code (lib/variants-from-catalog.ts Phase 4):
--   - If checklist_card_numbers is null or empty array → permissive match
--     (legacy behavior; attach by player name only). Lets pre-existing
--     products keep working without re-import.
--   - If populated → only attach CH variants whose card_number is in the
--     array. Card numbers natively encode the S1/S2 split (1–330 vs 331–660)
--     and parallels share numbers with their bases, so this single rule
--     handles both series-sharing and insert-section scoping.

ALTER TABLE player_products
  ADD COLUMN IF NOT EXISTS checklist_card_numbers TEXT[];

COMMENT ON COLUMN player_products.checklist_card_numbers IS
  'Card numbers from the imported checklist for this player in this product. '
  'Used by hydrate to scope which CH catalog variants attach. '
  'NULL means legacy data — hydrate falls back to permissive (name-only) matching.';
