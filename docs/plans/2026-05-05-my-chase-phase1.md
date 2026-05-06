# My Chase / Players Hub — Phase 1

**Status:** Implemented in this PR. Phase 1 only — Phase 2 (cross-product slot EV view) and Phase 3 (live break links / push notifications) deferred per BACKLOG Vision 5.

## Context

BreakIQ today is "open it during a live break, get a verdict, leave." There's no reason to come back unless a break is happening. The Chase / Players Hub turns it into a daily-check tool — a personal watchlist of players with current market value + buzz indicators, anchored on names you actually care about.

Phase 1 is the smallest version that demonstrates value: save players, see them in one place, see their current price + B-score + risk flags. No cross-product analysis yet, no notifications.

The naming collision with the existing admin "Chase Cards" feature (per-product hype list) is intentional — both surfaces convey "this is something a user is watching for." The data models are separate and don't conflict.

## Scope

**In:**
1. New `user_chase_list` table (`user_id`, `player_id`, `added_at`) with RLS scoped to the owner.
2. `GET / POST / DELETE /api/chase` for read / add / remove.
3. `<ChaseHeartButton player_id />` client component — optimistic toggle, auth-gated, calls the API.
4. `/chase` consumer page — list view of saved players. Per row: name, team, RC/icon badges, B-score signal (bullish/bearish/HV), active risk flags, latest market value (`evMid` of the most-recently-priced `player_product`), link to the break page that produced that pricing.
5. Heart in three places: `PlayerTable` rows (`/break/[slug]`), `PlayerDetailDrawer` header (drilldown from break page), `PreReleaseLayout`'s `PlayerRow`. Wherever a player's name is rendered in a list, the heart is reachable.
6. "Chase" link in `ConsumerNav` (both desktop bar and mobile hamburger drawer).

**Out (Phase 2+ in BACKLOG):**
- Cross-product slot EV per saved player.
- Live break links to Fanatics Collect / Whatnot / eBay.
- Push notifications when a saved player's break goes live.
- Sorting beyond "most recently added."
- Bulk save.

## Files

**New:**
- `supabase/migrations/20260506030000_user_chase_list.sql` — table, RLS, indexes.
- `app/api/chase/route.ts` — GET (list with computed market data) + POST (add).
- `app/api/chase/[playerId]/route.ts` — DELETE (remove).
- `components/breakiq/ChaseHeartButton.tsx` — client component, optimistic, auth-gated.
- `app/(consumer)/chase/page.tsx` — list page.
- `lib/chase.ts` — shared SQL → DTO logic for the list endpoint (joins players + most-recent pricing_cache + risk flags).

**Modified:**
- `middleware.ts` — add `/chase` and `/api/chase` to the matcher.
- `app/(consumer)/ConsumerNav.tsx` — Chase link in desktop nav + mobile drawer.
- `components/breakiq/PlayerTable.tsx` — render `<ChaseHeartButton>` next to player name.
- `components/breakiq/PlayerDetailDrawer.tsx` — heart in the header.
- `components/breakiq/PreReleaseLayout.tsx` — heart in `PlayerRow`.
- `lib/types.ts` — `ChaseListEntry` DTO.
- `CHANGELOG.md`, `CLAUDE.md` — index + summary.

## Critical reuse

- `pricing_cache` already keyed by `player_product_id`; aggregating to player-level uses `MAX(fetched_at) GROUP BY player_id` — no new pricing math.
- `player_risk_flags` already has `cleared_at IS NULL` filter — reused as-is.
- `players.is_rookie`, `is_icon`, `buzz_score`, `breakerz_score` — already populated by existing crons.
- `lib/auth.ts` `getCurrentUser()` for auth on the API routes.
- `getCurrentUser` + middleware redirect pattern from `/my-breaks` for the `/chase` route.

## Verification

1. `supabase db push` to apply migration; confirm `user_chase_list` exists in production.
2. Heart a player from `/break/<slug>`; navigate to `/chase`; that player appears with their current `evMid`.
3. Unheart from `/chase`; confirm row removed and re-checking `/break/<slug>` shows the heart filled state cleared.
4. Sign in as user A, add Wander Franco; sign out; sign in as user B; `/chase` is empty for B.
5. Hit the API directly: `curl /api/chase` returns only the calling user's rows.
6. RLS smoke test: in SQL editor as user A, `SELECT * FROM user_chase_list` returns only A's rows.
7. Mobile (iPhone 16 Pro) — heart toggle is reachable in `PlayerTable`, `/chase` list reads cleanly, hamburger has the link.
