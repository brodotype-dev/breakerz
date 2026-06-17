'use client';

import { formatCurrency, computeEffectiveScore, confidenceTier } from '@/lib/engine';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import ChaseHeartButton, { ChaseSetProvider } from '@/components/breakiq/ChaseHeartButton';
import PricingFeedback from '@/components/breakiq/PricingFeedback';
import { InfoTip, ProspectRankChip } from '@/components/breakiq/ds';
import type { BreakFormat, PlayerWithPricing } from '@/lib/types';
import type { PlayerPypResult } from '@/lib/player-pyp-pricing';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  players: PlayerWithPricing[];
  fetching?: boolean;
  viewFormat: BreakFormat;
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
  onPlayerClick?: (playerProductId: string) => void;
  productId?: string | null;
  // Plan B: lifecycle-aware market markup applied to slot cost at display.
  // 1 = no markup (model EV shown as-is). Caller resolves via getMarketMarkup().
  marketMarkup?: number;
  /**
   * Per-player PYP (Pick Your Player) slot-price predictions for the
   * current break configuration. When provided AND showPyp is true, the
   * table renders a "PYP slot" column with the market price + a small
   * P(zero hits) chip. See lib/player-pyp-pricing.ts for the math.
   */
  pypByPlayerProductId?: Map<string, PlayerPypResult>;
  /**
   * Whether to render the PYP column. Caller should set this only when the
   * product publishes per-variant odds densely enough that PYP predictions
   * are meaningful (oddsCoverageOk from computePlayerPyp).
   */
  showPyp?: boolean;
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

type ColumnDef = {
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
  hide?: string;
  tip?: string;
};

const BASE_COLUMNS: ColumnDef[] = [
  { key: 'rank',     label: '#',         align: 'left',  hide: HIDE_BELOW_SM },
  { key: 'player',   label: 'Player',    align: 'left'  },
  { key: 'team',     label: 'Team',      align: 'left',  hide: HIDE_BELOW_MD },
  { key: 'sets',     label: 'Sets',      align: 'center',hide: HIDE_BELOW_MD },
  { key: 'evLow',    label: 'EV Low',    align: 'right', hide: HIDE_BELOW_MD, tip: 'Estimated value at Raw / Ungraded — what the card sells for ungraded.' },
  { key: 'evMid',    label: 'EV Mid',    align: 'right', hide: HIDE_BELOW_SM, tip: 'Estimated value at PSA 9 — the most-traded grade for modern cards.' },
  { key: 'evHigh',   label: 'EV High',   align: 'right', hide: HIDE_BELOW_MD, tip: 'Estimated value at PSA 10 — the upside case if the card grades clean.' },
  { key: 'slotCost', label: 'Slot Cost', align: 'right' },
  { key: 'maxPay',   label: 'Max Pay',   align: 'right', hide: HIDE_BELOW_SM, tip: "Highest price we'd call a fair buy — slot cost × 1.5." },
  { key: 'feedback', label: '',          align: 'right' },
];

const PYP_COLUMN: ColumnDef = {
  key: 'pyp',
  label: 'PYP',
  align: 'right',
  tip:
    "Pick-Your-Player slot price. Fair-value: expected $ of this player's autograph pulls across your configured break, marked up for the live-product window. The chip shows P(zero hits) — anything ≳25% is a real lottery, anything ≲5% is near-certainty.",
};

/** Insert the PYP column right after Slot Cost when active. */
function buildColumns(showPyp: boolean): ColumnDef[] {
  if (!showPyp) return BASE_COLUMNS;
  const idx = BASE_COLUMNS.findIndex(c => c.key === 'slotCost');
  return [
    ...BASE_COLUMNS.slice(0, idx + 1),
    PYP_COLUMN,
    ...BASE_COLUMNS.slice(idx + 1),
  ];
}

