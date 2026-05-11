-- Plan C: stamp the moment a product transitioned pre_release → live so
-- pricing-refresh can apply a first-2-weeks-live freshness decay. Pure-EV
-- math layer; Plan B's display markup compounds on top.
--
-- See docs/plans/2026-05-11-release-freshness-decay.md.

alter table products
  add column if not exists live_since timestamptz;

-- Backfill currently-live products to created_at. Anything already past
-- the 30-day freshness floor will get multiplier=1.0 — no behavior change.
-- New pre_release → live transitions will stamp now() going forward.
update products
   set live_since = created_at
 where live_since is null
   and lifecycle_status = 'live';

comment on column products.live_since is
  'Timestamp of the most recent pre_release → live transition. NULL for products that have never been live. Drives the FRESHNESS_PREMIUM decay in lib/market-markup.ts.';
