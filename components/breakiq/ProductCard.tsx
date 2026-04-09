import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Product, Sport } from '@/lib/types';

interface Props {
  product: Product & { sport: Sport };
}

function getSportStyle(sportName: string): { primary: string; gradient: string } {
  const s = sportName.toLowerCase();
  if (s === 'basketball') return { primary: '#f97316', gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' };
  if (s === 'football')   return { primary: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)' };
  return { primary: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' }; // baseball / default
}

function isPreRelease(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  return new Date(releaseDate + 'T00:00:00') > new Date();
}

export default function ProductCard({ product }: Props) {
  const sport = product.sport?.name ?? '';
  const { primary, gradient } = getSportStyle(sport);
  const preRelease = isPreRelease(product.release_date);

  return (
    <Link href={`/break/${product.slug}`} className="block group">
      <div
        className="relative overflow-hidden rounded-xl border transition-all duration-200 group-hover:scale-[1.02]"
        style={{
          borderColor: 'var(--terminal-border)',
          backgroundColor: 'var(--terminal-surface)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        {/* Sport gradient top bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: gradient }} />

        {/* Hover glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: `radial-gradient(circle at center, ${primary}12 0%, transparent 70%)` }}
        />

        <div className="relative p-5 pt-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${primary}20`, color: primary, letterSpacing: '0.06em' }}
                >
                  {sport}
                </span>
                <span className="text-xs font-semibold" style={{ color: 'var(--text-t-tertiary)' }}>
                  {product.year}
                </span>
              </div>
              <h3 className="text-base font-bold leading-snug mb-1 truncate" style={{ color: 'var(--text-t-primary)' }}>
                {product.name}
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>{product.manufacturer}</p>
            </div>

            {!preRelease && (
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-full shrink-0 ml-2"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ backgroundColor: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.6)' }}
                />
                <span className="text-[9px] font-bold uppercase" style={{ color: '#22c55e', letterSpacing: '0.06em' }}>
                  LIVE
                </span>
              </div>
            )}
          </div>

          {/* Case cost */}
          <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: `${primary}0d` }}>
            <p className="terminal-label mb-1.5">Case Cost</p>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xl font-bold" style={{ color: primary }}>
                ${product.hobby_case_cost?.toLocaleString() ?? '—'}
              </span>
              {product.bd_case_cost && (
                <>
                  <span style={{ color: '#6b7280' }}>·</span>
                  <span className="font-mono text-sm" style={{ color: '#a8adb8' }}>
                    BD ${product.bd_case_cost.toLocaleString()}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* CTA */}
          {preRelease ? (
            <div
              className="text-center py-2 px-3 rounded-lg text-xs font-bold"
              style={{
                backgroundColor: 'rgba(245,158,11,0.1)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)',
              }}
            >
              PRE-RELEASE · Coming Soon
            </div>
          ) : (
            <div
              className="flex items-center justify-between py-2 px-3 rounded-lg"
              style={{
                backgroundColor: `${primary}12`,
                borderLeft: `3px solid ${primary}`,
              }}
            >
              <span className="text-sm font-semibold" style={{ color: primary }}>View Slot Analysis</span>
              <ChevronRight
                className="w-4 h-4 group-hover:translate-x-1 transition-transform"
                style={{ color: primary }}
              />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
