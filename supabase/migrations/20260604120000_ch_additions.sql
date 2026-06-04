-- CardHedger additions feed. River (CH) pointed us at /v1/cards/additions-summary
-- (2026-06-03) as the closest thing to a release calendar — what CH adds daily.
-- A nightly cron snapshots it here; /admin/data-health surfaces it and flags
-- additions to sets we already track (a re-match signal).
--
-- One row per (added_date, set_name, subset). Idempotent: the cron upserts on
-- that key so re-pulling a window doesn't duplicate.

CREATE TABLE IF NOT EXISTS ch_additions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  added_date  date NOT NULL,
  category    text NOT NULL DEFAULT '',
  set_name    text NOT NULL DEFAULT '',
  subset      text NOT NULL DEFAULT '',
  variants    text NOT NULL DEFAULT '',
  card_count  integer NOT NULL DEFAULT 0,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (added_date, set_name, subset)
);

CREATE INDEX IF NOT EXISTS idx_ch_additions_added_date ON ch_additions (added_date DESC);
CREATE INDEX IF NOT EXISTS idx_ch_additions_set_name ON ch_additions (set_name);

-- Admin-only / internal — only the service-role client touches it (gotcha #12).
REVOKE ALL ON ch_additions FROM anon, authenticated;
