'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import posthog from 'posthog-js';
import { PH_EVENTS } from '@/lib/posthog-events';

// Thin, dismissible "we're in private beta" banner. Shown on home,
// /break/[slug], and /analysis — the three surfaces where a beta user is
// most likely to land on a verdict they can't yet fully trust. Three jobs:
//   1. Honestly sets expectations for beta users
//   2. Frames feedback as a contribution, not a chore
//   3. Provides cover for model misses (which will happen) without users
//      losing trust
//
// Dismissal persists via localStorage. Cheap-and-cheerful for beta; a
// profile column migration is queued for post-beta. Each surface where the
// banner appears should pass a unique `surface` for telemetry segmentation.

const STORAGE_KEY = 'breakiq_beta_banner_dismissed';

export interface BetaBannerProps {
  /** Where the banner is rendered — used as a PostHog property on dismiss. */
  surface: 'home' | 'break_page' | 'analysis';
}

export default function BetaBanner({ surface }: BetaBannerProps) {
  // Hidden by default so the dismissed state doesn't briefly flash visible
  // before localStorage is read on hydration.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== '1') {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (private browsing on some platforms) —
      // fall back to always-show. Worst case: the user dismisses it every
      // session, which is still better than never showing it.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore — banner just won't persist its dismissed state
    }
    try {
      posthog.capture(PH_EVENTS.beta_banner_dismissed, { surface });
    } catch {
      // ignore — PostHog may not be initialized in some environments
    }
    setVisible(false);
  };

  return (
    <div
      className="relative w-full rounded-lg border px-4 py-2.5 flex items-start gap-3"
      style={{
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderColor: 'rgba(59,130,246,0.3)',
      }}
      role="status"
    >
      <span
        className="text-[10px] font-bold uppercase tracking-widest shrink-0 mt-0.5 px-1.5 py-0.5 rounded"
        style={{ backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--accent-blue)' }}
      >
        Private Beta
      </span>
      <p className="flex-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        Our model is learning from every break logged. Tell us when our take is off — we&rsquo;re tuning with every flag.
      </p>
      <button
        onClick={dismiss}
        className="p-1 rounded transition-colors hover:bg-white/5 shrink-0"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="Dismiss beta banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
