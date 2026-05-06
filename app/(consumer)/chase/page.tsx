'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Heart, ExternalLink } from 'lucide-react';
import ChaseHeartButton, { ChaseSetProvider } from '@/components/breakiq/ChaseHeartButton';
import { IconPlayerBadge, BullishBadge, BearishBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import { computeEffectiveScore, formatCurrency } from '@/lib/engine';
import type { ChaseListEntry } from '@/lib/types';

function formatRelativeDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export default function ChasePage() {
  const [entries, setEntries] = useState<ChaseListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force a refetch (e.g. after the user removes a row).
  const [tick, setTick] = useState(0);
  const reload = () => setTick(t => t + 1);

  useEffect(() => {
    let cancelled = false;
    // Standard async-effect pattern (set loading → fetch → set state → clear
    // loading). The lint rule that flags setState-in-effect is overly broad
    // for this case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch('/api/chase')
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setEntries(json.entries ?? []);
      })
      .catch(() => { if (!cancelled) setError('Failed to load chase list'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const playerIds = useMemo(() => entries.map(e => e.player_id), [entries]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Hero */}
      <div
        className="relative overflow-hidden border-b"
        style={{ background: 'var(--gradient-hero)', borderColor: 'var(--terminal-border)' }}
      >
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #ef4444 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="relative px-4 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #ec4899 100%)', boxShadow: '0 0 24px rgba(239,68,68,0.35)' }}>
            <Heart className="w-5 h-5 text-white" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>My Chase</h1>
            <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
              Players you&apos;re watching — current value, signals, and where to find them
            </p>
          </div>
        </div>
      </div>

      <ChaseSetProvider playerIds={playerIds}>
        <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto">
          {loading && (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Loading…
            </div>
          )}

          {error && (
            <div className="text-center py-12 text-sm" style={{ color: '#ef4444' }}>
              {error}
            </div>
          )}

          {!loading && !error && entries.length === 0 && (
            <div className="rounded-xl border-2 border-dashed p-10 sm:p-12 text-center" style={{ borderColor: 'var(--terminal-border)' }}>
              <Heart className="w-12 h-12 mx-auto mb-4 opacity-20" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-base sm:text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No players in your chase list yet</p>
              <p className="text-xs sm:text-sm max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Tap the heart on any player from a break page or pre-release product to save them. They&apos;ll show up here with their latest market value.
              </p>
            </div>
          )}

          {!loading && !error && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map(entry => <ChaseRow key={entry.player_id} entry={entry} onChanged={reload} />)}
            </div>
          )}
        </div>
      </ChaseSetProvider>
    </div>
  );
}

function ChaseRow({ entry, onChanged }: { entry: ChaseListEntry; onChanged: () => void }) {
  const score = computeEffectiveScore(entry.buzz_score, entry.breakerz_score, entry.is_icon);

  return (
    <div
      className="rounded-xl border p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      {/* Heart + identity */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <ChaseHeartButton
          playerId={entry.player_id}
          size="md"
          onToggled={next => { if (!next) onChanged(); }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm sm:text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {entry.player_name}
            </span>
            {entry.is_rookie && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}>RC</span>
            )}
            {entry.is_icon && <IconPlayerBadge />}
            {score > 0.1  && <BullishBadge />}
            {score < -0.1 && <BearishBadge />}
            {entry.risk_flags.map((f, i) => (
              <RiskFlagBadge key={i} type={f.flag_type} note={f.note} />
            ))}
          </div>
          <div className="text-[11px] sm:text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
            {entry.team || '—'} · added {formatRelativeDate(entry.added_at)}
          </div>
        </div>
      </div>

      {/* Market value strip */}
      {entry.market ? (
        <Link
          href={`/break/${entry.market.product_slug}`}
          className="flex items-center justify-between sm:justify-end gap-3 sm:min-w-[260px] rounded-lg px-3 py-2 transition-colors hover:bg-[var(--terminal-surface-hover)]"
          style={{ border: '1px solid var(--terminal-border)' }}
        >
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              EV Mid
            </div>
            <div className="text-sm font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(entry.market.ev_mid)}
            </div>
          </div>
          <div className="flex items-center gap-1.5 min-w-0 text-right">
            <span className="text-[11px] truncate hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>
              {entry.market.product_name}
            </span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          </div>
        </Link>
      ) : (
        <div className="text-[11px] italic px-3 py-2 rounded-lg sm:min-w-[260px] text-center" style={{ color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}>
          No pricing yet
        </div>
      )}
    </div>
  );
}
