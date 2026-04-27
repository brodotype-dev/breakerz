-- Backfill: mark hydrate-auto-created player_products as insert_only=true.
--
-- Context: prior to 2026-04-27, lib/variants-from-catalog.ts Phase 3 auto-
-- created player_products (one per CH-catalog player not in our checklist) with
-- insert_only=false. Those rows are insert subjects by definition (legends on
-- throwback inserts, multi-player insert subjects, retired players appearing
-- only in inserts) — they're not base slots. The bug inflated "auto-eligible"
-- counts (Topps Chrome Basketball read 1,569 instead of ~150–300).
--
-- Discriminator: a checklist-imported player_product has hobby_sets and/or
-- bd_only_sets set by the parser (>0 for base, sometimes 0 for checklist
-- inserts but those are also marked insert_only=true at parse time). An
-- auto-created row has hobby_sets=0 AND bd_only_sets=0 AND insert_only=false
-- (the buggy default).
--
-- This backfill flips only rows matching that exact pattern. False positives
-- would be checklist base players that genuinely had 0/0 in the source PDF —
-- vanishingly rare, and admins can flip them back via PlayersManager UI.
UPDATE player_products
SET insert_only = TRUE
WHERE COALESCE(hobby_sets, 0) = 0
  AND COALESCE(bd_only_sets, 0) = 0
  AND insert_only = FALSE;
