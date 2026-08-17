-- Per-player-per-product manual EV override.
--
-- Lets an admin (Brody / Kyle) set a base EV for a player whose modeled value
-- doesn't match reality — a player expected to explode, or a base the pipeline
-- gets wrong. The override is the BASE EV; display-layer breaker markup,
-- compression, and pool weighting still apply at render, so the slot price is
-- NOT equal to the entered number.
--
-- Applied at READ time (see lib/ev-override.ts) in every PlayerWithPricing
-- builder, so it's authoritative regardless of pricing_cache / refresh state
-- and works identically for live and pre-release products. The pricing engine,
-- refresh pipeline, and pricing_cache are untouched.
--
-- player_products is an existing table already granted to the app roles; adding
-- nullable columns needs no new grants (gotcha #12) and no RLS change (all
-- access is via the service-role client). No functions added → no NOTIFY.

ALTER TABLE public.player_products
  ADD COLUMN IF NOT EXISTS ev_override        numeric,      -- base EV; NULL = no override
  ADD COLUMN IF NOT EXISTS ev_override_note   text,         -- why (e.g. "expected to explode post-callup")
  ADD COLUMN IF NOT EXISTS ev_override_set_by text,         -- who set it (Brody / Kyle)
  ADD COLUMN IF NOT EXISTS ev_override_set_at timestamptz;  -- when

COMMENT ON COLUMN public.player_products.ev_override IS
  'Manual base-EV override (numeric). NULL = use the modeled EV. Applied at read time in lib/ev-override.ts; flows through markup/compression/pool weighting at render.';
