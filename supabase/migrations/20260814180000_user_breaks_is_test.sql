-- Test/real break flag (2026-08-14). Most logged breaks so far are test entries
-- with placeholder numbers; this flags them so they're excluded from Market
-- Delta and any analytics that treat a logged break as a real observed ask.
-- Default false = real; the My Breaks form toggle sets it true for test breaks.
-- Additive + NOT NULL DEFAULT false, so existing rows read as real. Inherits
-- user_breaks grants + owner RLS (no new grant needed). Applied via Supabase MCP.
alter table public.user_breaks add column if not exists is_test boolean not null default false;