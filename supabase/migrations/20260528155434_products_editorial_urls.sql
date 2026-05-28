-- products.editorial_urls — Slice 3 of the web-sourced-intel plan (Bucket A).
--
-- Per-product list of editorial / content URLs (Beckett product news, Topps
-- blog posts, break-preview pages, etc.). Admin pastes any number of URLs;
-- on "Re-scrape editorial" each is Firecrawl-scraped + Claude-extracted into
-- product/team/player-scope market_observations (hype_tag + sentiment).
--
-- One flexible column, not typed slots: source mixes vary wildly by product,
-- so named columns (beckett_url, topps_url, …) would mostly sit empty and
-- still miss edge cases. The extractor infers content type per URL.
--
-- Column add on an already-consumer-readable table (products) — no grant
-- change needed (CLAUDE.md gotcha #12: grant decisions are per-NEW-table).

alter table products
  add column if not exists editorial_urls text[];

comment on column products.editorial_urls is
  'Per-product editorial/content URLs (Beckett, Topps blog, break previews). Scraped on demand into product/player-scope market_observations. See web-sourced-intel Slice 3 / lib/editorial-import.ts.';
