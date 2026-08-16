-- Pre-release pricing Phase 1 (2026-08-14). See docs/plans/2026-08-14-pre-release-pricing.md.
-- Applied via Supabase MCP; file for traceability. Both columns inherit their
-- table grants (products / player_products already exposed appropriately).
--
-- previous_product_id: admin-linked prior-cycle product (2026 Bowman ← 2025
-- Bowman, Chrome Update ← Chrome, …) — the source of a non-rookie's baseline.
alter table public.products
  add column if not exists previous_product_id uuid references public.products(id);

-- pre_release_base_ev: synthesized baseline EV per player for a pre-release
-- product (previous-cycle value / raw_avg_90d for non-rookies; rank-tiered floor
-- for rookies). Written by the "Build pre-release baseline" admin action, then
-- admin-adjustable. Superseded by real pricing_cache EV once the product goes live.
alter table public.player_products
  add column if not exists pre_release_base_ev numeric;
