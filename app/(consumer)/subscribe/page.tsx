'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Zap, Check, Crown } from 'lucide-react';

export default function SubscribePage() {
  const router = useRouter();
  const [loading, setLoading] = useState<'hobby' | 'pro' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);

  // Check if already subscribed
  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(d => {
      const p = d.profile?.subscription_plan;
      if (p && p !== 'free') {
        router.replace('/');
      } else {
        setPlan(p ?? 'free');
      }
    }).catch(() => setPlan('free'));
  }, [router]);

  async function handleSubscribe(selectedPlan: 'hobby' | 'pro') {
    setLoading(selectedPlan);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(null);
    }
  }

  if (plan === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>BreakIQ</span>
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Choose Your Plan
          </h1>
          <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
            Start with 3 free analyses. Upgrade when you're ready.
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
            Beta pricing — locks in for early adopters.
          </p>
        </div>

        {error && (
          <div className="rounded-lg p-3 mb-6 text-center text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--signal-pass)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Hobby */}
          <div
            className="rounded-xl p-6 flex flex-col"
            style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--gradient-blue)' }}>
                <Zap className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Hobby</h2>
            </div>

            <div className="mb-4">
              <span className="text-3xl font-black font-mono" style={{ color: 'var(--text-primary)' }}>$9.99</span>
              <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>/mo</span>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1">
              {[
                '10 BreakIQ Sayz analyses/mo',
                '10 Slab Analysis lookups/mo',
                'Unlimited My Breaks logging',
                'All products & slot pricing',
                'AI-powered deal signals',
              ].map(f => (
                <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--signal-buy)' }} />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe('hobby')}
              disabled={loading !== null}
              className="w-full py-3 rounded-lg text-sm font-bold transition-all hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
            >
              {loading === 'hobby' ? 'Redirecting to checkout…' : 'Get Hobby'}
            </button>
          </div>

          {/* Pro */}
          <div
            className="rounded-xl p-6 flex flex-col relative"
            style={{ border: '2px solid var(--accent-blue)', backgroundColor: 'var(--terminal-surface)', boxShadow: '0 0 30px rgba(59,130,246,0.1)' }}
          >
            <div
              className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
            >
              Most Popular
            </div>

            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}>
                <Crown className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Pro</h2>
            </div>

            <div className="mb-4">
              <span className="text-3xl font-black font-mono" style={{ color: 'var(--text-primary)' }}>$24.99</span>
              <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>/mo</span>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1">
              {[
                'Unlimited BreakIQ Sayz analyses',
                'Unlimited Slab Analysis lookups',
                'Unlimited My Breaks logging',
                'All products & slot pricing',
                'AI-powered deal signals',
                'Priority support',
              ].map(f => (
                <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--signal-buy)' }} />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSubscribe('pro')}
              disabled={loading !== null}
              className="w-full py-3 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              {loading === 'pro' ? 'Redirecting to checkout…' : 'Get Pro'}
            </button>
          </div>
        </div>

        {/* Free trial note */}
        <div className="text-center mt-8">
          <button
            onClick={() => router.push('/')}
            className="text-sm font-medium hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Continue with free trial (3 analyses) →
          </button>
        </div>
      </div>
    </div>
  );
}
