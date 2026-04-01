import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL!;

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY!;

/**
 * Cookie-aware Supabase client for server components, server actions,
 * and API routes. Uses the anon key + RLS (not the service role key).
 *
 * Use `supabaseAdmin` from `lib/supabase.ts` when you need to bypass RLS
 * for admin operations.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll called from a Server Component — cookies cannot be set here.
          // Middleware handles session refresh so this is safe to ignore.
        }
      },
    },
  });
}
