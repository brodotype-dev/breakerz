'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { login } from './actions';

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Email and password are required.',
  invalid: 'Incorrect email or password.',
  unauthorized: 'Your account does not have admin access.',
};

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/admin';
  const errorCode = searchParams.get('error');

  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.set('from', from);
    await login(formData);
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-[oklch(0.28_0.08_250)]" />
          <div className="p-8 space-y-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground mb-1">Card Breakerz</p>
              <h1 className="text-xl font-bold">Admin</h1>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  className="w-full rounded border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Password
                </label>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {errorCode && (
                <p className="text-sm text-red-500">
                  {ERROR_MESSAGES[errorCode] ?? 'Something went wrong. Try again.'}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded bg-[oklch(0.28_0.08_250)] px-4 py-2 text-sm font-bold text-white hover:bg-[oklch(0.22_0.08_250)] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
