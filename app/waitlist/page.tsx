'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Zap, TrendingUp, Search, ChevronRight } from 'lucide-react';
import posthog from 'posthog-js';

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
      posthog.capture('waitlist_signup_submitted', {
        has_name: !!formData.get('full_name'),
        has_use_case: !!formData.get('use_case'),
        result: 'success',
      });
      setState('success');
    } else if (res.status === 409) {
      posthog.capture('waitlist_signup_submitted', { result: 'already_exists' });
      setState('already');
    } else {
      posthog.capture('waitlist_signup_submitted', { result: 'error' });
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
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ backgroundColor: 'var(--terminal-bg)', background: 'var(--gradient-hero)' }}
    >
      {/* Background effects */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] blur-3xl opacity-10 pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }} />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] blur-3xl opacity-10 pointer-events-none"
        style={{ background: 'radial-gradient(circle, var(--badge-icon) 0%, transparent 70%)' }} />
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }} />

      {/* Two-column layout */}
      <div className="relative min-h-screen flex items-center px-6 py-16 max-w-6xl mx-auto">
        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left — brand + value prop + features */}
          <div className="space-y-8">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
                >
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>BreakIQ</span>
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', border: '1px solid rgba(59,130,246,0.3)' }}
                >
                  Private Beta
                </span>
              </div>

              <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4" style={{ color: 'var(--text-primary)' }}>
                The intelligence layer for sports card breaks
              </h1>
              <p className="text-base md:text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Real-time slot pricing, AI-powered deal analysis, and market signals — built for breakers and serious collectors.
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {[
                {
                  icon: Zap,
                  gradient: 'var(--gradient-blue)',
                  title: 'BreakIQ Sayz',
                  body: 'Enter any break price and get instant BUY / WATCH / PASS signals with analyst-grade narratives.',
                },
                {
                  icon: TrendingUp,
                  gradient: 'var(--gradient-green)',
                  title: 'Live Slot Pricing',
                  body: 'Odds-weighted EV per player, adjusted for buzz and market signals.',
                },
                {
                  icon: Search,
                  gradient: 'var(--gradient-orange)',
                  title: 'Slab Analysis',
                  body: 'Upload a cert image and get instant market value and comp sales for graded cards.',
                },
              ].map(({ icon: Icon, gradient, title, body }) => (
                <div key={title} className="flex items-start gap-4">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: gradient }}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{title}</p>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — waitlist form */}
          <div>
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
                    We're reviewing requests manually. Drop your email and we'll reach out when your spot is ready.
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
    </div>
  );
}
