// Consumer sign-in. Returning users hit this when they already have an
// account (OAuth or email signup), so there's no invite-code gate and no
// legal-acceptance checkbox (already captured at signup). Three providers:
// Google, Discord, email magic link. New users get bounced here if they
// somehow start the OAuth flow without a profile — /auth/callback redirects
// them to /waitlist?error=missing_invite, which is correct.
//
// Admin sign-in is intentionally kept separate at /admin/login (different
// mechanism — email+password, not advertised on the marketing surface).

import SigninForm from './SigninForm';

export const metadata = {
  title: 'Sign in — BreakIQ',
  description: 'Sign in to BreakIQ.',
};

export default function SigninPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--terminal-bg)' }}
    >
      <SigninForm />
    </div>
  );
}
