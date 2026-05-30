'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Zap, TrendingUp, Search, ChevronRight } from 'lucide-react';
import posthog from 'posthog-js';
import { PH_EVENTS } from '@/lib/posthog-events';
import { Logo } from '@/components/Logo';
import { DiscordIcon } from '@/components/icons/DiscordIcon';
import { DISCORD_INVITE_URL, isDiscordInviteConfigured } from '@/lib/community';

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
      posthog.capture(PH_EVENTS.waitlist_signup_submitted, {
        has_name: !!formData.get('full_name'),
        has_use_case: !!formData.get('use_case'),
        result: 'success',
      });
      setState('success');
    } else if (res.status === 409) {
      posthog.capture(PH_EVENTS.waitlist_signup_submitted, { result: 'already_exists' });
      setState('already');
    } else {
      posthog.capture(PH_EVENTS.waitlist_signup_submitted, { result: 'error' });
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
          {isDiscordInviteConfigured() && (
            <div className="pt-2">
              <a
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors hover:bg-[var(--terminal-surface-hover)]"
                style={{
                  border: '1px solid var(--terminal-border)',
                  color: 'var(--text-primary)',
                  backgroundColor: 'var(--terminal-surface)',
                }}
              >
                <DiscordIcon className="text-[#5865F2]" size={16} />
                Join our Discord while you wait
              </a>
              <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Chat with other beta hopefuls + see what we&apos;re building.
              </p>
            </div>
          )}
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

      {/* Hero: two-column layout (vertically centered) */}
      <div className="relative min-h-screen flex items-center px-6 pt-16 pb-12 max-w-6xl mx-auto">
        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left — brand + value prop + features */}
          <div className="space-y-8">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Logo variant="lockup" height={40} width={200} className="h-10 w-auto" priority />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)', border: '1px solid rgba(59,130,246,0.3)' }}
                >
                  Private Beta
                </span>
              </div>

              <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4" style={{ color: 'var(--text-primary)' }}>
                Stop buying breaks blind.
              </h1>
              <p className="text-base md:text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Every break you buy, in one place — research it, log it, learn from it.
              </p>
            </div>

            {/* Feature list */}
            <div className="space-y-3">
              {([
                {
                  icon: Zap,
                  gradient: 'var(--gradient-blue)',
                  title: 'BreakIQ Insights',
                  body: 'Research any break before you buy in. Our take + comps + risk flags — you make the call.',
                },
                {
                  icon: TrendingUp,
                  gradient: 'var(--gradient-green)',
                  title: 'Live Slot Pricing',
                  body: 'Odds-weighted EV per player, adjusted for buzz and market signals.',
                },
                {
                  icon: 'slab',
                  gradient: 'var(--gradient-orange)',
                  title: 'Slab Analysis',
                  body: 'Upload a cert image and get instant market value and comp sales for graded cards.',
                },
              ] as Array<{ icon: React.ElementType | 'slab'; gradient: string; title: string; body: string }>).map(({ icon, gradient, title, body }) => (
                <div key={title} className="flex items-start gap-4">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: gradient }}
                  >
                    {icon === 'slab' ? (
                      <Logo variant="slab" height={28} width={22} className="h-7 w-auto -my-2" />
                    ) : (
                      (() => {
                        const Icon = icon;
                        return <Icon className="w-4 h-4 text-white" />;
                      })()
                    )}
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
              Already have an account?{' '}
              <Link href="/auth/signin" style={{ color: 'var(--accent-blue)' }}>
                Sign in →
              </Link>
            </p>

            <p className="text-center text-[11px] mt-4 px-4" style={{ color: 'var(--text-disabled)' }}>
              By requesting access you agree to our{' '}
              <Link href="/terms" style={{ color: 'var(--text-secondary)' }}>Terms</Link>
              {' '}and{' '}
              <Link href="/privacy" style={{ color: 'var(--text-secondary)' }}>Privacy Policy</Link>.
            </p>

            <p className="text-center text-xs mt-3" style={{ color: 'var(--text-disabled)' }}>
              <Link href="/admin/login" style={{ color: 'var(--text-disabled)' }}>
                Admin login
              </Link>
            </p>
          </div>

        </div>
      </div>

      {/* Pricing transparency — early adopter section (sibling of hero, full width) */}
      <div className="relative px-6 pb-20 max-w-6xl mx-auto">
        <div className="w-full">
          <div className="text-center mb-8">
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                color: 'var(--accent-purple)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
              }}
            >
              Early Adopter Pricing
            </span>
            <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Lock in beta rates for life
            </h2>
            <p className="text-sm md:text-base" style={{ color: 'var(--text-secondary)' }}>
              Join the waitlist now and your subscription rate stays the same — even after public launch.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Free trial */}
            <div
              className="rounded-xl border p-6"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Free trial
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>$0</span>
                <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>· 3 lifetime analyses</span>
              </div>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> 3 BreakIQ Insights analyses</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> 3 Slab Analysis lookups</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> All products + slot pricing</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> Unlimited break logging</li>
              </ul>
            </div>

            {/* Hobby */}
            <div
              className="relative rounded-xl border p-6"
              style={{
                borderColor: 'var(--accent-blue)',
                backgroundColor: 'var(--terminal-surface)',
                boxShadow: '0 0 0 1px var(--accent-blue), 0 8px 32px -8px rgba(59,130,246,0.3)',
              }}
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                style={{ background: 'var(--gradient-blue)', color: 'white' }}>
                Most Popular
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-blue)' }}>
                Hobby
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>$9.99</span>
                <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>/ month</span>
              </div>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> 10 BreakIQ Insights analyses / mo</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> 10 Slab Analysis lookups / mo</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> All products + slot pricing</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> Unlimited break logging</li>
              </ul>
            </div>

            {/* Pro */}
            <div
              className="rounded-xl border p-6"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent-purple)' }}>
                Pro
              </div>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>$24.99</span>
                <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>/ month</span>
              </div>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> Unlimited BreakIQ Insights</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> Unlimited Slab Analysis</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> All products + slot pricing</li>
                <li className="flex gap-2"><span style={{ color: 'var(--signal-buy)' }}>✓</span> Unlimited break logging</li>
              </ul>
            </div>
          </div>

          <p className="text-center text-xs mt-6" style={{ color: 'var(--text-tertiary)' }}>
            No credit card required to join the waitlist. You'll only pay after the trial.
          </p>
        </div>
      </div>
    </div>
  );
}
