import { createClient } from '@supabase/supabase-js';

// Vercel-Supabase integration may inject either NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.
// We fall back to empty strings during build-time static page collection so that module
// evaluation doesn't throw. Actual API calls will only run at request time when the real
// env vars are present.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  '';

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  '';

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SECRET_ACCESS_KEY ??
  supabaseAnonKey;

// Client for browser/client components (anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client for server-side operations (service role key — bypasses RLS)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey || supabaseAnonKey
);
