-- Subscription and usage tracking on profiles
ALTER TABLE profiles
  ADD COLUMN stripe_customer_id TEXT UNIQUE,
  ADD COLUMN stripe_subscription_id TEXT,
  ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_plan IN ('free', 'hobby', 'pro')),
  ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'trialing')),
  ADD COLUMN current_period_end TIMESTAMPTZ,
  ADD COLUMN analyses_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN analyses_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
