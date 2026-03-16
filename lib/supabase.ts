import { createClient } from '@supabase/supabase-js';

// Vercel-Supabase integration may inject either NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL!;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY!;

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_ACCESS_KEY;

// Client for browser/client components (anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client for server-side operations (service role key — bypasses RLS)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey ?? supabaseAnonKey
);
