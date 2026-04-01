-- Waitlist: tracks beta signup requests and invite flow
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  use_case TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'converted')),
  invite_code TEXT UNIQUE,
  invite_sent_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_waitlist_status ON waitlist(status, created_at DESC);
CREATE INDEX idx_waitlist_invite_code ON waitlist(invite_code) WHERE invite_code IS NOT NULL;
