'use client';

import { useEffect, useState } from 'react';
import type { VariantWithPrices } from '@/lib/types';

interface PlayerCompsData {
  player_name: string;
  team: string;
  is_rookie: boolean;
  is_icon: boolean;
  variants: VariantWithPrices[];
  recentComps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }>;
}

interface Props {
  playerProductId: string | null;
  onClose: () => void;
}

function GradeBadge({ grade }: { grade: string }) {
  const isPsa10 = grade === 'PSA 10' || grade === '10';
  const isPsa9 = grade === 'PSA 9' || grade === '9';
  const color = isPsa10 ? '#22c55e' : isPsa9 ? 'var(--accent-blue)' : 'var(--text-secondary)';
  const bg = isPsa10 ? 'rgba(34,197,94,0.12)' : isPsa9 ? 'rgba(59,130,246,0.12)' : 'var(--terminal-surface-hover)';
  return (
    <span
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: bg }}
    >
      {grade}
    </span>
  );
}

function PlatformLabel({ platform }: { platform: string }) {
  const label = platform?.replace(/_/g, ' ') ?? '';
  return <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{label}</span>;
}

export default function PlayerDetailDrawer({ playerProductId, onClose }: Props) {
  const [data, setData] = useState<PlayerCompsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOpen = playerProductId != null;

  useEffect(() => {
    if (!playerProductId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/player-comps?playerProductId=${playerProductId}`)
      .then(res => res.json())
      .then(json => {
        if (!cancelled) {
          if (json.error) setError(json.error);
          else setData(json);
        }
      })
      .catch(() => { if (!cancelled) setError('Failed to load data'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerProductId]);

  // Trap Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: 'rgba(0,0,0,0.6)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width: 'min(480px, 100vw)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          backgroundColor: 'var(--terminal-bg)',
          borderLeft: '1px solid var(--terminal-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 pt-5 pb-4 border-b"
          style={{ borderColor: 'var(--terminal-border)' }}
        >
          <div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-5 w-36 rounded animate-pulse" style={{ backgroundColor: 'var(--terminal-surface-hover)' }} />
                <div className="h-3 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--terminal-surface-hover)' }} />
              </div>
            ) : data ? (
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                    {data.player_name}
                  </h2>
                  {data.is_rookie && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}>
                      RC
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{data.team}</p>
              </div>
            ) : (
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Player Detail</h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--terminal-surface-hover)]"
            style={{ color: 'var(--text-tertiary)' }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div
                className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }}
              />
              <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                Pulling most recent data…
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-center py-8" style={{ color: '#ef4444' }}>{error}</p>
          )}

          {!loading && data && (
            <>
              {/* Variants table */}
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Card Variants · {data.variants.length}
                </p>
                <div
                  className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--terminal-border)' }}
                >
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--terminal-surface)', borderBottom: '1px solid var(--terminal-border)' }}>
                        <th className="text-left px-3 py-2 font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                          Variant
                        </th>
                        <th className="text-right px-3 py-2 font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                          Odds
                        </th>
                        <th className="text-right px-3 py-2 font-bold uppercase tracking-wider" style={{ color: '#ef4444' }}>
                          PSA 8
                        </th>
                        <th className="text-right px-3 py-2 font-bold uppercase tracking-wider" style={{ color: 'var(--accent-blue)' }}>
                          PSA 9
                        </th>
                        <th className="text-right px-3 py-2 font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>
                          PSA 10
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.variants.map((v, i) => {
                        const getPrice = (grade: string) => {
                          const p = v.prices.find(p =>
                            p.grade === grade || p.grade === grade.replace('PSA ', '')
                          );
                          return p ? `$${p.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';
                        };
                        return (
                          <tr
                            key={v.id}
                            className="border-t"
                            style={{
                              borderColor: 'var(--terminal-border)',
                              backgroundColor: i % 2 === 0 ? 'var(--terminal-surface)' : 'var(--terminal-bg)',
                            }}
                          >
                            <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                              <div>
                                <span className="font-medium">{v.variant_name}</span>
                                {!v.cardhedger_card_id && (
                                  <span className="ml-1.5 text-[9px]" style={{ color: 'var(--text-disabled)' }}>no match</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-tertiary)' }}>
                              {v.hobby_odds ? `1:${v.hobby_odds}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                              {getPrice('PSA 8')}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: 'var(--accent-blue)' }}>
                              {getPrice('PSA 9')}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: '#22c55e' }}>
                              {getPrice('PSA 10')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent comps */}
              {data.recentComps.length > 0 && (
                <div>
                  <p
                    className="text-[10px] font-bold uppercase tracking-widest mb-3"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Recent Sales (Graded)
                  </p>
                  <div className="space-y-1.5">
                    {data.recentComps.map((comp, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}
                      >
                        <div className="flex items-center gap-2">
                          <GradeBadge grade={comp.grade} />
                          <PlatformLabel platform={comp.platform} />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {new Date(comp.sale_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
                            ${comp.sale_price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] mt-2 px-1" style={{ color: 'var(--text-tertiary)' }}>
                    Source: CardHedger · PSA grades 8–10 · last 180 days
                  </p>
                </div>
              )}

              {data.recentComps.length === 0 && data.variants.some(v => v.cardhedger_card_id) && (
                <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                  No recent graded sales found in the last 180 days.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
