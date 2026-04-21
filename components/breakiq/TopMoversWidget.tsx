'use client';

import type { PlayerWithPricing } from '@/lib/types';

interface Props {
  players: PlayerWithPricing[];
}

// Shows players in this product whose cards are trending on the secondary market.
// Powered by the nightly C-score pipeline (CardHedger top-movers cross-referenced
// against this product's matched card IDs). Updated daily at 5 AM UTC.
export default function TopMoversWidget({ players }: Props) {
  const movers = players
    .filter(p => p.c_score != null && p.c_score > 0)
    .sort((a, b) => (b.c_score ?? 0) - (a.c_score ?? 0))
    .slice(0, 5);

  if (movers.length === 0) return null;

  return (
    <div
      className="rounded-lg border px-4 py-3 flex items-center gap-3 flex-wrap"
      style={{
        borderColor: 'var(--terminal-border)',
        backgroundColor: 'rgba(34,197,94,0.06)',
      }}
    >
      {/* Label */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs" style={{ color: '#22c55e' }}>▲</span>
        <span className="text-xs font-semibold uppercase" style={{ color: '#22c55e', letterSpacing: '0.06em' }}>
          Trending
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 shrink-0" style={{ backgroundColor: 'var(--terminal-border)' }} />

      {/* Mover list */}
      <div className="flex items-center gap-3 flex-wrap">
        {movers.map((p, i) => {
          const pct = Math.round((p.c_score ?? 0) * 100);
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>·</span>
              )}
              <span className="text-xs font-semibold" style={{ color: 'var(--text-t-primary)' }}>
                {p.player?.name ?? 'Unknown'}
              </span>
              <span
                className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
              >
                +{pct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Staleness note */}
      <div className="ml-auto shrink-0">
        <span className="text-[10px]" style={{ color: 'var(--text-t-secondary)' }}>
          7-day market
        </span>
      </div>
    </div>
  );
}
