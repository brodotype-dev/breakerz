'use client';

import { useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, Check, X } from 'lucide-react';

export type FeedbackSurface =
  | 'player_row'
  | 'team_row'
  | 'break_analysis'
  | 'slab_analysis'
  | 'pricing_breakdown';

export type FeedbackEntityType =
  | 'player_product'
  | 'team'
  | 'analysis'
  | 'cert'
  | 'variant';

type Category =
  | 'pricing_too_high'
  | 'pricing_too_low'
  | 'wrong_player'
  | 'missing_data'
  | 'risk_flag_wrong'
  | 'other';

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'pricing_too_high', label: 'Pricing looks too high' },
  { value: 'pricing_too_low', label: 'Pricing looks too low' },
  { value: 'wrong_player', label: 'Wrong player / data mismatch' },
  { value: 'missing_data', label: 'Missing data' },
  { value: 'risk_flag_wrong', label: 'Risk flag is wrong' },
  { value: 'other', label: 'Something else' },
];

interface Props {
  surface: FeedbackSurface;
  entityType: FeedbackEntityType;
  entityId: string;
  productId?: string | null;
  size?: 'sm' | 'md';
}

// Inline thumbs-up / thumbs-down on consumer pricing rows. Thumbs-up captures
// silently. Thumbs-down opens a small popover with category + optional notes.
// Both write to /api/feedback/pricing which inserts a `pricing_feedback` row
// and fires a `pricing_feedback_submitted` PostHog event.
export default function PricingFeedback({
  surface,
  entityType,
  entityId,
  productId = null,
  size = 'sm',
}: Props) {
  const [submitted, setSubmitted] = useState<'up' | 'down' | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [category, setCategory] = useState<Category | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside to dismiss the popover.
  useEffect(() => {
    if (!popoverOpen) return;
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [popoverOpen]);

  async function postFeedback(payload: {
    rating: 'up' | 'down';
    category?: Category;
    notes?: string;
  }) {
    const res = await fetch('/api/feedback/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: payload.rating,
        surface,
        entity_type: entityType,
        entity_id: entityId,
        product_id: productId,
        category: payload.category ?? null,
        notes: payload.notes ?? null,
        page_url: typeof window !== 'undefined' ? window.location.pathname : null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? 'Failed to submit feedback');
    }
  }

  async function handleThumbsUp(e: React.MouseEvent) {
    e.stopPropagation();
    if (submitted) return;
    try {
      await postFeedback({ rating: 'up' });
      setSubmitted('up');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  function handleThumbsDownClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (submitted) return;
    setPopoverOpen((v) => !v);
  }

  async function handleSubmitDown(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSubmitting(true);
    setError(null);
    try {
      await postFeedback({
        rating: 'down',
        category: (category || 'other') as Category,
        notes: notes.trim() || undefined,
      });
      setSubmitted('down');
      setPopoverOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  const iconSize = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const padding = size === 'md' ? 'p-1.5' : 'p-1';

  if (submitted) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--text-tertiary)' }}
        title="You teach. We tune."
      >
        <Check className="w-3 h-3" />
        Logged for the next pricing pass
      </span>
    );
  }

  return (
    <div className="relative inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={handleThumbsUp}
        className={`${padding} rounded transition-colors hover:bg-[var(--terminal-surface)]`}
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="This pricing looks right"
      >
        <ThumbsUp className={iconSize} />
      </button>
      <button
        type="button"
        onClick={handleThumbsDownClick}
        className={`${padding} rounded transition-colors hover:bg-[var(--terminal-surface)]`}
        style={{ color: 'var(--text-tertiary)' }}
        aria-label="This pricing looks wrong"
      >
        <ThumbsDown className={iconSize} />
      </button>

      {popoverOpen && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg p-3 shadow-lg"
          style={{
            backgroundColor: 'var(--terminal-surface)',
            border: '1px solid var(--terminal-border)',
          }}
        >
          <div className="flex items-start justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              What looks off?
            </p>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] mb-2 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            We retrain pricing weekly from breaker reports.
          </p>
          <form onSubmit={handleSubmitDown} className="space-y-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category | '')}
              className="w-full rounded px-2 py-1.5 text-xs"
              style={{
                backgroundColor: 'var(--terminal-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--terminal-border)',
              }}
              required
            >
              <option value="">Select a reason…</option>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
              placeholder="Anything else? (optional)"
              rows={2}
              className="w-full rounded px-2 py-1.5 text-xs resize-none"
              style={{
                backgroundColor: 'var(--terminal-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--terminal-border)',
              }}
            />
            {error && (
              <p className="text-[11px]" style={{ color: 'var(--accent-red, #ef4444)' }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--accent-blue)',
                color: 'var(--terminal-bg)',
              }}
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
