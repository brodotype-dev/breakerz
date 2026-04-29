'use client';

import { useState } from 'react';
import { getTeamLogos } from '@/lib/team-logos';

interface Props {
  team: string;
  sport: string | undefined;
  selected: boolean;
  onClick: () => void;
}

/**
 * Team picker chip. Shows team logo(s) when we can resolve them; falls back
 * to the raw text label otherwise. Combined slots ("Pirates/White Sox") render
 * both logos side-by-side. The full label is always available via the title
 * attribute for hover/screen-reader access.
 *
 * Logos load via plain <img> from ESPN's CDN. We hide the <img> on error so
 * a missing logo silently falls back to text mode without leaving a broken
 * icon in the chip.
 */
export default function TeamChip({ team, sport, selected, onClick }: Props) {
  const logos = getTeamLogos(team, sport);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const visibleLogos = logos.filter((_, i) => !failed.has(i));
  const showLogos = visibleLogos.length > 0;

  return (
    <button
      onClick={onClick}
      title={team}
      aria-label={team}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all border"
      style={{
        backgroundColor: selected ? 'var(--accent-blue)' : 'transparent',
        color: selected ? 'white' : 'var(--text-secondary)',
        borderColor: selected ? 'var(--accent-blue)' : 'var(--terminal-border)',
        minHeight: '32px',
      }}
    >
      {showLogos ? (
        <span className="inline-flex items-center gap-1">
          {visibleLogos.map((logo, i) => (
            <img
              key={`${logo.src}-${i}`}
              src={logo.src}
              alt={logo.alt}
              width={20}
              height={20}
              className="inline-block"
              style={{ filter: selected ? 'brightness(1.05)' : undefined }}
              onError={() => setFailed(prev => new Set(prev).add(i))}
            />
          ))}
        </span>
      ) : (
        <span className="px-0.5">{team}</span>
      )}
    </button>
  );
}
