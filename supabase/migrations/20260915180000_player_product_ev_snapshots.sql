-- Daily EV snapshots + per-team trend.
--
-- WHY: pricing_cache has a UNIQUE constraint on player_product_id and is
-- upserted on every refresh, so each player keeps exactly one row that is
-- overwritten nightly. ch_price_cache behaves the same way. There is no
-- history anywhere in the schema, so "is this team trending up or down"
-- could not be answered at all. This adds the smallest store that answers
-- it: one ev_mid per player_product per day, written by the refresh that
-- already computes those numbers (no extra CardHedger calls).

create table if not exists player_product_ev_snapshots (
  player_product_id uuid not null references player_products(id) on delete cascade,
  captured_on       date not null default (now() at time zone 'utc')::date,
  ev_mid            numeric not null,
  created_at        timestamptz not null default now(),
  primary key (player_product_id, captured_on)
);

-- The trend RPC scans by date first (everything on/before a cutoff for one
-- product), then picks the newest row per player_product.
create index if not exists ppev_snapshots_captured_on_idx
  on player_product_ev_snapshots (captured_on desc);

alter table player_product_ev_snapshots enable row level security;
-- No policies — service-role only, same as every other internal table.
revoke all on table player_product_ev_snapshots from anon, authenticated;

comment on table player_product_ev_snapshots is
  'Daily ev_mid per player_product, written by lib/pricing-refresh.ts alongside the pricing_cache upsert. One row per (player_product, UTC day); repeat cron firings on the same day overwrite rather than duplicate. Source for the per-team trend arrow on /break/[slug]. Service-role only.';

-- Per-team "now vs N days ago", aggregated server-side.
--
-- WHY AN RPC: a product can carry thousands of player_products. Reading raw
-- snapshot rows into the app would hit PostgREST's 1000-row cap and would
-- need .in() chunking under Kong's 200-UUID limit (gotcha #11). This returns
-- one small row per team instead.
--
-- CORRECTNESS: ev_now is summed over exactly the player_products that have a
-- "then" row. Summing all of today's players against a smaller historical set
-- would report roster growth (a newly-priced player) as price movement.
create or replace function team_ev_trend(p_product_id uuid, p_days int default 7)
returns table (team text, ev_now numeric, ev_then numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cutoff as (
    select ((now() at time zone 'utc')::date - make_interval(days => p_days))::date as d
  ),
  -- Newest snapshot on or before the cutoff, per player_product.
  then_rows as (
    select distinct on (s.player_product_id)
           s.player_product_id,
           s.ev_mid
      from player_product_ev_snapshots s
      join player_products pp on pp.id = s.player_product_id
     where pp.product_id = p_product_id
       and s.captured_on <= (select d from cutoff)
     order by s.player_product_id, s.captured_on desc
  )
  select coalesce(pl.team, 'Unknown') as team,
         sum(pc.ev_mid)              as ev_now,
         sum(t.ev_mid)               as ev_then
    from then_rows t
    join player_products pp on pp.id = t.player_product_id
    join players pl         on pl.id = pp.player_id
    join pricing_cache pc   on pc.player_product_id = pp.id
   where pp.product_id = p_product_id
     and pc.ev_mid is not null
   group by coalesce(pl.team, 'Unknown')
  having sum(t.ev_mid) > 0;
$$;

-- SECURITY DEFINER functions are EXECUTE TO PUBLIC by default, which exposes
-- them at POST /rest/v1/rpc/<name>. This one is called only by the server
-- with the service role. See CLAUDE.md gotcha #12.
revoke execute on function team_ev_trend(uuid, int) from public, anon, authenticated;

comment on function team_ev_trend(uuid, int) is
  'Per-team sum of ev_mid now vs the newest snapshot on or before N days ago, restricted to player_products present in both. Powers the trend arrow on the team slots table. Service-role only.';

-- Function-adding migration → PostgREST needs its schema cache reloaded or
-- the first .rpc() call 404s. See CLAUDE.md gotcha #10.
notify pgrst, 'reload schema';
