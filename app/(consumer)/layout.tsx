import { redirect } from 'next/navigation';
import { getCurrentUserFromSession, getUserRoles } from '@/lib/auth';
import ConsumerNav from './ConsumerNav';
import InstallPrompt from './InstallPrompt';
import PostHogIdentify from './PostHogIdentify';

export default async function ConsumerLayout({ children }: { children: React.ReactNode }) {
  // Cookie-only session read — no network round-trip to Supabase Auth.
  // Middleware already rejected unauth users at the edge, so this layout
  // doesn't need to re-verify against the server; we just need user.id
  // for getUserRoles() + PostHogIdentify. See lib/auth.ts for the
  // security rationale (signed JWT cookie can't be forged client-side,
  // and any sensitive operations downstream call getUser() to verify).
  const user = await getCurrentUserFromSession();
  if (!user && process.env.NODE_ENV !== 'development') redirect('/waitlist');

  const roles = user ? await getUserRoles(user.id) : [];
  const isAdmin = roles.some(r => r === 'admin' || r === 'contributor');

  const showNav = !!user || process.env.NODE_ENV === 'development';

  return (
    <>
      {user && <PostHogIdentify userId={user.id} email={user.email ?? null} />}
      {showNav && <ConsumerNav isAdmin={isAdmin} />}
      {children}
      {showNav && <InstallPrompt />}
    </>
  );
}
