-- Backfill: multi-player checklist rows ("Skubal / Blanco / Valdez" —
-- League Leaders, dual autographs, etc.) were stored as single players rows
-- by the importer, then surfaced as bogus team chips in the consumer
-- analyzer. Per Kyle: every individual player has exactly one team, so a
-- combined-name row isn't a real player; it's a subset card.
--
-- Flag those player_products as insert_only=true so they're excluded from
-- team filters and slot pricing. The combined-name players row is kept so
-- existing variant attachments (CardHedger pricing, chase-card references)
-- survive. The forward fix in app/api/admin/import-checklist/route.ts
-- applies the same flag to future imports.
UPDATE player_products
SET insert_only = true
WHERE insert_only = false
  AND player_id IN (SELECT id FROM players WHERE name LIKE '%/%');
