import { redirect } from 'next/navigation';
import { getCurrentUserFromSession, getUserRoles } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
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

  // Onboarding gate. Before 2026-08-31 the callback's one-time redirect was
  // the ONLY enforcement — a new user who navigated away from the wizard was
  // never asked again, so the 18+ age gate was effectively optional. Now every
  // consumer page bounces incomplete users to /onboarding, which lives in its
  // own route group (app/(onboarding)) so this can't loop. Admins/contributors
  // are exempt — they never went through consumer onboarding. Single PK read.
  if (user && !isAdmin && process.env.NODE_ENV !== 'development') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.onboarding_completed_at) redirect('/onboarding');
  }

  const showNav = !!user || process.env.NODE_ENV === 'development';

  // Rail footer (plan) + the Log count badge. One PK read and one count —
  // both cheap, and the nav renders on every consumer page anyway.
  let plan = 'free';
  let pendingCount = 0;
  if (user) {
    const [{ data: planRow }, { count }] = await Promise.all([
      supabaseAdmin.from('profiles').select('subscription_plan').eq('id', user.id).maybeSingle(),
      supabaseAdmin
        .from('user_breaks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending'),
    ]);
    plan = planRow?.subscription_plan ?? 'free';
    pendingCount = count ?? 0;
  }

  return (
    <>
      {user && <PostHogIdentify userId={user.id} email={user.email ?? null} />}
      {showNav && <ConsumerNav isAdmin={isAdmin} plan={plan} pendingCount={pendingCount} />}
      {/* Offsets for the fixed chrome: 196px rail on lg+, bottom tab bar below.
          Without these the rail overlaps content and the tab bar covers the
          last rows of every scrollable page. */}
      <div className={showNav ? 'consumer-shell lg:pl-[196px] pb-[72px] lg:pb-0' : undefined}>
        {children}
      </div>
      {showNav && <InstallPrompt />}
    </>
  );
}
