'use client';

import type { ChaseCard } from '@/lib/types';

interface Props {
  chaseCards: ChaseCard[];
}

function ChaseCardTile({ card }: { card: ChaseCard }) {
  const playerName = card.player_product?.player?.name ?? '—';
  const team = card.player_product?.player?.team ?? '';
  const isRookie = card.player_product?.player?.is_rookie ?? false;
  const isChaseCard = card.type === 'chase_card';

  return (
    <div
      className="relative flex flex-col gap-1.5 p-3 rounded-xl transition-all"
      style={{
        border: card.is_hit
          ? '1px solid rgba(239,68,68,0.5)'
          : isChaseCard
          ? '1px solid rgba(168,85,247,0.35)'
          : '1px solid rgba(59,130,246,0.35)',
        backgroundColor: card.is_hit
          ? 'rgba(239,68,68,0.07)'
          : isChaseCard
          ? 'rgba(168,85,247,0.06)'
          : 'rgba(59,130,246,0.06)',
      }}
    >
      {/* HIT overlay banner */}
      {card.is_hit && (
        <div
          className="absolute inset-x-0 top-0 flex items-center justify-center py-0.5 rounded-t-xl text-[9px] font-black uppercase tracking-widest"
          style={{ backgroundColor: 'rgba(239,68,68,0.85)', color: 'white' }}
        >
          HIT — Self-Reported
        </div>
      )}

      <div className={card.is_hit ? 'pt-4' : ''}>
        {/* Type badge */}
        <div className="flex items-center justify-between gap-1 mb-1">
          <span
            className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={
              isChaseCard
                ? { backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7' }
                : { backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }
            }
          >
            {isChaseCard ? 'Chase Card' : 'Chase Player'}
          </span>
          {isRookie && (
            <span
              className="text-[8px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
            >
              RC
            </span>
          )}
        </div>

        {/* Player name */}
        <p
          className="text-sm font-bold leading-tight"
          style={{ color: card.is_hit ? '#fca5a5' : 'var(--text-primary)' }}
        >
          {playerName}
        </p>

        {/* Team */}
        {team && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {team}
          </p>
        )}

        {/* Variant / odds */}
        {(card.display_name || card.odds_display) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {card.display_name && (
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                {card.display_name}
              </span>
            )}
            {card.odds_display && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
              >
                {card.odds_display}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChaseCardsPanel({ chaseCards }: Props) {
  if (chaseCards.length === 0) return null;

  const hitCount = chaseCards.filter(c => c.is_hit).length;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      {/* Header */}
      <div
        className="h-0.5"
        style={{ background: 'linear-gradient(90deg, #a855f7 0%, #3b82f6 100%)' }}
      />
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Chase Board
            </span>
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)', border: '1px solid var(--terminal-border)' }}
            >
              {chaseCards.length}
            </span>
          </div>
          {hitCount > 0 && (
            <span
              className="text-[9px] font-bold uppercase px-2 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              {hitCount} HIT
            </span>
          )}
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          Rare cards &amp; hot players to watch in this product
        </p>
      </div>

      {/* Tile grid */}
      <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {chaseCards.map(card => (
          <ChaseCardTile key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
