-- Add 'prospect_rank_move' to the market_observations observation_type
-- enum-check — Slice 2b of the web-sourced-intel plan (Track A).
--
-- When an admin endorses a material rank move (≥3 spots / new entry /
-- drop-off) surfaced by the prospect-rankings diff, we write a dedicated
-- player-scoped observation here rather than into player_products.breakerz_score.
--
-- Why a dedicated type instead of "global sentiment" (breakerz_score):
--   - breakerz_score is the Track B SME-sentiment score; writing Track A
--     (objective rank) into it conflates the two tracks the moat keeps
--     separate, and the next /insight on that player would clobber it
--     (the sentiment apply path SETS, not increments).
--   - players.prospect_rank feeds the engine's computeProspectAdjustment
--     unconditionally, which would bypass the Slice-6 shadow gate.
-- A prospect_rank_move market_observation is attributable, track-separated,
-- and does not touch the engine until we deliberately wire it in.
--
-- Shape of these rows (written by /api/admin/apply-prospect-moves):
--   observation_type = 'prospect_rank_move'
--   scope_type       = 'player'
--   scope_id         = players.id
--   product_id       = NULL   (sport-wide — not product-specific)
--   payload          = { source, kind, prior_rank, new_rank, delta, direction }
--
-- market_observations is already consumer-readable (existing grants for
-- the Why-this-price / pre-release surfaces); a CHECK extension changes
-- no columns/functions/grants, so no REVOKE and no `NOTIFY pgrst` needed.

alter table market_observations
  drop constraint if exists market_observations_observation_type_check;

alter table market_observations
  add constraint market_observations_observation_type_check
  check (observation_type = any (array[
    'asking_price'::text,
    'hype_tag'::text,
    'odds_observation'::text,
    'team_sentiment'::text,
    'product_sentiment'::text,
    'team_product_sentiment'::text,
    'prospect_rank_move'::text
  ]));
