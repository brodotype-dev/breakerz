import { createClient } from './supabase-server';
import { supabaseAdmin } from './supabase';
import { redirect } from 'next/navigation';

export type UserRole = 'admin' | 'contributor';

/**
 * Returns the current authenticated user, or null if not signed in.
 * Safe to call from server components and API routes.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
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
 */
export async function requireRole(...roles: UserRole[]) {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');

  const userRoles = await getUserRoles(user.id);
  const hasRole = roles.some(r => userRoles.includes(r));

  if (!hasRole) redirect('/admin/login');

  return { user, roles: userRoles };
}
