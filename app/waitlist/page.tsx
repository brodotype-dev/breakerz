'use client';

import { useState } from 'react';
import Link from 'next/link';

type State = 'idle' | 'loading' | 'success' | 'already' | 'error';

export default function WaitlistPage() {
  const [state, setState] = useState<State>('idle');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('loading');

    const formData = new FormData(e.currentTarget);
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        full_name: formData.get('full_name') || null,
        use_case: formData.get('use_case') || null,
      }),
    });

    if (res.ok) {
      setState('success');
    } else if (res.status === 409) {
      setState('already');
    } else {
      setState('error');
    }
  }

  if (state === 'success' || state === 'already') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div
            className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-2"
            style={{ backgroundColor: 'rgba(59,130,246,0.15)' }}
          >
            <span className="text-2xl">{state === 'already' ? '👋' : '✓'}</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {state === 'already' ? "You're already on the list" : "You're on the list"}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {state === 'already'
              ? "We already have your email. We'll reach out when your spot is ready."
              : "We'll email you when your invite is ready. We're reviewing requests manually, so it may take a few days."}
          </p>
          <Link href="/" className="text-sm" style={{ color: 'var(--accent-blue)' }}>
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="h-1" style={{ background: 'var(--gradient-blue)' }} />
          <div className="p-8 space-y-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--accent-blue)' }}>
                BreakIQ
              </p>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Request beta access
              </h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                We're in private beta. Drop your email and we'll reach out when your spot is ready.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Name
                </label>
                <input
                  name="full_name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Email <span style={{ color: 'var(--signal-watch)' }}>*</span>
                </label>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  What are you breaking?
                </label>
                <textarea
                  name="use_case"
                  rows={2}
                  placeholder="e.g. Bowman Draft, Prizm Basketball, running breaks on YouTube..."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                />
              </div>

              {state === 'error' && (
                <p className="text-sm text-red-500">Something went wrong. Try again.</p>
              )}

              <button
                type="submit"
                disabled={state === 'loading'}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white transition-all disabled:opacity-50"
                style={{ background: 'var(--gradient-blue)' }}
              >
                {state === 'loading' ? 'Submitting…' : 'Request access →'}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-disabled)' }}>
          Already have an invite?{' '}
          <Link href="/auth/signup" style={{ color: 'var(--accent-blue)' }}>
            Create your account →
          </Link>
        </p>
      </div>
    </div>
  );
}
