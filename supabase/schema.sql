-- Card Breakerz — Supabase Schema
-- Run this in the Supabase SQL editor: https://app.supabase.com > SQL Editor

-- ─────────────────────────────────────────────
-- SPORTS
-- ─────────────────────────────────────────────
create table sports (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique  -- 'basketball', 'baseball', 'football'
);

-- ─────────────────────────────────────────────
-- PRODUCTS
-- ─────────────────────────────────────────────
create table products (
  id                    uuid primary key default gen_random_uuid(),
  sport_id              uuid references sports(id) on delete cascade,
  name                  text not null,
  slug                  text not null unique,        -- used in URL: /break/topps-finest-basketball-2025-26
  manufacturer          text,
  year                  text,
  hobby_case_cost       numeric,
  bd_case_cost          numeric,
  hobby_autos_per_case  integer default 16,          -- Finest Basketball: 8 boxes × 2 autos
  bd_autos_per_case     integer default 30,          -- Finest Basketball: 10 boxes × 3 autos
  is_active             boolean default true,
  created_at            timestamptz default now()
);

-- ─────────────────────────────────────────────
-- PLAYERS  (cross-product identity)
-- ─────────────────────────────────────────────
create table players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sport_id   uuid references sports(id) on delete cascade,
  team       text,
  is_rookie  boolean default false,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- PLAYER × PRODUCT  (set appearances)
-- ─────────────────────────────────────────────
create table player_products (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid references players(id) on delete cascade,
  product_id          uuid references products(id) on delete cascade,
  hobby_sets          integer default 0,
  bd_only_sets        integer default 0,
  total_sets          integer generated always as (hobby_sets + bd_only_sets) stored,
  insert_only         boolean default false,         -- true = no auto sets, excluded from slot pricing
  cardhedger_card_id  text,                          -- CardHedger card ID for live pricing lookups
  created_at          timestamptz default now(),
  unique(player_id, product_id)
);

-- ─────────────────────────────────────────────
-- PRICING CACHE  (CardHedger data, TTL-based)
-- ─────────────────────────────────────────────
create table pricing_cache (
  id                  uuid primary key default gen_random_uuid(),
  player_product_id   uuid references player_products(id) on delete cascade unique,
  cardhedger_card_id  text not null,
  ev_low              numeric,
  ev_mid              numeric,
  ev_high             numeric,
  raw_comps           jsonb default '{}',
  fetched_at          timestamptz default now(),
  expires_at          timestamptz
);

create index on pricing_cache (player_product_id);
create index on pricing_cache (expires_at);

-- ─────────────────────────────────────────────
-- SEED DATA — Sports
-- ─────────────────────────────────────────────
insert into sports (name, slug) values
  ('Basketball', 'basketball'),
  ('Baseball',   'baseball'),
  ('Football',   'football');

-- ─────────────────────────────────────────────
-- SEED DATA — Products (starting set)
-- ─────────────────────────────────────────────
insert into products (sport_id, name, slug, manufacturer, year, hobby_case_cost, bd_case_cost, hobby_autos_per_case, bd_autos_per_case)
values
  (
    (select id from sports where slug = 'basketball'),
    'Topps Finest Basketball',
    'topps-finest-basketball-2025-26',
    'Topps',
    '2025-26',
    3840,
    11500,
    16,
    30
  ),
  (
    (select id from sports where slug = 'baseball'),
    'Topps Series 1 Baseball',
    'topps-series-1-baseball-2025',
    'Topps',
    '2025',
    null,
    null,
    null,
    null
  );

-- ─────────────────────────────────────────────
-- SEED DATA — Basketball players (from prototype)
-- ─────────────────────────────────────────────
do $$
declare
  bball_sport_id uuid := (select id from sports where slug = 'basketball');
  finest_product_id uuid := (select id from products where slug = 'topps-finest-basketball-2025-26');
  p_id uuid;
begin
  -- Cooper Flagg
  insert into players (name, sport_id, team, is_rookie) values ('Cooper Flagg', bball_sport_id, 'Dallas Mavericks', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 2);

  -- Kon Knueppel (override EV in pricing_cache after lookup)
  insert into players (name, sport_id, team, is_rookie) values ('Kon Knueppel', bball_sport_id, 'Los Angeles Lakers', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 2);

  -- Dylan Harper
  insert into players (name, sport_id, team, is_rookie) values ('Dylan Harper', bball_sport_id, 'New Jersey Nets', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 2);

  -- Ace Bailey
  insert into players (name, sport_id, team, is_rookie) values ('Ace Bailey', bball_sport_id, 'Houston Rockets', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 2);

  -- Nolan Traore
  insert into players (name, sport_id, team, is_rookie) values ('Nolan Traore', bball_sport_id, 'Cleveland Cavaliers', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 2);

  -- Zaccharie Risacher
  insert into players (name, sport_id, team, is_rookie) values ('Zaccharie Risacher', bball_sport_id, 'Atlanta Hawks', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 1);

  -- Alex Sarr
  insert into players (name, sport_id, team, is_rookie) values ('Alex Sarr', bball_sport_id, 'Washington Wizards', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 1);

  -- Stephon Castle
  insert into players (name, sport_id, team, is_rookie) values ('Stephon Castle', bball_sport_id, 'San Antonio Spurs', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 1);

  -- Dalton Knecht
  insert into players (name, sport_id, team, is_rookie) values ('Dalton Knecht', bball_sport_id, 'Los Angeles Lakers', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 1);

  -- Matas Buzelis
  insert into players (name, sport_id, team, is_rookie) values ('Matas Buzelis', bball_sport_id, 'Chicago Bulls', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 0);

  -- Reed Sheppard
  insert into players (name, sport_id, team, is_rookie) values ('Reed Sheppard', bball_sport_id, 'Houston Rockets', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 2, 0);

  -- Anthony Edwards
  insert into players (name, sport_id, team, is_rookie) values ('Anthony Edwards', bball_sport_id, 'Minnesota Timberwolves', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 1);

  -- Victor Wembanyama
  insert into players (name, sport_id, team, is_rookie) values ('Victor Wembanyama', bball_sport_id, 'San Antonio Spurs', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 1);

  -- Luka Doncic
  insert into players (name, sport_id, team, is_rookie) values ('Luka Doncic', bball_sport_id, 'Dallas Mavericks', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 0);

  -- LeBron James
  insert into players (name, sport_id, team, is_rookie) values ('LeBron James', bball_sport_id, 'Los Angeles Lakers', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 0);

  -- Jayson Tatum
  insert into players (name, sport_id, team, is_rookie) values ('Jayson Tatum', bball_sport_id, 'Boston Celtics', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 0);

  -- Jalen Williams
  insert into players (name, sport_id, team, is_rookie) values ('Jalen Williams', bball_sport_id, 'Oklahoma City Thunder', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 0);

  -- Ja Morant
  insert into players (name, sport_id, team, is_rookie) values ('Ja Morant', bball_sport_id, 'Memphis Grizzlies', false) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, finest_product_id, 1, 0);

  -- VJ Edgecombe (insert-only — excluded from slot pricing)
  insert into players (name, sport_id, team, is_rookie) values ('VJ Edgecombe', bball_sport_id, 'Indiana Pacers', true) returning id into p_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets, insert_only) values (p_id, finest_product_id, 0, 0, true);
end $$;
