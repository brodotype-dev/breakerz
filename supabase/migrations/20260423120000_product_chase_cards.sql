create table product_chase_cards (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade not null,
  player_product_id uuid references player_products(id) on delete cascade not null,
  type text not null check (type in ('chase_card', 'chase_player')),
  display_name text,       -- optional admin label (e.g. "1/1 Gold Superfractor Auto")
  odds_display text,       -- text odds (e.g. "1/1", "1:360", "1:288")
  is_hit boolean default false not null,
  hit_at timestamptz,
  hit_reported_by uuid references auth.users(id),
  display_order int default 0 not null,
  created_at timestamptz default now() not null
);

alter table product_chase_cards enable row level security;

create policy "Admins manage chase cards"
  on product_chase_cards for all
  using (
    exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
  );

create policy "Anyone can read chase cards"
  on product_chase_cards for select
  using (true);

create index product_chase_cards_product_id_idx on product_chase_cards(product_id);
