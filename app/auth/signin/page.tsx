// Consumer sign-in. Returning users hit this when they already have an
// account (OAuth or email signup), so there's no invite-code gate and no
// legal-acceptance checkbox (already captured at signup). Three providers:
// Google, Discord, email magic link. A NEW but APPROVED invitee who starts
// here (no invite_code in the URL) is still let in: /auth/callback grants
// access by matching their OAuth-verified email to an approved waitlist row.
// Only a genuinely un-approved email is bounced to /waitlist. (This email
// fallback was added 2026-08-27 — before it, code-less flows bounced approved
// users too.)
//
// Admin sign-in is intentionally kept separate at /admin/login (different
// mechanism — email+password, not advertised on the marketing surface).

import SigninForm from './SigninForm';

export const metadata = {
  title: 'Sign in — BreakIQ',
  description: 'Sign in to BreakIQ.',
};

// Reads ?error= so a failed sign-in the callback bounces here (expired magic
// link, OAuth started from this page) shows a REASON instead of a blank form.
// Same server-side searchParams pattern as /auth/signup — no Suspense needed.
export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--terminal-bg)' }}
    >
      <SigninForm initialError={error ?? null} />
    </div>
  );
}