export default function PlayerTable({
  players,
  fetching = false,
  viewFormat,
  riskFlagMap = new Map(),
  onPlayerClick,
  productId = null,
  marketMarkup = 1,
  pypByPlayerProductId,
  showPyp = false,
}: Props) {
  const showMarketMarkup = marketMarkup !== 1;
  const columns = buildColumns(showPyp);
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
    <ChaseSetProvider playerIds={players.map(p => p.player.id).filter(Boolean) as string[]}>
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-2 sm:px-4 py-2.5 terminal-label whitespace-nowrap text-${col.align} ${col.hide ?? ''}`}
                >
                  {col.label}
                  {col.tip && <InfoTip text={col.tip} placement="bottom" />}
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
              // Bucket CH confidence into named tiers (Strong/Solid/Stale/Cold).
              // Skipped on fallback-priced rows since they don't have a modeled
              // confidence — the `est` chip already signals that case.
              const confInfo = !isEstimated ? confidenceTier(row.confidence) : null;

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
                      {row.player?.id && <ChaseHeartButton playerId={row.player.id} />}
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
                      <ProspectRankChip
                        rank={row.player.prospect_rank}
                        source={row.player.prospect_rank_source}
                        updatedAt={row.player.prospect_rank_updated_at}
                      />
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
                      {showPyp && (
                        <td className="px-2 sm:px-4 py-2.5 text-right">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                        </td>
                      )}
                      <td className={`px-2 sm:px-4 py-2.5 text-right ${HIDE_BELOW_SM}`}>
                        <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                      </td>
                      <td className="px-2 sm:px-4 py-2.5 text-right">
                        <PricingFeedback
                          surface="player_row"
                          entityType="player_product"
                          entityId={row.id}
                          productId={productId}
                        />
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
                          {confInfo && (
                            <span
                              className="text-[9px] font-medium px-1 py-0.5 rounded border whitespace-nowrap"
                              title={`CardHedger confidence: ${(row.confidence! * 100).toFixed(0)}%`}
                              style={{
                                backgroundColor: confInfo.bg,
                                color: confInfo.fg,
                                borderColor: confInfo.border,
                              }}
                            >
                              {confInfo.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-2 sm:px-4 py-2.5 text-right font-mono text-xs ${HIDE_BELOW_MD}`} style={{ color: 'var(--text-tertiary)' }}>{formatCurrency(row.evHigh)}</td>
                      <td className="px-2 sm:px-4 py-2.5 text-right">
                        {(() => {
                          const modelSlot = pickSlot(row, viewFormat);
                          const marketSlot = modelSlot * marketMarkup;
                          return (
                            <div className="flex flex-col items-end leading-tight">
                              <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                {formatCurrency(marketSlot)}
                              </span>
                              {showMarketMarkup && modelSlot > 0 && (
                                <span className="font-mono text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                  model {formatCurrency(modelSlot)}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      {showPyp && (() => {
                        const pyp = pypByPlayerProductId?.get(row.id);
                        if (!pyp) {
                          return (
                            <td className="px-2 sm:px-4 py-2.5 text-right">
                              <span className="font-mono text-xs" style={{ color: 'var(--text-disabled)' }}>—</span>
                            </td>
                          );
                        }
                        // P(zero hits) bucketed for color/messaging. Mirrors the
                        // confidence-tier spectrum used elsewhere in the row.
                        const p0pct = pyp.pZeroHits * 100;
                        const isLottery = p0pct >= 25;
                        const chipColor = p0pct >= 50
                          ? { bg: 'rgba(239,68,68,0.12)', fg: 'var(--signal-pass)',  border: 'rgba(239,68,68,0.35)' }
                          : p0pct >= 25
                          ? { bg: 'rgba(245,158,11,0.12)', fg: 'var(--accent-orange)', border: 'rgba(245,158,11,0.35)' }
                          : { bg: 'rgba(34,197,94,0.10)',  fg: 'var(--signal-buy)',   border: 'rgba(34,197,94,0.30)' };
                        return (
                          <td className="px-2 sm:px-4 py-2.5 text-right">
                            <div className="flex flex-col items-end leading-tight gap-0.5">
                              <span className="font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                {formatCurrency(pyp.pypMarket)}
                              </span>
                              <span
                                className="text-[9px] font-medium px-1 py-0.5 rounded border whitespace-nowrap"
                                title={`Expected hits across the configured break: ${pyp.expectedHits.toFixed(2)}. Poisson P(zero) = ${p0pct.toFixed(1)}%. ${isLottery ? 'Lottery-shaped slot — buyers often pay above fair value for the upside.' : 'Near-certainty hit.'}`}
                                style={{
                                  backgroundColor: chipColor.bg,
                                  color: chipColor.fg,
                                  borderColor: chipColor.border,
                                }}
                              >
                                P(0) {p0pct.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        );
                      })()}
                      <td className={`px-2 sm:px-4 py-2.5 text-right font-mono text-xs ${HIDE_BELOW_SM}`} style={{ color: 'var(--signal-buy)' }}>{formatCurrency(row.maxPay)}</td>
                      <td className="px-2 sm:px-4 py-2.5 text-right">
                        <PricingFeedback
                          surface="player_row"
                          entityType="player_product"
                          entityId={row.id}
                          productId={productId}
                        />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </ChaseSetProvider>
  );
}
