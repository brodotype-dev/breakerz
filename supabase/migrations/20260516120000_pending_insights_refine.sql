-- Refine-with-correction flow for /insight + /break-price proposals.
-- When a contributor sees a parse they want to tweak (wrong format,
-- wrong team, missed row, etc.) they click a new "✏️ Refine" button on
-- the proposal panel, which opens a Discord modal for a correction
-- narrative. The handler re-parses the original capture (images +
-- narrative + correction-as-notes) and edits the original proposal in
-- place. Two new columns drive this:
--
-- source_attachments — array of Discord CDN URLs for /break-price
--   captures (slash command + message context menu). NULL for /insight
--   (text-only). Discord CDN URLs are valid ~24h, matching the
--   pending_insights.expires_at TTL, so the refine window equals the
--   confirm window.
--
-- source_kind — explicit enum to route the refine re-parse to the
--   right parser without sniffing payload shapes. 'insight' →
--   parseInsights. 'break_price' → parseBreakPrice.

ALTER TABLE pending_insights
  ADD COLUMN IF NOT EXISTS source_attachments JSONB,
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'insight'
    CHECK (source_kind IN ('insight', 'break_price'));

COMMENT ON COLUMN pending_insights.source_attachments IS
  'Array of {url, filename, content_type} for /break-price captures. Re-fetched at refine time within the 24h Discord CDN window.';

COMMENT ON COLUMN pending_insights.source_kind IS
  'Routes the refine re-parse: insight → parseInsights, break_price → parseBreakPrice.';
