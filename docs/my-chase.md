# My Chase — Architecture

Personal player watchlist. Save players from anywhere they appear in the app, see them in one place at `/chase` with current market value + buzz indicators.

## Data model

Single new table. Composite primary key on `(user_id, player_id)` makes "is this player on my list?" a primary-key lookup and saves us a separate UNIQUE constraint.

```sql
create table user_chase_list (
  user_id    uuid not null references auth.users(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, player_id)
);

create index user_chase_list_user_idx on user_chase_list(user_id, added_at desc);

alter table user_chase_list enable row level security;

create policy "users manage own chase list"
  on user_chase_list for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

RLS uses the same pattern as `user_breaks` — owner reads/writes only. Service-role bypasses for crons (none exist for this table yet, but the path is open).

## API

All routes are auth-gated via the existing middleware matcher. Route handlers also call `getCurrentUser()` defensively so direct hits without a session return 401.

| Method | Path                        | Body                | Returns                                  |
|--------|-----------------------------|---------------------|------------------------------------------|
| GET    | `/api/chase`                | —                   | `ChaseListEntry[]` ordered by `added_at desc` |
| POST   | `/api/chase`                | `{ player_id }`     | `{ ok: true }`                            |
| DELETE | `/api/chase/[playerId]`     | —                   | `{ ok: true }`                            |

`POST` is idempotent — re-adding an already-saved player does nothing (`ON CONFLICT DO NOTHING`).

`GET /api/chase` is the only nontrivial route. It returns one row per saved player, with computed market data joined in. The query lives in `lib/chase.ts`:

1. `user_chase_list` rows for the calling user.
2. Joined to `players` for name / team / `is_rookie` / `is_icon` / `buzz_score` / `breakerz_score`.
3. For market data: `LATERAL` subquery against `pricing_cache` joined through `player_products` — picks the most recent `pricing_cache` row across all of that player's `player_products`. Returns `evMid`, the source `product_id`, and the source product slug for the "see in break" link.
4. Active risk flags joined from `player_risk_flags WHERE cleared_at IS NULL`.

The DTO shape:

```ts
type ChaseListEntry = {
  player_id: string;
  player_name: string;
  team: string | null;
  is_rookie: boolean;
  is_icon: boolean;
  buzz_score: number;
  breakerz_score: number;
  added_at: string;
  market: {
    ev_mid: number;
    product_id: string;
    product_slug: string;
    product_name: string;
    fetched_at: string;
  } | null;          // null when no pricing exists for any of the player's products yet
  risk_flags: Array<{ flag_type: string; note: string }>;
};
```

## UI surfaces

`<ChaseHeartButton player_id={...} />` is the single touch-point. It:
- Reads its initial state from a hydrating fetch (`/api/chase?ids=p1,p2,...`) batched at the parent level — see `useChaseSet` hook in `lib/chase-client.ts`.
- Renders a filled heart when saved, outline otherwise.
- On click: optimistically flips local state, fires `POST` (or `DELETE`), reverts on failure.

Mounted in:
- `PlayerTable` — inline next to the player name.
- `PlayerDetailDrawer` — top of the header, beside the player name + RC badge.
- `PreReleaseLayout` `PlayerRow` — same row as name + chips.

## /chase page

A simple list. One card per saved player:

- Heart (filled, click to remove).
- Name + team + RC / icon badges.
- B-score / volatility / risk-flag chips (same components as `PlayerTable`).
- Market value strip: `EV Mid $XX from <product_name>` with the date and a `→` link to that break.
- Empty state: "No players in your chase list yet — tap the heart on any player to save them."

Sort: `added_at DESC` only in Phase 1. Filters / sort options deferred.

## What this doesn't do (Phase 2+)

- **Cross-product slot EV** — show per saved player which active products they're in and the slot cost in each. Needs UI thinking; current `pricing_cache` schema covers it.
- **Live break links** — when a player's break goes live on Whatnot / Fanatics, link straight to it. Needs platform integrations, not just data.
- **Push notifications** — natural follow-up once we have the chase set + the live break link layer. Web Push needs separate VAPID + permission UX work; not on this PR.
- **Sort / filter** — by buzz score, by recent comp movement, by sport. UX call once we have user behavior to learn from.

## Performance notes

- The heart is on every player row. The `useChaseSet` hook fetches once per page mount (`/api/chase?ids=...`) and caches the set in React state. No per-row API call.
- The `/chase` GET is a single round-trip with `LATERAL` joins. `user_chase_list_user_idx` on `(user_id, added_at desc)` keys the outer scan.
- A user with 50 saved players generates one query with 50 lateral lookups against `pricing_cache` (which is small — one row per `player_product_id`). Sub-100ms in practice.
