'use client';

import Link from 'next/link';
import { ChevronRight, Activity, Flame } from 'lucide-react';
import type { Product, Sport } from '@/lib/types';

export interface ProductSignal {
  breakCount7d: number;
  hypeTag: { tag: string; observedAt: string } | null;
}

type SportKey = 'baseball' | 'basketball' | 'football';

const sportGradients: Record<SportKey, string> = {
  baseball: 'var(--gradient-blue)',
  basketball: 'var(--gradient-orange)',
  football: 'var(--gradient-green)',
};

const sportColors: Record<SportKey, { primary: string }> = {
  baseball: { primary: 'var(--sport-baseball-primary)' },
  basketball: { primary: 'var(--sport-basketball-primary)' },
  football: { primary: 'var(--sport-football-primary)' },
};

function getSportKey(sportName: string): SportKey {
  const s = sportName.toLowerCase();
  if (s === 'basketball') return 'basketball';
  if (s === 'football') return 'football';
  return 'baseball';
}

function isPreRelease(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  return new Date(releaseDate + 'T00:00:00') > new Date();
}

const HYPE_LABELS: Record<string, string> = {
  release_premium: 'Release Premium',
  underhyped: 'Underhyped',
};

export default function ProductCard({
  product,
  signal,
}: {
  product: Product & { sport: Sport };
  signal?: ProductSignal;
}) {
  const sportKey = getSportKey(product.sport?.name ?? '');
  const gradient = sportGradients[sportKey];
  const { primary } = sportColors[sportKey];
  const preRelease = isPreRelease(product.release_date);

  const breakCount = signal?.breakCount7d ?? 0;
  const hype = signal?.hypeTag ?? null;
  const hasSignals = breakCount > 0 || hype !== null;

  return (
    <Link href={`/break/${product.slug}`}>
      <div
        className="relative overflow-hidden rounded-xl border transition-all cursor-pointer group hover:scale-[1.02]"
        style={{
          borderColor: 'var(--terminal-border)',
          backgroundColor: 'var(--terminal-surface)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: gradient }} />
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: `radial-gradient(circle at center, ${primary}15 0%, transparent 70%)` }}
        />

        <div className="relative p-4 pt-5 flex flex-col gap-2.5">
          {/* Header row: sport chip + year + lifecycle pill */}
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
              style={{ letterSpacing: '0.05em', backgroundColor: `${primary}20`, color: primary }}
            >
              {product.sport?.name}
            </span>
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {product.year}
            </span>
            <div className="flex-1" />
            {preRelease ? (
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--signal-watch-bg)',
                  color: 'var(--signal-watch)',
                  letterSpacing: '0.06em',
                }}
              >
                Pre-release
              </span>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--signal-buy-bg)' }}>
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: 'var(--signal-buy)', boxShadow: 'var(--glow-green)' }}
                />
                <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--signal-buy)', letterSpacing: '0.06em' }}>
                  LIVE
                </span>
              </div>
            )}
          </div>

          {/* Title + manufacturer */}
          <div>
            <h3 className="text-base font-bold leading-snug truncate" style={{ color: 'var(--text-primary)' }}>
              {product.name}
            </h3>
            <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {product.manufacturer}
            </div>
          </div>

          {/* Signal chips: activity + hype */}
          {hasSignals && (
            <div className="flex flex-wrap items-center gap-1.5">
              {breakCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor: 'rgba(34,197,94,0.10)',
                    color: 'var(--signal-buy)',
                    border: '1px solid rgba(34,197,94,0.25)',
                  }}
                  title={`${breakCount} break${breakCount === 1 ? '' : 's'} logged in the last 7 days`}
                >
                  <Activity className="w-3 h-3" />
                  {breakCount} this week
                </span>
              )}
              {hype && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor: 'rgba(234,179,8,0.10)',
                    color: '#eab308',
                    border: '1px solid rgba(234,179,8,0.25)',
                  }}
                  title={`Community signal: ${HYPE_LABELS[hype.tag] ?? hype.tag}`}
                >
                  <Flame className="w-3 h-3" />
                  {HYPE_LABELS[hype.tag] ?? hype.tag}
                </span>
              )}
            </div>
          )}

          {/* Footer line: case costs + chevron */}
          <div
            className="flex items-center justify-between mt-1 pt-2.5 -mx-4 px-4 -mb-4 pb-3"
            style={{ borderTop: '1px solid var(--terminal-border)' }}
          >
            <div className="text-[11px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>
              {product.hobby_case_cost != null && (
                <span style={{ color: 'var(--text-secondary)' }}>
                  Hobby ${product.hobby_case_cost.toLocaleString()}
                </span>
              )}
              {product.bd_case_cost != null && (
                <span> · BD ${product.bd_case_cost.toLocaleString()}</span>
              )}
              {product.jumbo_case_cost != null && (
                <span> · Jumbo ${product.jumbo_case_cost.toLocaleString()}</span>
              )}
            </div>
            <ChevronRight
              className="w-4 h-4 group-hover:translate-x-0.5 transition-transform shrink-0 ml-2"
              style={{ color: primary }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
