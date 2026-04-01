-- Auth: profiles + user_roles
-- Extends Supabase Auth users with a profile row and role assignments.
-- Roles: 'admin' | 'contributor'

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'contributor')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "profiles: self read"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can read their own roles
CREATE POLICY "user_roles: self read"
  ON user_roles FOR SELECT
  USING (auth.uid() = user_id);
