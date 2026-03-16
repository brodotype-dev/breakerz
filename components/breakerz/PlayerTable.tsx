'use client';

import { formatCurrency } from '@/lib/engine';
import type { PlayerWithPricing } from '@/lib/types';

interface Props {
  players: PlayerWithPricing[];
  fetching?: boolean;
}

export default function PlayerTable({ players, fetching = false }: Props) {
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
              {['#', 'Player', 'Team', 'Sets', 'EV Low', 'EV Mid', 'EV High', 'Hobby Slot', 'BD Slot', 'Total', 'Max Pay'].map((h, i) => (
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
              return (
                <tr
                  key={row.id}
                  className={`border-b last:border-0 transition-colors ${
                    fetching ? 'opacity-40' : 'hover:bg-secondary/50'
                  } ${i % 2 === 0 ? 'bg-card' : 'bg-background'}`}
                >
                  <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{i + 1}</td>

                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold whitespace-nowrap">{row.player.name}</span>
                      {row.player.is_rookie && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-[var(--topps-red)] text-white shrink-0">
                          RC
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">{row.player.team}</td>
                  <td className="px-4 py-2.5 text-center font-mono text-xs">{row.total_sets}</td>

                  {unpriced ? (
                    Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-2.5 text-right">
                        <span className="text-muted-foreground/30 font-mono text-xs">—</span>
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(row.evLow)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{formatCurrency(row.evMid)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatCurrency(row.evHigh)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(row.hobbySlotCost)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{formatCurrency(row.bdSlotCost)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm font-bold">{formatCurrency(row.totalCost)}</td>
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
