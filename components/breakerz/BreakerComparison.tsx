'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { computeSignal, formatCurrency, formatPct } from '@/lib/engine';
import type { PlayerWithPricing, Signal } from '@/lib/types';

interface Props {
  players: PlayerWithPricing[];
}

export default function BreakerComparison({ players }: Props) {
  const top = players.slice(0, 30);
  const [asks, setAsks] = useState<Record<string, number>>({});

  const updateAsk = (id: string, value: number) => {
    setAsks(prev => ({ ...prev, [id]: value }));
  };

  const results = useMemo(() => {
    return top.map(row => {
      const ask = asks[row.id] || 0;
      const { valuePct, signal } = ask > 0
        ? computeSignal(row.evMid, ask)
        : { valuePct: 0, signal: 'WATCH' as Signal };
      return { ...row, ask, valuePct, signal, hasInput: ask > 0 };
    });
  }, [top, asks]);

  const totalAsk = Object.values(asks).reduce((s, v) => s + v, 0);

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h2 className="text-lg font-semibold">Breaker Comparison</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Enter a breaker&apos;s asking price to get BUY / WATCH / PASS signals
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {['Player', 'EV Mid', 'Model Slot', 'Breaker Ask', 'Value %', 'Signal'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map(row => (
              <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">
                  {row.player.name}
                  {row.player.is_rookie && (
                    <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-primary border-primary">RC</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono">{formatCurrency(row.evMid)}</td>
                <td className="px-4 py-2.5 font-mono">{formatCurrency(row.totalCost)}</td>
                <td className="px-4 py-2.5 w-32">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <Input
                      type="number"
                      placeholder="—"
                      value={row.ask || ''}
                      onChange={e => updateAsk(row.id, parseFloat(e.target.value) || 0)}
                      className="pl-6 h-8 text-xs font-mono w-28"
                    />
                  </div>
                </td>
                <td className="px-4 py-2.5 font-mono">
                  {row.hasInput ? (
                    <span className={
                      row.valuePct >= 30 ? 'text-green-600 font-semibold' :
                      row.valuePct >= 0 ? 'text-yellow-600 font-semibold' :
                      'text-red-500 font-semibold'
                    }>
                      {formatPct(row.valuePct)}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {row.hasInput
                    ? <SignalBadge signal={row.signal} />
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {totalAsk > 0 && (
            <tfoot>
              <tr className="border-t bg-muted/20">
                <td colSpan={3} className="px-4 py-3 text-sm font-semibold">Total Budget</td>
                <td className="px-4 py-3 font-mono font-bold">{formatCurrency(totalAsk)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: Signal }) {
  const styles: Record<Signal, string> = {
    BUY: 'bg-green-500/15 text-green-600 border-0',
    WATCH: 'bg-yellow-500/15 text-yellow-600 border-0',
    PASS: 'bg-red-500/15 text-red-500 border-0',
  };
  return <Badge className={`text-xs font-bold ${styles[signal]}`}>{signal}</Badge>;
}
