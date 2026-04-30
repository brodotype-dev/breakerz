-- Extend market_observations.observation_type CHECK to include odds_observation.
-- Rationale: capturing field intel about pull-rate corrections (e.g., "this hit
-- pulls 1:80 cases on hobby, not the 1:48 odds sheet says") needs its own
-- observation type since the payload shape and engine semantics differ from
-- asking_price / hype_tag. Storage shape stays the same — payload is JSONB,
-- scope_id / scope_team are already nullable, so variant-scoped rows with no
-- resolved variant_id (free-text variant_name in payload) land here cleanly.

ALTER TABLE market_observations
  DROP CONSTRAINT IF EXISTS market_observations_observation_type_check;

ALTER TABLE market_observations
  ADD CONSTRAINT market_observations_observation_type_check
  CHECK (observation_type IN ('asking_price', 'hype_tag', 'odds_observation'));
