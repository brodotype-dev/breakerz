-- Generic feature flags table for runtime-toggleable behavior.
-- Read by server code, written by the admin toggle UI. Keys are
-- snake_case strings; flags default to disabled when missing so a
-- missing row is the safe default.
--
-- First user: slice 2b of composition-observation plan — admin can flip
-- verdict_observation_context_enabled to splice recent /break-price
-- observations into the AI verdict narrative prompt. Defaults to false
-- so the existing verdict behavior is byte-for-byte unchanged on deploy.

create table if not exists feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Seed the first flag.
insert into feature_flags (key, enabled, description)
values (
  'verdict_observation_context_enabled',
  false,
  'When true, runBreakAnalysis splices recent /break-price observations into the AI verdict narrative prompt. See slice 2b of docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md.'
)
on conflict (key) do nothing;

alter table feature_flags enable row level security;

-- Service role only — no consumer reads, no consumer writes. Server-side
-- code uses supabaseAdmin which bypasses RLS, so this row-zero policy
-- is intentional: it locks consumers out at the DB layer in addition to
-- the API layer.

comment on table feature_flags is
  'Runtime-toggleable feature flags. Service-role only. Missing key = disabled.';
