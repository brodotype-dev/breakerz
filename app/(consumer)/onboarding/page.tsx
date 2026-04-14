'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ShieldCheck, XCircle } from 'lucide-react';
import posthog from 'posthog-js';

type Step = 1 | 2 | 3;

const COLLECTING_OPTIONS = [
  'Baseball', 'Basketball', 'Football', 'Hockey', 'Soccer',
  'Pokemon', 'Magic: The Gathering', 'Other TCG',
];

const ERA_OPTIONS: { value: string; label: string }[] = [
  { value: 'modern', label: 'Modern (2020+)' },
  { value: '2010s', label: '2010s' },
  { value: '2000s', label: '2000s' },
  { value: '90s', label: '90s' },
  { value: '80s_earlier', label: '80s & Earlier' },
];

const EXPERIENCE_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'beginner', label: 'Just Getting Started', desc: 'New to collecting or breaks' },
  { value: 'casual', label: 'Casual Collector', desc: 'Buy a few packs/breaks a month' },
  { value: 'regular', label: 'Regular Breaker', desc: 'Break multiple times per month' },
  { value: 'serious', label: 'Serious / Full-time', desc: 'Breaks are a significant part of my hobby or business' },
];

const PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: 'fanatics_live', label: 'Fanatics Live' },
  { value: 'whatnot', label: 'Whatnot' },
  { value: 'ebay', label: 'eBay' },
  { value: 'dave_adams', label: "Dave & Adam's" },
  { value: 'layton_sports', label: 'Layton Sports Cards' },
  { value: 'local_card_shop', label: 'Local Card Shop' },
  { value: 'other', label: 'Other' },
];

const SPEND_OPTIONS: { value: string; label: string }[] = [
  { value: 'under_150', label: 'Under $150' },
  { value: '150_500', label: '$150 – $500' },
  { value: '500_1000', label: '$500 – $1,000' },
  { value: '1000_5000', label: '$1,000 – $5,000' },
  { value: '5000_plus', label: '$5,000+' },
];

const REFERRAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'word_of_mouth', label: 'Word of Mouth' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'social_media', label: 'Social Media' },
  { value: 'google', label: 'Google Search' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [isOver18, setIsOver18] = useState<boolean | null>(null);

  // Step 2
  const [experience, setExperience] = useState('');
  const [sports, setSports] = useState<string[]>([]);
  const [eras, setEras] = useState<string[]>([]);
  const [platform, setPlatform] = useState('');
  const [spend, setSpend] = useState('');

  // Step 3
  const [referral, setReferral] = useState('');
  const [bestPull, setBestPull] = useState('');

  // Check if onboarding already completed
  useEffect(() => {
    fetch('/api/profile').then(r => r.json()).then(d => {
      if (d.profile?.onboarding_completed_at) router.replace('/');
    }).catch(() => {});
  }, [router]);

  function toggleChip(list: string[], item: string, setter: (v: string[]) => void) {
    setter(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);
  }

  const canProceedStep2 = experience && sports.length > 0 && platform && spend;
  const canProceedStep3 = referral;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_over_18: isOver18,
          experience_level: experience,
          favorite_sports: sports,
          collecting_eras: eras,
          primary_platform: platform,
          monthly_spend: spend,
          referral_source: referral,
          best_pull: bestPull || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      posthog.capture('onboarding_completed', {
        experience_level: experience,
        favorite_sports: sports,
        primary_platform: platform,
        monthly_spend: spend,
        referral_source: referral,
        is_over_18: isOver18,
      });
      router.replace('/subscribe');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>BreakIQ</span>
          </div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {step === 1 ? 'Welcome' : step === 2 ? 'About You' : 'Almost Done'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Step {step} of 3
          </p>
          {/* Progress bar */}
          <div className="flex gap-1.5 justify-center mt-4">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className="h-1 rounded-full transition-all"
                style={{
                  width: s <= step ? '40px' : '24px',
                  backgroundColor: s <= step ? 'var(--accent-blue)' : 'var(--terminal-border)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="h-1" style={{ background: 'var(--gradient-blue)' }} />
          <div className="p-6">

            {/* ── Step 1: Age Gate ──────────────────────────────── */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center">
                  <ShieldCheck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--accent-blue)' }} />
                  <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Are you 18 years or older?
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    BreakIQ involves sports card market analysis. We need to verify your age before continuing.
                  </p>
                </div>

                {isOver18 === false && (
                  <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <XCircle className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--signal-pass)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--signal-pass)' }}>
                      BreakIQ is only available to users 18 and older.
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setIsOver18(true); setStep(2); }}
                    className="flex-1 py-3 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90"
                    style={{ background: 'var(--gradient-blue)' }}
                  >
                    Yes, I'm 18+
                  </button>
                  <button
                    onClick={() => setIsOver18(false)}
                    className="flex-1 py-3 rounded-lg text-sm font-semibold transition-all"
                    style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: About You ────────────────────────────── */}
            {step === 2 && (
              <div className="space-y-5">
                {/* Experience */}
                <div>
                  <Label>Experience Level</Label>
                  <div className="space-y-2">
                    {EXPERIENCE_OPTIONS.map(o => (
                      <button
                        key={o.value}
                        onClick={() => setExperience(o.value)}
                        className="w-full text-left px-4 py-3 rounded-lg transition-all"
                        style={{
                          backgroundColor: experience === o.value ? 'rgba(59,130,246,0.12)' : 'var(--terminal-bg)',
                          border: `2px solid ${experience === o.value ? 'var(--accent-blue)' : 'var(--terminal-border)'}`,
                        }}
                      >
                        <p className="text-sm font-semibold" style={{ color: experience === o.value ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{o.label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{o.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* What do you collect */}
                <div>
                  <Label>What do you collect?</Label>
                  <div className="flex flex-wrap gap-2">
                    {COLLECTING_OPTIONS.map(s => (
                      <Chip key={s} label={s} selected={sports.includes(s)} onClick={() => toggleChip(sports, s, setSports)} />
                    ))}
                  </div>
                </div>

                {/* Eras */}
                <div>
                  <Label>What era are you most interested in?</Label>
                  <div className="flex flex-wrap gap-2">
                    {ERA_OPTIONS.map(e => (
                      <Chip key={e.value} label={e.label} selected={eras.includes(e.value)} onClick={() => toggleChip(eras, e.value, setEras)} />
                    ))}
                  </div>
                </div>

                {/* Platform */}
                <div>
                  <Label>Where do you usually break?</Label>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORM_OPTIONS.map(p => (
                      <Chip key={p.value} label={p.label} selected={platform === p.value} onClick={() => setPlatform(p.value)} />
                    ))}
                  </div>
                </div>

                {/* Spend */}
                <div>
                  <Label>Monthly hobby spend</Label>
                  <div className="flex flex-wrap gap-2">
                    {SPEND_OPTIONS.map(s => (
                      <Chip key={s.value} label={s.label} selected={spend === s.value} onClick={() => setSpend(s.value)} />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
                    style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={!canProceedStep2}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40"
                    style={{ background: 'var(--gradient-blue)' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Quick Hits ───────────────────────────── */}
            {step === 3 && (
              <div className="space-y-5">
                {/* Referral */}
                <div>
                  <Label>How did you hear about BreakIQ?</Label>
                  <div className="flex flex-wrap gap-2">
                    {REFERRAL_OPTIONS.map(r => (
                      <Chip key={r.value} label={r.label} selected={referral === r.value} onClick={() => setReferral(r.value)} />
                    ))}
                  </div>
                </div>

                {/* Best pull */}
                <div>
                  <Label optional>Best pull you've ever had?</Label>
                  <input
                    type="text"
                    value={bestPull}
                    onChange={e => setBestPull(e.target.value)}
                    placeholder="e.g., 2023 Bowman Chrome Wemby Auto /25"
                    className="w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-primary)' }}
                  />
                </div>

                {error && <p className="text-sm" style={{ color: 'var(--signal-pass)' }}>{error}</p>}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-all"
                    style={{ backgroundColor: 'var(--terminal-bg)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!canProceedStep3 || submitting}
                    className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: 'var(--gradient-blue)' }}
                  >
                    {submitting ? 'Saving…' : <><Sparkles className="w-4 h-4" /> Let's Go</>}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
      {children}
      {optional && <span className="font-normal normal-case tracking-normal ml-1" style={{ color: 'var(--text-disabled)' }}>(optional)</span>}
    </p>
  );
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
      style={{
        backgroundColor: selected ? 'rgba(59,130,246,0.15)' : 'var(--terminal-bg)',
        border: `1.5px solid ${selected ? 'var(--accent-blue)' : 'var(--terminal-border)'}`,
        color: selected ? 'var(--accent-blue)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}
