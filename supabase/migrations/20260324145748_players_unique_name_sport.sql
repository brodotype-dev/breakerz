-- Deduplicate players(name, sport_id), then add unique constraint
-- For each duplicate group, keep the oldest row and re-point all FK references to it

-- Step 1: Re-point player_products to the canonical (oldest) player
update player_products pp
set player_id = canonical.id
from (
  select distinct on (name, sport_id)
    id,
    name,
    sport_id
  from players
  order by name, sport_id, created_at asc
) canonical
join players dup
  on dup.name = canonical.name
  and dup.sport_id = canonical.sport_id
  and dup.id != canonical.id
where pp.player_id = dup.id;

-- Step 2: Delete duplicate players (non-canonical)
delete from players
where id not in (
  select distinct on (name, sport_id) id
  from players
  order by name, sport_id, created_at asc
);

-- Step 3: Add unique constraint
alter table players
  add constraint players_name_sport_id_unique unique (name, sport_id);
