'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get('from') || '/admin/products';

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = from;
    } else {
      setError('Incorrect password.');
      setLoading(false);
    }
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
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                  className="w-full rounded border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={loading || !password}
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
