import { createClient } from './supabase-server';
import { supabaseAdmin } from './supabase';
import { redirect } from 'next/navigation';

export type UserRole = 'admin' | 'contributor';

/**
 * Returns the current authenticated user, or null if not signed in.
 *
 * Calls `supabase.auth.getUser()` which makes a NETWORK round-trip to
 * Supabase Auth to verify the user against the database. Use this from
 * **API routes that mutate data** or **server actions that change state**,
 * where you need a fresh server-verified user.
 *
 * For **layouts / server components that just need to know "who is
 * looking at this page?"** (e.g. for analytics identify, role lookup,
 * conditional rendering), use {@link getCurrentUserFromSession} instead —
 * it reads from the signed JWT cookie and skips the network call.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Fast-path variant of {@link getCurrentUser} — reads the user from the
 * signed session JWT in the cookie without a network round-trip to
 * Supabase Auth.
 *
 * Use this on hot paths (consumer layouts, frequently-rendered server
 * components) where the user identity is needed for non-security work
 * — analytics identify, role lookup, conditional UI. The session cookie
 * is signed by Supabase, so a client can't forge a session to gain
 * access; the worst case from a tampered cookie is "user sees UI for
 * ~1s before the next API call rejects them," and the API routes still
 * call `getUser()` to verify against the server.
 *
 * Returns null if no session is present.
 *
 * @see https://supabase.com/docs/guides/auth/server-side/nextjs — the
 *   Supabase guidance is to use `getUser()` for security-sensitive
 *   checks and `getSession()` for identity-only reads. Middleware
 *   path-protection redirects fall into the latter category.
 */
export async function getCurrentUserFromSession() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

/**
 * Returns the role(s) for a given user ID, queried via service role
 * so RLS doesn't block the lookup.
 */
export async function getUserRoles(userId: string): Promise<UserRole[]> {
  const { data } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);

  return (data ?? []).map(r => r.role as UserRole);
}

/**
 * Returns the authenticated user if they have one of the required roles.
 * Returns null if not authenticated or wrong role.
 * Use in API routes where you need to return a JSON error (not redirect).
 */
export async function checkRole(...roles: UserRole[]): Promise<{ user: { id: string }; roles: UserRole[] } | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const userRoles = await getUserRoles(user.id);
  const hasRole = roles.some(r => userRoles.includes(r));
  if (!hasRole) return null;
  return { user, roles: userRoles };
}

/**
 * Asserts the current user is authenticated and has one of the required roles.
 * Redirects to /admin/login if not authenticated, or throws if wrong role.
 * Use in server components and server actions that need protection.
 *
 * Reads identity from the signed session JWT (no network round-trip to
 * Supabase Auth) — this runs on EVERY admin page render, and the network
 * `getUser()` call was adding ~100-300ms to each navigation. The cookie is
 * HMAC-signed so it can't be forged for access; this is a page-guard redirect,
 * and every mutating API route / server action still calls `getUser()` to
 * verify against the server before any state change. Same rationale as the
 * middleware path-protection (see middleware.ts).
 */
export async function requireRole(...roles: UserRole[]) {
  const user = await getCurrentUserFromSession();
  if (!user) redirect('/admin/login');

  const userRoles = await getUserRoles(user.id);
  const hasRole = roles.some(r => userRoles.includes(r));

  if (!hasRole) redirect('/admin/login');

  return { user, roles: userRoles };
}
