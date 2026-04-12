-- Onboarding wizard fields on profiles
ALTER TABLE profiles
  ADD COLUMN experience_level TEXT CHECK (experience_level IN (
    'beginner', 'casual', 'regular', 'serious'
  )),
  ADD COLUMN collecting_eras TEXT[],
  ADD COLUMN monthly_spend TEXT CHECK (monthly_spend IN (
    'under_150', '150_500', '500_1000', '1000_5000', '5000_plus'
  )),
  ADD COLUMN primary_platform TEXT CHECK (primary_platform IN (
    'fanatics_live', 'whatnot', 'ebay',
    'dave_adams', 'layton_sports', 'local_card_shop', 'other'
  )),
  ADD COLUMN referral_source TEXT CHECK (referral_source IN (
    'word_of_mouth', 'youtube', 'social_media', 'google',
    'reddit', 'referral', 'other'
  )),
  ADD COLUMN best_pull TEXT,
  ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
