'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Logo } from '@/components/Logo';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { TERMS_VERSION, PRIVACY_VERSION, TERMS_PATH, PRIVACY_PATH } from '@/lib/legal';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Build the auth callback URL with the legal-acceptance version params
 * appended. The callback parses these back out and persists them on the
 * user's profile, completing the round-trip through OAuth or email confirm
 * without needing a cookie or server-side state.
 */
function buildRedirectTo(inviteCode: string): string {
  const params = new URLSearchParams({
    invite_code: inviteCode,
    accept_terms: TERMS_VERSION,
    accept_privacy: PRIVACY_VERSION,
  });
  return `${window.location.origin}/auth/callback?${params.toString()}`;
}

export default function SignupForm({
  inviteCode,
  firstName,
}: {
  inviteCode: string;
  firstName: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const [showAcceptError, setShowAcceptError] = useState(false);

  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  function guardAccepted(): boolean {
    if (accepted) return true;
    setShowAcceptError(true);
    return false;
  }

  async function signUpWithEmail() {
    if (!email || !password) return;
    if (!guardAccepted()) return;
    setEmailLoading(true);
    setEmailError(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: buildRedirectTo(inviteCode) },
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
          Hey {firstName}, you're in.
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Create your account. Takes 10 seconds — your break record starts today.
        </p>
      </div>

      {emailSent ? (
        <div
          className="rounded-lg p-4 text-center"
          style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--signal-buy)' }}>
            Check your email
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            We sent a confirmation link to {email}. Click it to finish signing up.
          </p>
        </div>
      ) : (
        <>
          {/* Legal acceptance — gates every signup path below */}
          <label
            htmlFor="legal-accept"
            className="flex items-start gap-2.5 cursor-pointer select-none"
          >
            <input
              id="legal-accept"
              type="checkbox"
              checked={accepted}
              onChange={e => {
                setAccepted(e.target.checked);
                if (e.target.checked) setShowAcceptError(false);
              }}
              className="mt-0.5 h-4 w-4 cursor-pointer"
              style={{ accentColor: 'var(--accent-blue)' }}
            />
            <span className="text-xs leading-snug" style={{ color: 'var(--text-secondary)' }}>
              I&apos;m 18 or older and I agree to the{' '}
              <a
                href={TERMS_PATH}
                target="_blank"
                rel="noopener"
                className="underline"
                style={{ color: 'var(--accent-blue)' }}
              >
                Terms &amp; Conditions
              </a>
              {' '}and{' '}
              <a
                href={PRIVACY_PATH}
                target="_blank"
                rel="noopener"
                className="underline"
                style={{ color: 'var(--accent-blue)' }}
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {showAcceptError && !accepted && (
            <p className="text-xs -mt-3" style={{ color: 'var(--signal-pass)' }}>
              You need to accept the Terms and Privacy Policy to continue.
            </p>
          )}

          {/* Buttons stay ENABLED; guardAccepted() surfaces "accept the Terms"
              on click. Before 2026-08-31 they were disabled={!accepted}, so
              the click never fired, guardAccepted never ran, and the error
              message below was unreachable — four greyed-out buttons with no
              explanation (funnel audit #5). */}
          <OAuthButtons
            getRedirectTo={() => buildRedirectTo(inviteCode)}
            onBeforeRedirect={guardAccepted}
          />

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
            <span className="text-xs" style={{ color: 'var(--text-disabled)' }}>or</span>
            <div className="flex-1 border-t" style={{ borderColor: 'var(--terminal-border)' }} />
          </div>

          {!showEmail ? (
            <button
              onClick={() => setShowEmail(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: 'var(--terminal-surface)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--terminal-border)',
              }}
            >
              Sign up with email
            </button>
          ) : (
            <div className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
              <input
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') signUpWithEmail(); }}
                className="w-full rounded-lg border px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
              />
              {emailError && (
                <p className="text-xs" style={{ color: 'var(--signal-pass)' }}>{emailError}</p>
              )}
              <button
                onClick={signUpWithEmail}
                disabled={emailLoading || !email || password.length < 6}
                className="w-full px-4 py-3 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--gradient-blue)' }}
              >
                {emailLoading ? 'Creating account…' : 'Create account'}
              </button>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-center" style={{ color: 'var(--text-disabled)' }}>
        Your invite code is pre-validated.
      </p>
    </div>
  );
}

