'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { computeSignal, formatCurrency, formatPct } from '@/lib/engine';
import type { PlayerWithPricing, Signal } from '@/lib/types';

interface Props {
  players: PlayerWithPricing[];
}

export default function BreakerComparison({ players }: Props) {
  const top = players.slice(0, 30);
  const [asks, setAsks] = useState<Record<string, number>>({});

  const results = useMemo(() => top.map(row => {
    const ask = asks[row.id] || 0;
    const { valuePct, signal } = ask > 0
      ? computeSignal(row.evMid, ask)
      : { valuePct: 0, signal: 'WATCH' as Signal };
    return { ...row, ask, valuePct, signal, hasInput: ask > 0 };
  }), [top, asks]);

  const totalAsk = Object.values(asks).reduce((s, v) => s + v, 0);

  const buyCount  = results.filter(r => r.hasInput && r.signal === 'BUY').length;
  const watchCount = results.filter(r => r.hasInput && r.signal === 'WATCH').length;
  const passCount = results.filter(r => r.hasInput && r.signal === 'PASS').length;

  return (
    <div className="bg-card border rounded overflow-hidden">
      {/* Summary bar — only shown once any ask is entered */}
      {totalAsk > 0 && (
        <div className="border-b px-6 py-3 flex items-center justify-between gap-4 bg-secondary/40">
          <div className="flex items-center gap-4 text-xs">
            {buyCount > 0 && (
              <span className="signal-buy font-bold">{buyCount} BUY</span>
            )}
            {watchCount > 0 && (
              <span className="signal-watch font-bold">{watchCount} WATCH</span>
            )}
            {passCount > 0 && (
              <span className="signal-pass font-bold">{passCount} PASS</span>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Ask</p>
            <p className="font-mono font-bold text-sm">{formatCurrency(totalAsk)}</p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[oklch(0.28_0.08_250)] text-white">
              {['Player', 'EV Mid', 'Model Slot', 'Breaker Ask', 'Value %', 'Signal'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] uppercase tracking-widest font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((row, i) => (
              <tr
                key={row.id}
                className={`border-b last:border-0 hover:bg-secondary/40 transition-colors ${
                  i % 2 === 0 ? 'bg-card' : 'bg-background'
                }`}
              >
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

                <td className="px-4 py-2.5 font-mono text-sm font-bold">
                  {row.evMid > 0 ? formatCurrency(row.evMid) : <span className="text-muted-foreground/30">—</span>}
                </td>

                <td className="px-4 py-2.5 font-mono text-xs">
                  {row.totalCost > 0 ? formatCurrency(row.totalCost) : <span className="text-muted-foreground/30">—</span>}
                </td>

                <td className="px-4 py-2.5 w-36">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
                    <Input
                      type="number"
                      placeholder="—"
                      value={row.ask || ''}
                      onChange={e => setAsks(prev => ({ ...prev, [row.id]: parseFloat(e.target.value) || 0 }))}
                      className="pl-6 h-8 text-xs font-mono w-28 bg-background"
                    />
                  </div>
                </td>

                <td className="px-4 py-2.5 font-mono text-xs">
                  {row.hasInput ? (
                    <span className={
                      row.signal === 'BUY' ? 'signal-buy font-bold' :
                      row.signal === 'WATCH' ? 'signal-watch font-bold' :
                      'signal-pass font-bold'
                    }>
                      {formatPct(row.valuePct)}
                    </span>
                  ) : <span className="text-muted-foreground/30">—</span>}
                </td>

                <td className="px-4 py-2.5">
                  {row.hasInput ? <SignalBadge signal={row.signal} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: Signal }) {
  const cls = signal === 'BUY'
    ? 'signal-buy-badge'
    : signal === 'WATCH'
    ? 'signal-watch-badge'
    : 'signal-pass-badge';
  return (
    <span className={`inline-block px-2.5 py-1 rounded text-[10px] uppercase tracking-wider ${cls}`}>
      {signal}
    </span>
  );
}
