'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export default function SignupForm({
  inviteCode,
  firstName,
}: {
  inviteCode: string;
  firstName: string;
}) {
  const redirectTo = `${window.location.origin}/auth/callback?invite_code=${inviteCode}`;

  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  async function signInWithGoogle() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  async function signInWithDiscord() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo },
    });
  }

  async function signUpWithEmail() {
    if (!email || !password) return;
    setEmailLoading(true);
    setEmailError(null);
    const supabase = getSupabase();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
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
      <div className="space-y-1">
        <p
          className="text-xs font-black uppercase tracking-[0.15em]"
          style={{ color: 'var(--accent-blue)' }}
        >
          BreakIQ
        </p>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Hey {firstName}, you're in.
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Create your account to access the beta. Takes 10 seconds.
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
          <div className="space-y-3">
            <button
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: '#fff',
                color: '#111',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <button
              onClick={signInWithDiscord}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: '#5865F2',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <DiscordIcon />
              Continue with Discord
            </button>
          </div>

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
                className="w-full px-4 py-3 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--gradient-blue)' }}
              >
                {emailLoading ? 'Creating account…' : 'Create account'}
              </button>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-center" style={{ color: 'var(--text-disabled)' }}>
        By signing up you agree to our terms. Your invite code is pre-validated.
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}
