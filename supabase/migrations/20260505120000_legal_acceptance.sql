-- Legal acceptance tracking on profiles.
-- Each user must accept the Privacy Policy and Terms & Conditions at signup.
-- Versions are tracked separately because the two docs may be revised on
-- different cadences; comparing the stored version against the current
-- LEGAL constants in lib/legal.ts lets us prompt for re-acceptance after
-- a material update without losing the original acceptance audit trail.
--
-- Existing profiles created before this migration are grandfathered with
-- their original created_at and a 'pre-2026-05-05' version sentinel so the
-- profile UI doesn't surface a "not accepted" state for users who were
-- already in the beta when this rolled out. Going forward, both fields
-- are populated by the auth callback when a new user finishes signup.

ALTER TABLE profiles
  ADD COLUMN terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN terms_version TEXT,
  ADD COLUMN privacy_accepted_at TIMESTAMPTZ,
  ADD COLUMN privacy_version TEXT;

UPDATE profiles
SET
  terms_accepted_at   = created_at,
  terms_version       = 'pre-2026-05-05',
  privacy_accepted_at = created_at,
  privacy_version     = 'pre-2026-05-05'
WHERE terms_accepted_at IS NULL;
