-- Break feed: what the market is actually breaking.
--
-- Two row shapes, because the market has two shapes (verified 2026-11-22):
--
--   1. Shop storefronts (Steel City Collectibles) pre-list each break as a
--      product, so we get product + spot price + spots left + date + breaker.
--   2. Live platforms (Fanatics Live, Whatnot) do NOT publish a break list
--      before a show starts — a named, product-specific show two days out
--      still reads "This shop is empty (for now)", and pre-claims happen by
--      text message. All we can see is show title + time + breaker.
--
-- Both answer "what is breaking". Only the first answers "at what price", so
-- price/spots are nullable and the admin surface labels the shape.
--
-- The point of this table is not the breaks — it is the UNMATCHED breaks.
-- A row whose matched_product_id is null means the market is selling
-- something we cannot price. That is the catalog-coverage signal.

-- ---------------------------------------------------------------------------
-- Sources we watch
-- ---------------------------------------------------------------------------
create table if not exists break_feed_sources (
  id              uuid primary key default gen_random_uuid(),
  -- 'steel_city'    → Alexandria provider, paginated, carries spot prices
  -- 'fanatics_live' → Firecrawl scrape of one shop page, titles + times only
  kind            text not null check (kind in ('steel_city', 'fanatics_live')),
  -- For fanatics_live this is the shop slug ("east-west-sports-cards").
  -- For steel_city there is one catalog, so identifier is just 'break-room'.
  identifier      text not null,
  label           text,
  is_active       boolean not null default true,
  last_scraped_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (kind, identifier)
);

-- ---------------------------------------------------------------------------
-- Breaks / shows observed
-- ---------------------------------------------------------------------------
create table if not exists upcoming_breaks (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references break_feed_sources(id) on delete cascade,
  kind               text not null check (kind in ('steel_city', 'fanatics_live')),
  -- The source's own stable id (Steel City product id, Fanatics show uuid).
  source_ref         text not null,

  title              text not null,
  url                text,
  -- The provider's sport tag. Steel City supplies this and it is how we
  -- filter non-sports (Pokemon, Marvel, Star Wars) out cheaply: those rows
  -- come back with sport null. Fanatics Live supplies nothing, so these stay
  -- null and are classified from the title instead.
  sport              text,
  -- Raw human label ("Mon, Nov. 23rd", "Wed 7:00 AM") — the sources state no
  -- year, so we keep what they said rather than invent a timestamp.
  break_date_label   text,
  -- Spot/entry price in USD. Null for live-platform shows: there is no price
  -- to read before the breaker drops inventory.
  price              numeric(10, 2),
  spots_available    integer,
  breaker            text,
  -- 'group_break', or a parsed hint like 'pyt' / 'random' / 'mixer'.
  configuration      text,

  matched_product_id uuid references products(id) on delete set null,
  -- 'exact' | 'alias' | 'none'
  match_confidence   text,
  -- Why it did not match, e.g. "tokens match but season differs (title 2026)".
  -- This is the column that tells us what to onboard next.
  match_reason       text,

  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  -- Set when a refresh no longer sees the row, so the feed can show "gone"
  -- without losing the history of what was offered.
  disappeared_at     timestamptz,

  raw                jsonb,

  unique (kind, source_ref)
);

create index if not exists upcoming_breaks_last_seen_idx
  on upcoming_breaks (last_seen_at desc);
create index if not exists upcoming_breaks_matched_idx
  on upcoming_breaks (matched_product_id);
-- The coverage-gap query: sports rows we could not match, most recent first.
create index if not exists upcoming_breaks_unmatched_sports_idx
  on upcoming_breaks (last_seen_at desc)
  where matched_product_id is null and sport is not null;

-- ---------------------------------------------------------------------------
-- Data API exposure (CLAUDE.md gotcha #12): admin-only, service role only.
-- Nothing here is consumer-facing in this slice.
-- ---------------------------------------------------------------------------
revoke all on break_feed_sources from anon, authenticated;
revoke all on upcoming_breaks   from anon, authenticated;

-- Seed the two sources we verified by hand.
insert into break_feed_sources (kind, identifier, label)
values
  ('steel_city',    'break-room',             'Steel City Collectibles — Break Room'),
  ('fanatics_live', 'east-west-sports-cards', 'East West Sports Cards (Fanatics Live)')
on conflict (kind, identifier) do nothing;

notify pgrst, 'reload schema';
