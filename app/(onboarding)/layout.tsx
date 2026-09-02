import { redirect } from 'next/navigation';
import { getCurrentUserFromSession } from '@/lib/auth';
import PostHogIdentify from '@/app/(consumer)/PostHogIdentify';

// Onboarding lives in its OWN route group (not under (consumer)) for two
// reasons:
//   1. The (consumer) layout can unconditionally redirect users with no
//      `onboarding_completed_at` to /onboarding without a redirect loop.
//   2. The wizard renders with NO ConsumerNav / InstallPrompt. Before
//      2026-08-31 it sat inside (consumer), so a brand-new user on step 1
//      could click the logo or any nav link straight to the dashboard and
//      was never asked again — the 18+ age gate was effectively optional.
// Auth-only here: middleware already gates /onboarding at the edge; this is
// belt-and-suspenders and gives PostHog the user id for the funnel events.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserFromSession();
  if (!user && process.env.NODE_ENV !== 'development') redirect('/waitlist');

  return (
    <>
      {user && <PostHogIdentify userId={user.id} email={user.email ?? null} />}
      {children}
    </>
  );
}
