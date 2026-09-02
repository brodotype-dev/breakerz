'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { Logo } from '@/components/Logo';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Plain `/auth/callback` — no invite_code, no accept_terms/accept_privacy.
 * The callback skips the invite-code gate when a profile already exists
 * (the returning-user case) and leaves the existing legal-acceptance row
 * untouched, so we don't need to round-trip those params here. A brand-new
 * but APPROVED invitee who lands on signin without an invite_code is still
 * admitted — the callback falls back to matching their OAuth-verified email
 * against an approved waitlist row (added 2026-08-27). Only an un-approved
 * email is bounced to /waitlist.
 */
function buildRedirectTo(): string {
  return `${window.location.origin}/auth/callback`;
}

// Copy for a failed sign-in the callback bounced back here (2026-08-31).
// Before this, a returning user whose magic link expired was sent to
// /auth/signup and told to "try your invite link again" — they have none —
// with only "Back to waitlist" as an exit. Now they land here with a reason
// and an immediate retry path.
function signinErrorMessage(code: string): string {
  switch (code) {
    case 'session_failed':
      return "That sign-in link didn't work — it may have expired or already been used. Request a fresh one below.";
    case 'missing_code':
      return 'That link was missing its sign-in code. Request a fresh one below.';
    default:
      return 'Something went wrong signing you in. Try again below.';
  }
}

export default function SigninForm({ initialError = null }: { initialError?: string | null }) {
  const [email, setEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function sendMagicLink() {
    if (!email) return;
    setEmailLoading(true);
    setEmailError(null);
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildRedirectTo(),
        // Don't create a fresh user on sign-in via OTP — Supabase will
        // silently mint an empty account otherwise, which then trips the
        // callback's invite gate and bounces them to /waitlist with a
        // confusing error. Returning users always already exist.
        shouldCreateUser: false,
      },
    });
    if (error) {
      setEmailError(error.message);
    } else {
      setEmailSent(true);
    }
    setEmailLoading(false);
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2">
        <Logo variant="wordmark" height={20} width={96} className="h-5 w-auto" />
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Welcome back.
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Sign in to BreakIQ.
        </p>
      </div>

      {initialError && (
        <div
          role="alert"
          className="rounded-lg p-3 text-sm"
          style={{ border: '1px solid rgba(234,179,8,0.4)', backgroundColor: 'rgba(234,179,8,0.08)' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Sign-in didn&apos;t complete
          </p>
          <p style={{ color: 'var(--text-secondary)' }}>{signinErrorMessage(initialError)}</p>
        </div>
      )}

      {emailSent ? (
        <div
          className="rounded-lg p-4 text-center"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--signal-buy)' }}>
            Check your email
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            We sent a sign-in link to {email}. Click it to finish signing in.
          </p>
        </div>
      ) : (
        <>
          <OAuthButtons getRedirectTo={buildRedirectTo} />

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>or</span>
            <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
          </div>

          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendMagicLink(); }}
              className="w-full rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              style={{
                borderColor: 'var(--terminal-border)',
                backgroundColor: 'var(--terminal-bg)',
                color: 'var(--text-primary)',
              }}
            />
            {emailError && (
              <p className="text-xs" style={{ color: 'var(--signal-pass)' }}>{emailError}</p>
            )}
            <button
              onClick={sendMagicLink}
              disabled={emailLoading || !email}
              className="w-full px-4 py-3 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-blue)' }}
            >
              {emailLoading ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </div>
        </>
      )}

      <p className="text-xs text-center" style={{ color: 'var(--text-disabled)' }}>
        Don&apos;t have an account?{' '}
        <Link href="/waitlist" style={{ color: 'var(--accent-blue)' }}>
          Join the waitlist →
        </Link>
      </p>
    </div>
  );
}
