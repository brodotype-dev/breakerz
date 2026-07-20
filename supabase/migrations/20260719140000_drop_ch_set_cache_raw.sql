-- Disk IO reduction (2026-07-19). The `raw` JSONB column on ch_set_cache
-- persisted the full untransformed CardHedger card payload. It was written on
-- every nightly catalog refresh (lib/cardhedger-catalog.ts) but read NOWHERE —
-- loadCatalogIndex, lib/ch-coverage.ts, and the admin product page all select
-- specific columns, never `raw`. It accounted for roughly half of the table's
-- 259 MB and was pure write-IO churn during the nightly delete-reinsert.
--
-- ORDER OF OPERATIONS: the app code that stops writing `raw` must be deployed
-- BEFORE this runs — otherwise the live catalog cron's insert references a
-- dropped column and fails. Applied manually via Supabase MCP after the deploy
-- carrying the lib/cardhedger-catalog.ts change went READY.
--
-- The 259 MB isn't reclaimed instantly: DROP COLUMN is a metadata op. Each set's
-- rows shrink as they get delete-reinserted (without `raw`) on subsequent
-- nightly catalog refreshes, so the table trends smaller over the next day or
-- two of normal cron churn. No VACUUM FULL (would lock the table) needed.

ALTER TABLE public.ch_set_cache DROP COLUMN IF EXISTS raw;
