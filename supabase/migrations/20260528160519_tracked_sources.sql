-- tracked_sources — Slice 4 of the web-sourced-intel plan (Shape 2).
--
-- Open-ended URL ingestion. An allowlisted SME runs `/url-source` in Discord
-- with a URL + cadence + stop_after; we store the source here and (Slice 4b)
-- a nightly cron re-scrapes active rows on schedule, staging pending_insights
-- proposals each time. The first scrape happens immediately at command time
-- (Slice 4a) via the interaction reply.
--
-- "tracked_sources" / "tracked_source_scrape" is the internal naming (the
-- behavior is tracking); the user-facing verb is /url-source.
--
-- Admin-only / internal (CLAUDE.md gotcha #12): only supabaseAdmin touches
-- it. REVOKE from anon/authenticated.

create table if not exists tracked_sources (
  id              uuid primary key default gen_random_uuid(),
  url             text not null,
  -- one_off | daily | weekly | twice_monthly
  cadence         text not null,
  -- player | product | global — optional hint for the parser; defaults global
  scope           text,
  -- optional contributor note threaded into the parse as context
  note            text,
  -- null = no stop (run until manually marked done); else cron flips
  -- status='done' once now() passes this.
  stop_at         timestamptz,
  -- active | done
  status          text not null default 'active',
  -- discord user id of the submitter
  submitted_by    text not null,
  last_scraped_at timestamptz,
  -- when the cron should next fire; null for one_off / done rows
  next_scrape_at  timestamptz,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- Cron selects active rows whose next_scrape_at is due.
create index if not exists tracked_sources_due_idx
  on tracked_sources (status, next_scrape_at);

alter table tracked_sources enable row level security;
revoke all on table tracked_sources from anon, authenticated;

comment on table tracked_sources is
  'Open-ended URL sources submitted via Discord /url-source. Nightly cron re-scrapes active rows on cadence into pending_insights. Service-role only. See web-sourced-intel Slice 4.';
