-- pending_insights source_kind: allow 'tracked_source_scrape'.
--
-- /url-source (web-sourced-intel Slice 4) stages proposals with
-- source_kind='tracked_source_scrape', and the refine flow routes on it. But
-- the CHECK constraint was never extended past the original
-- 'insight'/'break_price' set when Slice 4a (#167) shipped. Slice 4a's only
-- test scraped a thin Substack homepage → zero updates, so the insert path
-- never fired and the gap stayed hidden. The first real multi-update
-- /url-source parse (a Topps ripped.topps.com article, 11 updates) hit the
-- constraint at stage time.
--
-- CHECK-only change on an admin-only table — no grant/NOTIFY change.
-- Applied to prod via Supabase MCP.

alter table pending_insights
  drop constraint if exists pending_insights_source_kind_check;

alter table pending_insights
  add constraint pending_insights_source_kind_check
  check (source_kind = any (array['insight'::text, 'break_price'::text, 'tracked_source_scrape'::text]));
