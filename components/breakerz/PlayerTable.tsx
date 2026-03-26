'use client';

import { formatCurrency, computeEffectiveScore } from '@/lib/engine';
import type { PlayerWithPricing } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

const FLAG_COLORS: Record<string, string> = {
  injury:     'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  suspension: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  legal:      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  trade:      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  retirement: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  off_field:  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
};
const FLAG_LABELS: Record<string, string> = {
  injury: 'Injury', suspension: 'Suspension', legal: 'Legal',
  trade: 'Trade', retirement: 'Retirement', off_field: 'Off-field',
};

interface Props {
  players: PlayerWithPricing[];
  fetching?: boolean;
  breakType: 'hobby' | 'bd';
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
}

export default function PlayerTable({ players, fetching = false, breakType, riskFlagMap = new Map() }: Props) {
  if (players.length === 0) {
    return (
      <div className="rounded border p-12 text-center text-muted-foreground bg-card">
        No players found for this product.
      </div>
    );
  }

  return (
    <div className="bg-card border rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[oklch(0.28_0.08_250)] text-white">
              {['#', 'Player', 'Team', 'Sets', 'EV Low', 'EV Mid', 'EV High', 'Slot Cost', 'Max Pay'].map((h, i) => (
                <th
                  key={h}
                  className={`px-4 py-2.5 text-[10px] uppercase tracking-widest font-bold whitespace-nowrap ${
                    i <= 2 ? 'text-left' : i === 3 ? 'text-center' : 'text-right'
                  }`}
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
              return (
                <tr
                  key={row.id}
                  className={`border-b last:border-0 transition-colors ${
                    fetching ? 'opacity-40' : 'hover:bg-secondary/50'
                  } ${i % 2 === 0 ? 'bg-card' : 'bg-background'}`}
                >
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{i + 1}</td>

                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold whitespace-nowrap">{row.player.name}</span>
                      {row.player.is_rookie && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-[var(--topps-red)] text-white shrink-0">
                          RC
                        </span>
                      )}
                      {row.player.is_icon && (
                        <span title="Icon-tier player — structural demand baked into EV" className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 shrink-0">★</span>
                      )}
                      {score > 0.1 && (
                        <span title={`Breakerz bullish (+${score.toFixed(2)})`} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 shrink-0">↑</span>
                      )}
                      {score < -0.1 && (
                        <span title={`Breakerz bearish (${score.toFixed(2)})`} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 shrink-0">↓</span>
                      )}
                      {row.is_high_volatility && (
                        <span title="High Volatility — pricing is unusually uncertain" className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 shrink-0">⚡</span>
                      )}
                      {playerFlags.map((f, fi) => (
                        <span key={fi} title={f.note} className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${FLAG_COLORS[f.flagType] ?? 'bg-red-100 text-red-700'}`}>
                          {FLAG_LABELS[f.flagType] ?? f.flagType}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{row.player.team}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs">{row.total_sets}</td>

                  {unpriced ? (
                    Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-2.5 text-right">
                        <span className="text-muted-foreground/30 font-mono text-xs">—</span>
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(row.evLow)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-sm font-bold">{formatCurrency(row.evMid)}</span>
                          {(row.pricingSource === 'search-fallback' || row.pricingSource === 'cross-product' || row.pricingSource === 'default') && (
                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border border-amber-300 dark:border-amber-700 whitespace-nowrap" title={`Estimated via ${row.pricingSource}`}>
                              est
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(row.evHigh)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">
                        {formatCurrency(breakType === 'hobby' ? row.hobbySlotCost : row.bdSlotCost)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(row.maxPay)}</td>
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
