-- 2025 Topps Series 1 & 2 Baseball
-- Auto candidates: Rookies, Future Stars, and key veterans
-- Run after schema.sql

do $$
declare
  baseball_id uuid := (select id from sports where slug = 'baseball');
  s1_id uuid;
  s2_id uuid;
  p_id uuid;
begin

  -- ── Upsert Series 1 ───────────────────────────────────────────
  insert into products (sport_id, name, slug, manufacturer, year, hobby_case_cost, hobby_autos_per_case, is_active)
  values (baseball_id, 'Topps Series 1 Baseball', 'topps-series-1-baseball-2025', 'Topps', '2025', 1200, 24, true)
  on conflict (slug) do update set
    hobby_case_cost      = excluded.hobby_case_cost,
    hobby_autos_per_case = excluded.hobby_autos_per_case
  returning id into s1_id;

  -- ── Upsert Series 2 ───────────────────────────────────────────
  insert into products (sport_id, name, slug, manufacturer, year, hobby_case_cost, hobby_autos_per_case, is_active)
  values (baseball_id, 'Topps Series 2 Baseball', 'topps-series-2-baseball-2025', 'Topps', '2025', 1200, 24, true)
  on conflict (slug) do update set
    hobby_case_cost      = excluded.hobby_case_cost,
    hobby_autos_per_case = excluded.hobby_autos_per_case
  returning id into s2_id;

  -- ────────────────────────────────────────────────────────────────
  -- Helper: upsert player, load id into p_id
  -- ────────────────────────────────────────────────────────────────

  -- ── Series 1 — Key Veterans & Stars ─────────────────────────────
  -- Shohei Ohtani
  insert into players (name, sport_id, team, is_rookie) values ('Shohei Ohtani', baseball_id, 'Los Angeles Dodgers', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Shohei Ohtani' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Aaron Judge
  insert into players (name, sport_id, team, is_rookie) values ('Aaron Judge', baseball_id, 'New York Yankees', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Aaron Judge' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Paul Skenes
  insert into players (name, sport_id, team, is_rookie) values ('Paul Skenes', baseball_id, 'Pittsburgh Pirates', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Paul Skenes' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Bobby Witt Jr.
  insert into players (name, sport_id, team, is_rookie) values ('Bobby Witt Jr.', baseball_id, 'Kansas City Royals', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Bobby Witt Jr.' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Gunnar Henderson
  insert into players (name, sport_id, team, is_rookie) values ('Gunnar Henderson', baseball_id, 'Baltimore Orioles', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Gunnar Henderson' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Elly De La Cruz
  insert into players (name, sport_id, team, is_rookie) values ('Elly De La Cruz', baseball_id, 'Cincinnati Reds', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Elly De La Cruz' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Vladimir Guerrero Jr.
  insert into players (name, sport_id, team, is_rookie) values ('Vladimir Guerrero Jr.', baseball_id, 'Toronto Blue Jays', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Vladimir Guerrero Jr.' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Juan Soto
  insert into players (name, sport_id, team, is_rookie) values ('Juan Soto', baseball_id, 'New York Yankees', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Juan Soto' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Corbin Carroll
  insert into players (name, sport_id, team, is_rookie) values ('Corbin Carroll', baseball_id, 'Arizona Diamondbacks', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Corbin Carroll' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Bryce Harper
  insert into players (name, sport_id, team, is_rookie) values ('Bryce Harper', baseball_id, 'Philadelphia Phillies', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Bryce Harper' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Freddie Freeman
  insert into players (name, sport_id, team, is_rookie) values ('Freddie Freeman', baseball_id, 'Los Angeles Dodgers', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Freddie Freeman' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- ── Series 1 — Future Stars ──────────────────────────────────────
  -- Jackson Holliday (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Jackson Holliday', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jackson Holliday' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Yoshinobu Yamamoto (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Yoshinobu Yamamoto', baseball_id, 'Los Angeles Dodgers', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Yoshinobu Yamamoto' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Tyler Soderstrom (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Tyler Soderstrom', baseball_id, 'Athletics', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Tyler Soderstrom' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Jordan Westburg (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Jordan Westburg', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jordan Westburg' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Ceddanne Rafaela (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Ceddanne Rafaela', baseball_id, 'Boston Red Sox', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Ceddanne Rafaela' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Evan Carter (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Evan Carter', baseball_id, 'Texas Rangers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Evan Carter' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Pete Crow-Armstrong (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Pete Crow-Armstrong', baseball_id, 'Chicago Cubs', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Pete Crow-Armstrong' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Kyle Harrison (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Kyle Harrison', baseball_id, 'San Francisco Giants', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kyle Harrison' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- ── Series 1 — Rookies ───────────────────────────────────────────
  -- Jackson Chourio
  insert into players (name, sport_id, team, is_rookie) values ('Jackson Chourio', baseball_id, 'Milwaukee Brewers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jackson Chourio' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Wyatt Langford
  insert into players (name, sport_id, team, is_rookie) values ('Wyatt Langford', baseball_id, 'Texas Rangers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Wyatt Langford' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Colton Cowser
  insert into players (name, sport_id, team, is_rookie) values ('Colton Cowser', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Colton Cowser' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Junior Caminero
  insert into players (name, sport_id, team, is_rookie) values ('Junior Caminero', baseball_id, 'Tampa Bay Rays', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Junior Caminero' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Coby Mayo
  insert into players (name, sport_id, team, is_rookie) values ('Coby Mayo', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Coby Mayo' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- James Wood
  insert into players (name, sport_id, team, is_rookie) values ('James Wood', baseball_id, 'Washington Nationals', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'James Wood' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Dylan Crews
  insert into players (name, sport_id, team, is_rookie) values ('Dylan Crews', baseball_id, 'Washington Nationals', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Dylan Crews' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Jhonkensy Noel
  insert into players (name, sport_id, team, is_rookie) values ('Jhonkensy Noel', baseball_id, 'Cleveland Guardians', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jhonkensy Noel' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Cade Povich
  insert into players (name, sport_id, team, is_rookie) values ('Cade Povich', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Cade Povich' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Chayce McDermott
  insert into players (name, sport_id, team, is_rookie) values ('Chayce McDermott', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Chayce McDermott' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Angel Martínez
  insert into players (name, sport_id, team, is_rookie) values ('Angel Martínez', baseball_id, 'Cleveland Guardians', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Angel Martínez' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Carlos Narváez
  insert into players (name, sport_id, team, is_rookie) values ('Carlos Narváez', baseball_id, 'New York Yankees', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Carlos Narváez' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Will Warren
  insert into players (name, sport_id, team, is_rookie) values ('Will Warren', baseball_id, 'New York Yankees', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Will Warren' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Dillon Dingler
  insert into players (name, sport_id, team, is_rookie) values ('Dillon Dingler', baseball_id, 'Detroit Tigers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Dillon Dingler' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Rhett Lowder
  insert into players (name, sport_id, team, is_rookie) values ('Rhett Lowder', baseball_id, 'Cincinnati Reds', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Rhett Lowder' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Spencer Schwellenbach
  insert into players (name, sport_id, team, is_rookie) values ('Spencer Schwellenbach', baseball_id, 'Atlanta Braves', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Spencer Schwellenbach' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Blake Dunn
  insert into players (name, sport_id, team, is_rookie) values ('Blake Dunn', baseball_id, 'Cincinnati Reds', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Blake Dunn' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Ben Rice
  insert into players (name, sport_id, team, is_rookie) values ('Ben Rice', baseball_id, 'New York Yankees', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Ben Rice' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Zebby Matthews
  insert into players (name, sport_id, team, is_rookie) values ('Zebby Matthews', baseball_id, 'Minnesota Twins', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Zebby Matthews' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Tyler Locklear
  insert into players (name, sport_id, team, is_rookie) values ('Tyler Locklear', baseball_id, 'Seattle Mariners', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Tyler Locklear' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Ky Bush
  insert into players (name, sport_id, team, is_rookie) values ('Ky Bush', baseball_id, 'Chicago White Sox', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Ky Bush' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Grant McCray
  insert into players (name, sport_id, team, is_rookie) values ('Grant McCray', baseball_id, 'San Francisco Giants', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Grant McCray' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Nacho Alvarez Jr.
  insert into players (name, sport_id, team, is_rookie) values ('Nacho Alvarez Jr.', baseball_id, 'Atlanta Braves', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Nacho Alvarez Jr.' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Justin Wrobleski
  insert into players (name, sport_id, team, is_rookie) values ('Justin Wrobleski', baseball_id, 'Los Angeles Dodgers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Justin Wrobleski' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Hurston Waldrep
  insert into players (name, sport_id, team, is_rookie) values ('Hurston Waldrep', baseball_id, 'Atlanta Braves', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Hurston Waldrep' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Drew Romo
  insert into players (name, sport_id, team, is_rookie) values ('Drew Romo', baseball_id, 'Colorado Rockies', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Drew Romo' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- River Ryan
  insert into players (name, sport_id, team, is_rookie) values ('River Ryan', baseball_id, 'Los Angeles Dodgers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'River Ryan' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- Andrés Chaparro
  insert into players (name, sport_id, team, is_rookie) values ('Andrés Chaparro', baseball_id, 'Washington Nationals', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Andrés Chaparro' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s1_id, 1, 0) on conflict do nothing;

  -- ── Series 2 — Key Veterans & Stars ─────────────────────────────
  -- Shohei Ohtani (appears in both)
  select id into p_id from players where name = 'Shohei Ohtani' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Juan Soto (S2 as NY Met)
  insert into players (name, sport_id, team, is_rookie) values ('Juan Soto', baseball_id, 'New York Mets', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Juan Soto' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Mookie Betts
  insert into players (name, sport_id, team, is_rookie) values ('Mookie Betts', baseball_id, 'Los Angeles Dodgers', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Mookie Betts' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Fernando Tatis Jr.
  insert into players (name, sport_id, team, is_rookie) values ('Fernando Tatis Jr.', baseball_id, 'San Diego Padres', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Fernando Tatis Jr.' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Pete Alonso
  insert into players (name, sport_id, team, is_rookie) values ('Pete Alonso', baseball_id, 'New York Mets', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Pete Alonso' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Kyle Tucker
  insert into players (name, sport_id, team, is_rookie) values ('Kyle Tucker', baseball_id, 'Chicago Cubs', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kyle Tucker' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Paul Skenes (appears in both)
  select id into p_id from players where name = 'Paul Skenes' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Gunnar Henderson (appears in both)
  select id into p_id from players where name = 'Gunnar Henderson' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Elly De La Cruz (appears in both)
  select id into p_id from players where name = 'Elly De La Cruz' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Bobby Witt Jr. (appears in both)
  select id into p_id from players where name = 'Bobby Witt Jr.' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Steven Kwan
  insert into players (name, sport_id, team, is_rookie) values ('Steven Kwan', baseball_id, 'Cleveland Guardians', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Steven Kwan' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Cal Raleigh
  insert into players (name, sport_id, team, is_rookie) values ('Cal Raleigh', baseball_id, 'Seattle Mariners', false) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Cal Raleigh' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- ── Series 2 — Future Stars ──────────────────────────────────────
  -- Roki Sasaki (Rookie)
  insert into players (name, sport_id, team, is_rookie) values ('Roki Sasaki', baseball_id, 'Los Angeles Dodgers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Roki Sasaki' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Wilyer Abreu (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Wilyer Abreu', baseball_id, 'Boston Red Sox', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Wilyer Abreu' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Jordan Lawlar (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Jordan Lawlar', baseball_id, 'Arizona Diamondbacks', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jordan Lawlar' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Junior Caminero (Future Stars in S2)
  select id into p_id from players where name = 'Junior Caminero' and sport_id = baseball_id;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Jared Jones (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Jared Jones', baseball_id, 'Pittsburgh Pirates', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jared Jones' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Parker Meadows (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Parker Meadows', baseball_id, 'Detroit Tigers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Parker Meadows' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Gavin Williams (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Gavin Williams', baseball_id, 'Cleveland Guardians', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Gavin Williams' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Kyle Manzardo (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Kyle Manzardo', baseball_id, 'Cleveland Guardians', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kyle Manzardo' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Zack Gelof (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Zack Gelof', baseball_id, 'Athletics', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Zack Gelof' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Sal Frelick (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Sal Frelick', baseball_id, 'Milwaukee Brewers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Sal Frelick' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Heston Kjerstad (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Heston Kjerstad', baseball_id, 'Baltimore Orioles', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Heston Kjerstad' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Jasson Dominguez (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Jasson Dominguez', baseball_id, 'New York Yankees', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jasson Dominguez' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Noelvi Marte (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Noelvi Marte', baseball_id, 'Cincinnati Reds', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Noelvi Marte' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- AJ Smith-Shawver (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('AJ Smith-Shawver', baseball_id, 'Atlanta Braves', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'AJ Smith-Shawver' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Ben Brown (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Ben Brown', baseball_id, 'Chicago Cubs', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Ben Brown' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Andy Pages (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Andy Pages', baseball_id, 'Los Angeles Dodgers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Andy Pages' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Tobias Myers (Future Stars)
  insert into players (name, sport_id, team, is_rookie) values ('Tobias Myers', baseball_id, 'Milwaukee Brewers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Tobias Myers' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- ── Series 2 — Rookies ───────────────────────────────────────────
  -- Kyle Stowers
  insert into players (name, sport_id, team, is_rookie) values ('Kyle Stowers', baseball_id, 'Miami Marlins', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kyle Stowers' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Roman Anthony
  insert into players (name, sport_id, team, is_rookie) values ('Roman Anthony', baseball_id, 'Boston Red Sox', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Roman Anthony' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Kristian Campbell
  insert into players (name, sport_id, team, is_rookie) values ('Kristian Campbell', baseball_id, 'Boston Red Sox', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kristian Campbell' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Jac Caglianone
  insert into players (name, sport_id, team, is_rookie) values ('Jac Caglianone', baseball_id, 'Kansas City Royals', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jac Caglianone' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Jackson Jobe
  insert into players (name, sport_id, team, is_rookie) values ('Jackson Jobe', baseball_id, 'Detroit Tigers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Jackson Jobe' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Kumar Rocker
  insert into players (name, sport_id, team, is_rookie) values ('Kumar Rocker', baseball_id, 'Texas Rangers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kumar Rocker' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Logan Driscoll
  insert into players (name, sport_id, team, is_rookie) values ('Logan Driscoll', baseball_id, 'Tampa Bay Rays', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Logan Driscoll' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Luisangel Acuña
  insert into players (name, sport_id, team, is_rookie) values ('Luisangel Acuña', baseball_id, 'New York Mets', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Luisangel Acuña' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Duke Ellis
  insert into players (name, sport_id, team, is_rookie) values ('Duke Ellis', baseball_id, 'New York Yankees', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Duke Ellis' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Mason Montgomery
  insert into players (name, sport_id, team, is_rookie) values ('Mason Montgomery', baseball_id, 'Tampa Bay Rays', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Mason Montgomery' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Dustin Harris
  insert into players (name, sport_id, team, is_rookie) values ('Dustin Harris', baseball_id, 'Texas Rangers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Dustin Harris' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Hyeseong Kim
  insert into players (name, sport_id, team, is_rookie) values ('Hyeseong Kim', baseball_id, 'Los Angeles Dodgers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Hyeseong Kim' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Kevin Alcántara
  insert into players (name, sport_id, team, is_rookie) values ('Kevin Alcántara', baseball_id, 'Chicago Cubs', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Kevin Alcántara' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Steward Berroa
  insert into players (name, sport_id, team, is_rookie) values ('Steward Berroa', baseball_id, 'Toronto Blue Jays', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Steward Berroa' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Nick Yorke
  insert into players (name, sport_id, team, is_rookie) values ('Nick Yorke', baseball_id, 'Pittsburgh Pirates', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Nick Yorke' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Hayden Birdsong
  insert into players (name, sport_id, team, is_rookie) values ('Hayden Birdsong', baseball_id, 'San Francisco Giants', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Hayden Birdsong' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Javier Sanoja
  insert into players (name, sport_id, team, is_rookie) values ('Javier Sanoja', baseball_id, 'Miami Marlins', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Javier Sanoja' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Grant Holmes
  insert into players (name, sport_id, team, is_rookie) values ('Grant Holmes', baseball_id, 'Atlanta Braves', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Grant Holmes' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Walter Pennington
  insert into players (name, sport_id, team, is_rookie) values ('Walter Pennington', baseball_id, 'Texas Rangers', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Walter Pennington' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Michael Mercado
  insert into players (name, sport_id, team, is_rookie) values ('Michael Mercado', baseball_id, 'Philadelphia Phillies', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Michael Mercado' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

  -- Will Wagner
  insert into players (name, sport_id, team, is_rookie) values ('Will Wagner', baseball_id, 'Toronto Blue Jays', true) on conflict do nothing returning id into p_id;
  if p_id is null then select id into p_id from players where name = 'Will Wagner' and sport_id = baseball_id; end if;
  insert into player_products (player_id, product_id, hobby_sets, bd_only_sets) values (p_id, s2_id, 1, 0) on conflict do nothing;

end $$;
