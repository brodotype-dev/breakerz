-- My Chase / Players Hub — Phase 1
-- Personal player watchlist. Composite PK on (user_id, player_id) makes
-- "is this saved?" a primary-key lookup and obviates a UNIQUE constraint.
-- See docs/my-chase.md for architecture.

create table if not exists user_chase_list (
  user_id    uuid not null references auth.users(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, player_id)
);

create index if not exists user_chase_list_user_idx
  on user_chase_list(user_id, added_at desc);

alter table user_chase_list enable row level security;

-- Owner-only. Service role bypasses RLS, so admin/cron paths still work.
create policy "users manage own chase list"
  on user_chase_list for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
