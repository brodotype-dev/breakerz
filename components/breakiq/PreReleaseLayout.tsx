'use client';

import { useMemo } from 'react';
import ChaseCardsPanel from './ChaseCardsPanel';
import type { ChaseCard, PlayerWithPricing, Product, Sport } from '@/lib/types';

interface Props {
  product: Product & { sport: Sport };
  chaseCards: ChaseCard[];
  players: PlayerWithPricing[];
  riskFlagMap: Map<string, Array<{ flagType: string; note: string }>>;
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

      {/* Player checklist — read-only roster */}
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
              Player historical comps coming once the release window opens.
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
            {sorted.map(p => {
              const flags = riskFlagMap.get(p.id) ?? [];
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-5 py-2.5"
                  style={{ borderColor: 'var(--terminal-border)' }}
                >
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                    {p.player?.name}
                    {p.player?.is_rookie && (
                      <span
                        className="ml-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                        style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
                      >
                        RC
                      </span>
                    )}
                  </span>
                  {p.player?.team && (
                    <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      {p.player.team}
                    </span>
                  )}
                  {flags.length > 0 && (
                    <div className="flex items-center gap-1">
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
                  )}
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
