'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { setProductLifecycle } from '../actions';
import type { ProductLifecycle } from '@/lib/types';

interface Variant {
  to: ProductLifecycle;
  label: string;
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
  tone: 'positive' | 'neutral' | 'caution';
}

const variants: Record<string, Variant> = {
  to_live: {
    to: 'live',
    label: 'Mark as Live →',
    confirmTitle: 'Switch this product to Live?',
    confirmBody:
      'The product will start appearing in the daily CH catalog refresh, variant hydration, and pricing crons. After confirming, click Refresh CH Catalog → Hydrate Variants → Refresh Pricing in Quick Actions to populate live data immediately.',
    confirmCta: 'Yes, mark as Live',
    tone: 'positive',
  },
  to_dormant: {
    to: 'dormant',
    label: 'Wind Down to Dormant',
    confirmTitle: 'Wind this product down?',
    confirmBody:
      "Daily crons will skip this product. Pricing will only refresh biweekly. Existing data stays — nothing is deleted. Use this when no one is breaking the product anymore but you want to keep its dashboard alive as a historical reference.",
    confirmCta: 'Yes, wind down',
    tone: 'caution',
  },
  reactivate_to_live: {
    to: 'live',
    label: 'Reactivate to Live',
    confirmTitle: 'Reactivate this product?',
    confirmBody:
      'Lifecycle flips back to Live and the daily crons will start picking it up again on their next firing. Pricing snapshot will refresh on the next pricing cron run.',
    confirmCta: 'Yes, reactivate',
    tone: 'positive',
  },
};

export default function LifecycleTransitionButton({
  productId,
  variant,
}: {
  productId: string;
  variant: keyof typeof variants;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const v = variants[variant];

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await setProductLifecycle(productId, v.to);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    startTransition(() => router.refresh());
  }

  const colors = {
    positive: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
    caution: { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
    neutral: { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' },
  }[v.tone];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{
          backgroundColor: colors.bg,
          color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {v.tone === 'positive' && <ArrowRight className="w-3.5 h-3.5" />}
        {v.tone === 'caution' && <AlertTriangle className="w-3.5 h-3.5" />}
        {v.label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="rounded-xl border p-6 max-w-md w-full"
            style={{ backgroundColor: 'var(--terminal-surface)', borderColor: 'var(--terminal-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {v.confirmTitle}
            </h3>
            <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {v.confirmBody}
            </p>

            {error && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg mb-4"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                <p className="text-xs" style={{ color: '#fca5a5' }}>{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
              >
                {busy ? 'Working…' : <><CheckCircle2 className="w-3.5 h-3.5" />{v.confirmCta}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
