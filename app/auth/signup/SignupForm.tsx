'use client';

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

  async function signInWithGoogle() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
  }

  async function signInWithApple() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });
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
          onClick={signInWithApple}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all"
          style={{
            backgroundColor: '#000',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <AppleIcon />
          Continue with Apple
        </button>
      </div>

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

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M14.94 13.25c-.28.63-.41.91-.77 1.47-.5.76-1.2 1.7-2.07 1.71-.77.01-1-.5-2.07-.49-1.07.01-1.31.5-2.08.49-.87-.01-1.54-.87-2.04-1.63C4.21 12.6 3.82 9.9 4.77 8.22c.66-1.17 1.85-1.85 2.97-1.85 1.1 0 1.79.51 2.7.51.89 0 1.43-.51 2.71-.51 1 0 2.07.55 2.73 1.49-2.4 1.31-2.01 4.74.06 5.39zM11.9 4.55c.55-.67.97-1.61.82-2.55-.84.06-1.82.59-2.39 1.28-.52.63-.98 1.58-.81 2.5.91.03 1.84-.51 2.38-1.23z"/>
    </svg>
  );
}
