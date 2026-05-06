-- pricing_cache.confidence — sales-weighted average of CH's batch-price-estimate
-- confidence (0..1) across the variants that fed this player_product's EV.
-- Captures a signal we already pay for (every batch-price-estimate response
-- includes a per-card confidence score) but were dropping at the upsert step.
-- Lets the consumer break page render a "low confidence" chip for thin-comp
-- rows so users can distinguish "$40, CH is sure" from "$40, one stale sale."
-- Nullable so existing rows don't need a backfill before the next refresh.

ALTER TABLE pricing_cache
  ADD COLUMN IF NOT EXISTS confidence numeric;
