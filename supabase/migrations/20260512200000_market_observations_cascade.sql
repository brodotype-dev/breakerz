-- Track B (Phase 2) — extend market_observations to carry cascading sentiment.
--
-- Three new observation types:
--   team_sentiment         — applies to every player on the team, optionally
--                            scoped to a single product (product_id IS NULL
--                            means global across all products).
--   product_sentiment      — applies to every player in the product.
--   team_product_sentiment — applies only to players who are on the named
--                            team AND in the named product (the intersection).
--
-- product_id is being relaxed to nullable because global team_sentiment rows
-- have no product. The existing engine-side hype_tag / asking_price / odds
-- writers always set product_id; the dispatcher in the Discord route
-- continues to require product_id for those types, so this nullability
-- relaxation does not silently break old writes.
--
-- See docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.

alter table market_observations
  alter column product_id drop not null;

alter table market_observations
  drop constraint if exists market_observations_observation_type_check;

alter table market_observations
  add constraint market_observations_observation_type_check
  check (observation_type in (
    'asking_price',
    'hype_tag',
    'odds_observation',
    'team_sentiment',
    'product_sentiment',
    'team_product_sentiment'
  ));

comment on column market_observations.product_id is
  'NULL only for team_sentiment rows that apply globally across products. All other observation_types still require a product_id (enforced by the dispatcher in app/api/discord/interactions/route.ts).';
