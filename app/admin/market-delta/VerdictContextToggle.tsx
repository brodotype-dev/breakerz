'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

// Admin-only toggle for the slice-2b verdict-enrichment feature flag.
// Colocated on /admin/market-delta because the captures panel directly
// below feeds the data the flag governs — eyeballing both at once makes
// the A/B decision easier.

interface Props {
  initialEnabled: boolean;
}

export default function VerdictContextToggle({ initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    // Optimistic flip — reverts on failure.
    setEnabled(next);
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'verdict_observation_context_enabled', enabled: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-xl border p-4 flex items-center justify-between gap-4"
      style={{
        backgroundColor: 'rgba(168, 85, 247, 0.06)',
        borderColor: 'rgba(168, 85, 247, 0.3)',
      }}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--gradient-purple)' }}
        >
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Verdict observation enrichment
          </p>
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            When on, recent /break-price observations splice into the AI verdict prompt for the same product (min 3 ranked observations to cite a range). Slice 2b of the composition-observation plan.
          </p>
          {error && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--signal-pass)' }}>{error}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle verdict observation enrichment"
        onClick={toggle}
        disabled={saving}
        className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50"
        style={{
          backgroundColor: enabled ? 'var(--accent-blue)' : 'var(--terminal-border)',
        }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform"
          style={{ transform: `translateX(${enabled ? '20px' : '2px'}) translateY(2px)` }}
        />
      </button>
    </div>
  );
}
