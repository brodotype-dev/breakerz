'use client';

import { formatCurrency, computeEffectiveScore } from '@/lib/engine';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakerz/SocialBadges';
import type { PlayerWithPricing } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  players: PlayerWithPricing[];
  fetching?: boolean;
  breakType: 'hobby' | 'bd';
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
}

export default function PlayerTable({ players, fetching = false, breakType, riskFlagMap = new Map() }: Props) {
  if (players.length === 0) {
    return (
      <div
        className="rounded-lg border p-12 text-center"
        style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)' }}
      >
        No players found for this product.
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
              {['#', 'Player', 'Team', 'Sets', 'EV Low', 'EV Mid', 'EV High', 'Slot Cost', 'Max Pay'].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 terminal-label whitespace-nowrap ${i <= 2 ? 'text-left' : i === 3 ? 'text-center' : 'text-right'}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((row, i) => {
              const unpriced = row.pricingSource === 'none';
              const score = computeEffectiveScore(row.buzz_score, row.breakerz_score, row.player?.is_icon ?? false);
              const playerFlags = riskFlagMap.get(row.id) ?? [];
              const isEstimated = row.pricingSource === 'search-fallback' || row.pricingSource === 'cross-product' || row.pricingSource === 'default';

              return (
                <tr
                  key={row.id}
                  className="border-b last:border-0 transition-colors"
                  style={{
                    borderColor: 'var(--terminal-border)',
                    backgroundColor: i % 2 === 0 ? 'var(--terminal-surface)' : 'var(--terminal-bg)',
                    opacity: fetching ? 0.4 : 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--terminal-surface-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'var(--terminal-surface)' : 'var(--terminal-bg)')}
                >
                  {/* Rank */}
                  <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{i + 1}</td>

                  {/* Player */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{row.player.name}</span>
                      {row.player.is_rookie && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                          style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
                        >
                          RC
                        </span>
                      )}
                      {row.player.is_icon    && <IconPlayerBadge />}
                      {score > 0.1           && <BullishBadge />}
                      {score < -0.1          && <BearishBadge />}
                      {row.is_high_volatility && <HighVolatilityBadge />}
                      {playerFlags.map((f, fi) => (
                        <RiskFlagBadge key={fi} type={f.flagType} note={f.note} />
                      ))}
                    </div>
                  </td>

                  {/* Team */}
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{row.player.team}</td>

                  {/* Sets */}
                  <td className="px-4 py-2.5 text-center font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{row.total_sets}</td>

                  {unpriced ? (
                    Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-2.5 text-right">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatCurrency(row.evLow)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(row.evMid)}</span>
                          {isEstimated && (
                            <span
                              className="text-[9px] font-medium px-1 py-0.5 rounded border whitespace-nowrap"
                              title={`Estimated via ${row.pricingSource}`}
                              style={{
                                backgroundColor: 'rgba(245,158,11,0.1)',
                                color: 'var(--accent-orange)',
                                borderColor: 'rgba(245,158,11,0.3)',
                              }}
                            >
                              est
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatCurrency(row.evHigh)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {formatCurrency(breakType === 'hobby' ? row.hobbySlotCost : row.bdSlotCost)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs" style={{ color: 'var(--signal-buy)' }}>{formatCurrency(row.maxPay)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
