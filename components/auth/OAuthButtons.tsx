'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Shared Google + Discord OAuth buttons used by both /auth/signup and
 * /auth/signin so the providers, redirect contract, and visual treatment
 * can't drift between the two pages. Each click invokes
 * supabase.auth.signInWithOAuth; the caller hands us the redirect URL
 * (which encodes invite_code + legal-acceptance versions on signup, and
 * is plain `/auth/callback` on signin).
 *
 * `onBeforeRedirect` lets the signup page gate clicks behind its legal-
 * acceptance checkbox — return false to abort. Signin has no gate.
 */
// `getRedirectTo` is intentionally a function, not a string: the redirect
// URL has to read `window.location.origin`, which doesn't exist during
// Next's static prerender of the auth pages. Evaluating it lazily inside
// the click handler keeps the component prerender-safe. Earlier shape
// (`redirectTo: string`) crashed the /auth/signin build with
// `ReferenceError: window is not defined`.
export function OAuthButtons({
  getRedirectTo,
  disabled = false,
  onBeforeRedirect,
}: {
  getRedirectTo: () => string;
  disabled?: boolean;
  onBeforeRedirect?: () => boolean;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  async function signInWith(provider: 'google' | 'discord') {
    if (onBeforeRedirect && !onBeforeRedirect()) return;
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: getRedirectTo() },
    });
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => signInWith('google')}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
        onClick={() => signInWith('discord')}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
