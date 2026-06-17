import React from 'react';

// Visual prospect-rank chip — `#7` etc. next to a player name. A FACT (MLB
// Pipeline rank), independent of feature_flags.prospect_rank_enabled, which
// only controls whether the rank affects pricing. So the chip renders even
// when Track A is killed via the flag — that's the right semantic.
//
// Tier breakpoints mirror PROSPECT_RANK_TIERS in lib/prospect-score.ts so the
// color maps to the size of the under-the-hood score bump. Renders nothing for
// unranked players or ranks past 100.
function tierStyle(rank: number): { bg: string; color: string } {
  if (rank <= 10) return { bg: 'rgba(245, 158, 11, 0.18)', color: 'rgb(245, 158, 11)' }; // gold — top-10
  if (rank <= 30) return { bg: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)' }; // blue — #11–30
  return { bg: 'rgba(148, 163, 184, 0.18)', color: 'var(--text-secondary)' };             // neutral — #31–100
}

export function ProspectRankChip({
  rank,
  source,
  updatedAt,
  size = 'sm',
}: {
  rank: number | null | undefined;
  source?: string | null;
  updatedAt?: string | null;
  size?: 'sm' | 'md';
}) {
  if (rank == null || rank > 100) return null;
  const { bg, color } = tierStyle(rank);
  const srcLabel = source === 'mlb_pipeline' ? 'MLB Pipeline' : (source ?? 'prospect ranking');
  const dateLabel = updatedAt ? new Date(updatedAt).toLocaleDateString() : null;
  const title = `Ranked #${rank} prospect on ${srcLabel}${dateLabel ? ` as of ${dateLabel}` : ''}`;
  const sizeCls = size === 'md' ? 'text-[11px] px-2 py-0.5' : 'text-[9px] px-1.5 py-0.5';
  return (
    <span
      className={`${sizeCls} font-bold rounded shrink-0 whitespace-nowrap`}
      style={{ backgroundColor: bg, color }}
      title={title}
    >
      #{rank}
    </span>
  );
}
