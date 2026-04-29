-- Records every cron orchestrator invocation so admin dashboard can surface
-- "last successful run" without inferring from pricing_cache writes (which
-- are polluted by manual admin button clicks). Each row is one orchestrator
-- run; cron_path identifies which cron (e.g. "/api/cron/refresh-pricing").
--
-- success=true when errors=0. processed=0 still counts as success when
-- there was simply nothing to do (all products fresh).
--
-- Index on (cron_path, started_at desc) so the dashboard's
-- "latest row per path" query is a single seek per cron.
CREATE TABLE cron_run_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_path     TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INTEGER,
  processed     INTEGER NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX cron_run_log_path_started_idx
  ON cron_run_log (cron_path, started_at DESC);

-- Admin-only access; consumers don't need this surface.
ALTER TABLE cron_run_log ENABLE ROW LEVEL SECURITY;
