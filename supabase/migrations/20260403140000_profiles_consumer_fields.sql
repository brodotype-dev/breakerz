-- Consumer profile fields
-- Adds identity + hobby preference columns to profiles.
-- is_over_18: derived client-side from DOB input, actual DOB never stored.
-- Array columns store free-text user input for AI analysis.

ALTER TABLE profiles
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT,
  ADD COLUMN is_over_18 BOOLEAN,
  ADD COLUMN favorite_sports TEXT[],
  ADD COLUMN chasing_teams TEXT[],
  ADD COLUMN chasing_players TEXT[];

-- Users can update their own profile row
CREATE POLICY "profiles: self update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
