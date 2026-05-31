-- PYT (team-slot) pricing math rewrite — fair-value EV mode flag.
--
-- When false (default): computeSlotPricing uses the existing case-cost-share
-- formula (hobbyBreakCost × hobbyWeight/totalHobbyWeight). Byte-for-byte
-- preserves shipping behavior.
--
-- When true: computeSlotPricing uses fair-value EV
-- (C × H × hobbyEVPerBox per player, summed per team). Same foundation as
-- per-player PYP (lib/player-pyp-pricing.ts) — sums of per-player PYPs
-- across a team now equal team PYT.
--
-- A/B validation runs on /admin/market-delta which always computes both
-- and renders dual Δ columns. Flip in prod once new model's P90 absolute
-- Δ tightens vs. old across captured /break-price observations.

insert into feature_flags (key, enabled, description)
values (
  'fair_value_pyt_enabled',
  false,
  'When true, computeSlotPricing uses fair-value EV per-player math (C × H × hobbyEVPerBox) instead of case-cost-share for hobby team slots. BD/jumbo unchanged in v1. See docs/plans/2026-05-30-handoff.md §4.'
)
on conflict (key) do nothing;
