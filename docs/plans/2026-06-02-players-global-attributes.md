# Players-as-global re-model — Plan + Handoff (2026-06-02)

> **Status:** ✅ **code complete on branch `feat/players-global`** (off `origin/main`). Build clean. Phase-1 migration applied to prod (additive). Phase-2 cleanup migration written but **NOT applied** (deploy-gated). Triggered by Brody noticing there's no global way to manage player attributes — you edit them inside a product, but they're global, not product-specific.

## The problem

Three "player" attributes were mixed in the schema:

| Attribute | Was on | Truly global? |
|---|---|---|
| Icon (`is_icon`) | `players` | ✅ already global, no global edit surface |
| High-volatility (`is_high_volatility`) | `player_products` | ❌ per (player × product) |
| Risk flags (`player_risk_flags`) | keyed by `player_product_id` | ❌ per (player × product) |
| B-score (`breakerz_score`) | `player_products` | ✅ intentionally product-scoped (sentiment varies by product) — **left alone** |

Brody's framing: *cards of players are product-specific, players as players are global.* An injury / suspension / volatile market follows the athlete across every product. So HV + risk flags move to the player; B-score stays per-product.

**Validating finding:** the Discord `/insight` apply path already fanned each risk flag out to every one of a player's `player_products` — 63 rows collapsing to 14 logical flags across 13 players. The re-model removes that redundancy rather than adding a concept.

## What shipped

**Phase-1 migration** (`20260602120000_players_global_attributes.sql`, applied to prod — additive + invisible to old code):
- `players.is_high_volatility` added + backfilled (HV if ANY of the player's products was HV → 1 player).
- `player_risk_flags.player_id` FK added + backfilled from the product join (all 63 rows, 0 null). `player_product_id` made nullable. New indexes.

**Read sites → player-global** (HV off the `players` join; flags by `player_id` with defensive dedup of the fan-out):
- `lib/pricing-read.ts`, `lib/team-fair-value.ts` — HV from `pp.player.is_high_volatility`.
- `lib/analysis.ts` — flags fetched by `player_id`, `riskAdjMap` still keyed by ppId via player→pp projection; HV filter off the player; bundle riskFlags response deduped.
- `lib/break-page-data.ts` — flags by `player_id`, projected back onto each ppId so the client's ppId-keyed `riskFlagRecord`/`riskAdjMap` is unchanged.
- `lib/chase.ts` — simplified (it already did a pp→player workaround); now queries `player_id` directly.
- `app/api/player-profile/route.ts` — queries by `player_id`; dropped the now-meaningless per-flag product attribution.

**Write paths:**
- `app/admin/players/actions.ts` (new) — `setPlayerIcon` / `setPlayerHighVolatility` / `addPlayerRiskFlag` / `clearPlayerRiskFlag`, all keyed by `player_id`, revalidate `/admin/players`. The product-scoped versions were removed from `app/admin/products/actions.ts`.
- `app/api/discord/interactions/route.ts` — risk_flag apply collapses the fan-out loop to a single insert by `player_id`.

**New global directory:**
- `app/admin/players/page.tsx` — server-loads only the "managed" set (icon/HV/flagged players) for the default view (players table exceeds PostgREST's 1k cap).
- `app/admin/players/GlobalPlayersManager.tsx` — search box (debounced → admin search API) + per-player icon/HV toggles + risk-flag add/clear.
- `app/api/admin/players/search/route.ts` — admin-gated rich search (icon + HV + active flags).
- Nav entry added in `AdminNav.tsx`.

**Product players page** (`app/admin/products/[id]/players/`): icon/HV/flag controls removed; `PlayersManager` is now a read-only roster; a link points to the global directory. B-score / bets stay on the product surface.

**Types** (`lib/types.ts`): `Player.is_high_volatility` added (source of truth); `PlayerProduct.is_high_volatility` marked legacy; `PlayerRiskFlag` gains `player_id`, `player_product_id` now nullable.

## ⚠️ Deploy ordering (important)

Phase-1 is additive and live. **The phase-2 cleanup migration (`20260602130000_players_global_attributes_cleanup.sql`) must NOT be applied until this branch is deployed to prod.** It deletes the 49 redundant fan-out rows and drops `player_products.is_high_volatility` + `player_risk_flags.player_product_id`. Running it while old code still reads flags by `player_product_id` would strip flags from a player's other products. New read code dedups defensively, so there's no rush — apply it any time after deploy.

## Verification done
- Phase-1 backfill verified: 1 HV player, 63 flags carry `player_id` (0 null), 13 active logical groups.
- `npm run build` clean (only the pre-existing workspace-root lockfile warning).

## Verification owed (post-deploy, manual)
- `/admin/players`: search a player, toggle icon + HV, add + clear a risk flag — confirm it persists and shows on the consumer break page for ALL of that player's products.
- Consumer break page + `/analysis`: a flagged/HV player still renders the badge + folds into `effectiveScore`.
- Discord `/insight` risk_flag: apply one, confirm a single row lands keyed by `player_id`.
- Then apply the phase-2 cleanup migration via Supabase MCP.
