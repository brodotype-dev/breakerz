'use client';

import { useEffect, useMemo, useState } from 'react';
import ChaseCardsPanel from './ChaseCardsPanel';
import type { ChaseCard, PlayerWithPricing, Product, Sport } from '@/lib/types';

interface Props {
  product: Product & { sport: Sport };
  chaseCards: ChaseCard[];
  players: PlayerWithPricing[];
  riskFlagMap: Map<string, Array<{ flagType: string; note: string }>>;
}

interface Snapshot {
  player_product_id: string;
  has_history: boolean;
  raw_avg_90d: number | null;
  psa10_avg_90d: number | null;
  raw_sales_90d: number | null;
  psa10_sales_90d: number | null;
}

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(0)}`;
  if (n < 1000) return `$${Math.round(n)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

/**
 * Pre-release consumer layout.
 *
 * Shown when the product's `lifecycle_status === 'pre_release'`. The live
 * pricing engine doesn't run yet (no CH catalog hydration, no slot EVs),
 * so this layout focuses on what we *do* have: chase cards admin curated,
 * the player checklist, and (Phase 3) historical comps from these players'
 * existing cards.
 *
 * Risk flags surface here too so consumers see context that matters
 * regardless of pricing (injury, suspension, etc.).
 */
export default function PreReleaseLayout({ product, chaseCards, players, riskFlagMap }: Props) {
  const [snapshots, setSnapshots] = useState<Map<string, Snapshot>>(new Map());
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Fetch player historical comps once players are known. Skips when no
  // players (checklist hasn't been imported yet).
  useEffect(() => {
    if (!players.length || !product.id) return;
    let cancelled = false;
    setSnapshotsLoading(true);
    fetch('/api/pre-release/player-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    })
      .then(r => r.json())
      .then((data: { snapshots?: Snapshot[] }) => {
        if (cancelled) return;
        const m = new Map<string, Snapshot>();
        for (const s of data.snapshots ?? []) m.set(s.player_product_id, s);
        setSnapshots(m);
      })
      .catch(err => console.error('[PreReleaseLayout] snapshot fetch failed', err))
      .finally(() => { if (!cancelled) setSnapshotsLoading(false); });
    return () => { cancelled = true; };
  }, [product.id, players.length]);

  const daysUntilRelease = useMemo(() => {
    if (!product.release_date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const release = new Date(product.release_date + 'T00:00:00');
    const diffMs = release.getTime() - today.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return days;
  }, [product.release_date]);

  // Sort players: rookies first, then alphabetical. Read-only — no pricing yet.
  const sorted = useMemo(() => {
    return [...players].sort((a, b) => {
      const aRookie = a.player?.is_rookie ? 0 : 1;
      const bRookie = b.player?.is_rookie ? 0 : 1;
      if (aRookie !== bRookie) return aRookie - bRookie;
      return (a.player?.name ?? '').localeCompare(b.player?.name ?? '');
    });
  }, [players]);

  return (
    <div className="space-y-6">
      {/* Countdown */}
      {daysUntilRelease != null && daysUntilRelease > 0 && (
        <div
          className="rounded-xl border p-5 text-center"
          style={{
            borderColor: 'var(--terminal-border)',
            backgroundColor: 'var(--terminal-surface)',
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Release Countdown
          </p>
          <p className="text-4xl font-black font-mono" style={{ color: '#a855f7' }}>
            {daysUntilRelease}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            {daysUntilRelease === 1 ? 'day' : 'days'} until launch
          </p>
        </div>
      )}

      {/* Chase cards — primary signal during pre-release */}
      {chaseCards.length > 0 && <ChaseCardsPanel chaseCards={chaseCards} />}

      {/* Player checklist — read-only roster + 90-day historical comps */}
      {sorted.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Checklist · {sorted.length} {sorted.length === 1 ? 'player' : 'players'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              90-day comps from each player&apos;s existing cards (not from this product).{' '}
              Rookies show data-light — first-year cards aren&apos;t out yet.
              {snapshotsLoading && <span className="ml-2 italic">Loading comps…</span>}
            </p>
          </div>
          <div className="hidden md:grid grid-cols-[1fr_90px_90px_90px_60px] gap-3 px-5 py-2 border-b text-[10px] uppercase tracking-wider font-bold"
            style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-tertiary)', backgroundColor: 'var(--terminal-surface-hover)' }}>
            <span>Player</span>
            <span className="text-right">Raw avg</span>
            <span className="text-right">PSA 10 avg</span>
            <span className="text-right">Sales 90d</span>
            <span className="text-right">Team</span>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
            {sorted.map(p => {
              const flags = riskFlagMap.get(p.id) ?? [];
              const snap = snapshots.get(p.id);
              const isRookie = !!p.player?.is_rookie;
              return (
                <div
                  key={p.id}
                  className="md:grid md:grid-cols-[1fr_90px_90px_90px_60px] md:gap-3 px-5 py-2.5 flex items-center gap-3 flex-wrap"
                  style={{ borderColor: 'var(--terminal-border)' }}
                >
                  {/* Name + RC + flags */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {p.player?.name}
                    </span>
                    {isRookie && (
                      <span
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                        style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
                      >
                        RC
                      </span>
                    )}
                    {flags.map((f, i) => (
                      <span
                        key={i}
                        title={f.note}
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                        style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' }}
                      >
                        {f.flagType}
                      </span>
                    ))}
                  </div>

                  {/* Raw avg */}
                  <span className="md:text-right text-xs font-mono" style={{ color: snap?.has_history ? 'var(--text-primary)' : 'var(--text-disabled)' }}>
                    {snap?.has_history ? formatPrice(snap.raw_avg_90d) : isRookie ? 'No data' : '—'}
                  </span>

                  {/* PSA 10 avg */}
                  <span className="md:text-right text-xs font-mono" style={{ color: snap?.psa10_avg_90d != null ? 'var(--text-primary)' : 'var(--text-disabled)' }}>
                    {snap?.psa10_avg_90d != null ? formatPrice(snap.psa10_avg_90d) : '—'}
                  </span>

                  {/* Sales count */}
                  <span className="md:text-right text-xs font-mono" style={{ color: snap?.has_history ? 'var(--text-secondary)' : 'var(--text-disabled)' }}>
                    {snap?.has_history && snap.raw_sales_90d != null ? snap.raw_sales_90d.toLocaleString() : '—'}
                  </span>

                  {/* Team */}
                  <span className="md:text-right text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {p.player?.team || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sorted.length === 0 && chaseCards.length === 0 && (
        <div
          className="rounded-xl border border-dashed p-10 text-center"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Checklist not loaded yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            We&apos;re prepping this product. Chase cards and player roster will appear here as the launch gets closer.
          </p>
        </div>
      )}
    </div>
  );
}
