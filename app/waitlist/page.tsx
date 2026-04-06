'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Zap, TrendingUp, Search, ChevronRight } from 'lucide-react';

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
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <div className="w-full max-w-sm text-center space-y-4">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-2"
            style={{ backgroundColor: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <span className="text-2xl">{state === 'already' ? '👋' : '✓'}</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {state === 'already' ? "You're already on the list" : "You're on the list"}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {state === 'already'
              ? "We already have your email. We'll send you next steps when your private beta spot is ready."
              : "We'll email you with next steps when your private beta spot is ready."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>

      {/* Hero */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'var(--gradient-hero)', borderBottom: '1px solid var(--terminal-border)' }}
      >
        {/* Background glow effects */}
        <div className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 w-96 h-96 blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--badge-icon) 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-4 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }} />

        <div className="relative px-6 py-16 md:py-24 max-w-3xl mx-auto text-center">
          {/* Brand */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <span
              className="text-4xl md:text-5xl font-bold"
              style={{
                background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-blue) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              BreakIQ
            </span>
          </div>

          <div
            className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-6"
            style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            Private Beta
          </div>

          <h1 className="text-3xl md:text-4xl font-bold mb-4 leading-tight" style={{ color: 'var(--text-primary)' }}>
            The intelligence layer for sports card breaks
          </h1>
          <p className="text-lg md:text-xl max-w-xl mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Real-time slot pricing, AI-powered deal analysis, and market signals — built for breakers and serious collectors.
          </p>
        </div>
      </div>

      {/* Feature highlights */}
      <div className="px-6 py-12 max-w-3xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {[
            {
              icon: Zap,
              color: 'var(--accent-blue)',
              gradient: 'var(--gradient-blue)',
              title: 'BreakIQ Sayz',
              body: 'Enter any break price and get instant BUY / WATCH / PASS signals with analyst-grade narratives.',
            },
            {
              icon: TrendingUp,
              color: 'var(--signal-buy)',
              gradient: 'var(--gradient-green)',
              title: 'Live Slot Pricing',
              body: 'Odds-weighted EV per player, adjusted for buzz and market signals. See exactly what a slot is worth.',
            },
            {
              icon: Search,
              color: 'var(--accent-orange)',
              gradient: 'var(--gradient-orange)',
              title: 'Slab Analysis',
              body: 'Upload a cert image and get instant market value, comp sales, and deal signals for graded cards.',
            },
          ].map(({ icon: Icon, color, gradient, title, body }) => (
            <div
              key={title}
              className="rounded-xl p-5 space-y-3"
              style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: gradient }}
              >
                <Icon className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
            </div>
          ))}
        </div>

        {/* Waitlist form */}
        <div className="max-w-sm mx-auto">
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
          >
            <div className="h-1" style={{ background: 'var(--gradient-blue)' }} />
            <div className="p-8 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Request beta access
                </h2>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
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
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 hover:opacity-90"
                  style={{ background: 'var(--gradient-blue)' }}
                >
                  {state === 'loading' ? 'Submitting…' : (
                    <>Request access <ChevronRight className="w-4 h-4" /></>
                  )}
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

          <p className="text-center text-xs mt-3" style={{ color: 'var(--text-disabled)' }}>
            <Link href="/admin/login" style={{ color: 'var(--text-disabled)' }}>
              Admin login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
