'use client';

import { formatCurrency, computeEffectiveScore } from '@/lib/engine';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import type { BreakFormat, PlayerWithPricing } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  players: PlayerWithPricing[];
  fetching?: boolean;
  viewFormat: BreakFormat;
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
  onPlayerClick?: (playerProductId: string) => void;
}

function pickSlot(row: PlayerWithPricing, fmt: BreakFormat): number {
  return fmt === 'hobby' ? row.hobbySlotCost
    : fmt === 'bd'       ? row.bdSlotCost
    :                      row.jumboSlotCost;
}

// Tailwind classes used to hide a column below a breakpoint. Kept consistent
// between <th> and <td> so the table stays well-formed when columns drop.
const HIDE_BELOW_SM = 'hidden sm:table-cell';
const HIDE_BELOW_MD = 'hidden md:table-cell';

const COLUMNS: Array<{
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
  hide?: string;
}> = [
  { key: 'rank',     label: '#',         align: 'left',  hide: HIDE_BELOW_SM },
  { key: 'player',   label: 'Player',    align: 'left'  },
  { key: 'team',     label: 'Team',      align: 'left',  hide: HIDE_BELOW_MD },
  { key: 'sets',     label: 'Sets',      align: 'center',hide: HIDE_BELOW_MD },
  { key: 'evLow',    label: 'EV Low',    align: 'right', hide: HIDE_BELOW_MD },
  { key: 'evMid',    label: 'EV Mid',    align: 'right', hide: HIDE_BELOW_SM },
  { key: 'evHigh',   label: 'EV High',   align: 'right', hide: HIDE_BELOW_MD },
  { key: 'slotCost', label: 'Slot Cost', align: 'right' },
  { key: 'maxPay',   label: 'Max Pay',   align: 'right', hide: HIDE_BELOW_SM },
];

export default function PlayerTable({ players, fetching = false, viewFormat, riskFlagMap = new Map(), onPlayerClick }: Props) {
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
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={`px-2 sm:px-4 py-2.5 terminal-label whitespace-nowrap text-${col.align} ${col.hide ?? ''}`}
                >
                  {col.label}
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
                  <td className={`px-2 sm:px-4 py-2.5 font-mono text-xs ${HIDE_BELOW_SM}`} style={{ color: 'var(--text-tertiary)' }}>{i + 1}</td>

                  {/* Player — always visible. Includes the team name on mobile
                      since the dedicated Team column is hidden below md. */}
                  <td className="px-2 sm:px-4 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {onPlayerClick ? (
                        <button
                          onClick={() => onPlayerClick(row.id)}
                          className="font-semibold whitespace-nowrap text-left transition-colors hover:underline"
                          style={{ color: 'var(--accent-blue)' }}
                        >
                          {row.player.name}
                        </button>
                      ) : (
                        <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{row.player.name}</span>
                      )}
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
                    {/* Team line shown only on mobile (where the team column is hidden) */}
                    <div className="md:hidden mt-0.5 text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {row.player.team}
                    </div>
                  </td>

                  {/* Team */}
                  <td className={`px-2 sm:px-4 py-2.5 text-xs whitespace-nowrap ${HIDE_BELOW_MD}`} style={{ color: 'var(--text-secondary)' }}>{row.player.team}</td>

                  {/* Sets */}
                  <td className={`px-2 sm:px-4 py-2.5 text-center font-mono text-xs ${HIDE_BELOW_MD}`} style={{ color: 'var(--text-secondary)' }}>{row.total_sets}</td>

                  {unpriced ? (
                    <>
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_MD}`}>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_SM}`}>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_MD}`}>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                      <td className="px-2 sm:px-4 py-2.5 text-right">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_SM}`}>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className={`px-2 sm:px-4 py-2.5 text-right font-mono text-xs ${HIDE_BELOW_MD}`} style={{ color: 'var(--text-tertiary)' }}>{formatCurrency(row.evLow)}</td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_SM}`}>
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
                      <td className={`px-2 sm:px-4 py-2.5 text-right font-mono text-xs ${HIDE_BELOW_MD}`} style={{ color: 'var(--text-tertiary)' }}>{formatCurrency(row.evHigh)}</td>
                      <td className="px-2 sm:px-4 py-2.5 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        {formatCurrency(pickSlot(row, viewFormat))}
                      </td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right font-mono text-xs ${HIDE_BELOW_SM}`} style={{ color: 'var(--signal-buy)' }}>{formatCurrency(row.maxPay)}</td>
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
