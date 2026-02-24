import { useState, useMemo } from "react";
import { SlotPricing } from "@/lib/data";
import { computeSignal, formatCurrency, formatPct } from "@/lib/engine";

interface BreakerComparisonProps {
  pricing: SlotPricing[];
}

const BreakerComparison = ({ pricing }: BreakerComparisonProps) => {
  const top = pricing.slice(0, 20);
  const [asks, setAsks] = useState<Record<string, number>>({});

  const updateAsk = (name: string, value: number) => {
    setAsks(prev => ({ ...prev, [name]: value }));
  };

  const results = useMemo(() => {
    return top.map(row => {
      const ask = asks[row.player.name] || 0;
      const { valuePct, signal } = ask > 0
        ? computeSignal(row.player.evMid, ask)
        : { valuePct: 0, signal: 'WATCH' as const };
      return { ...row, ask, valuePct, signal, hasInput: ask > 0 };
    });
  }, [top, asks]);

  const totalAsk = Object.values(asks).reduce((s, v) => s + v, 0);

  return (
    <div className="card-pulse-gradient rounded-lg border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Breaker Comparison Tool</h2>
        <p className="text-xs text-muted-foreground mt-1">Enter a breaker's asking price to get BUY / WATCH / PASS signals</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {["Player", "Tier", "EV Mid", "Model Slot", "Breaker Ask", "Value %", "Signal"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.player.name} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                <td className="px-4 py-2.5 text-sm font-medium text-foreground">
                  {row.player.name}
                  {row.player.isRookie && <span className="ml-1.5 text-[10px] text-primary font-bold">RC</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.player.tier}</td>
                <td className="px-4 py-2.5 data-cell text-foreground">{formatCurrency(row.player.evMid)}</td>
                <td className="px-4 py-2.5 data-cell text-foreground">{formatCurrency(row.totalCost)}</td>
                <td className="px-4 py-2.5">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                    <input
                      type="number"
                      placeholder="—"
                      value={row.ask || ''}
                      onChange={e => updateAsk(row.player.name, parseFloat(e.target.value) || 0)}
                      className="w-24 bg-input border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring pl-5"
                    />
                  </div>
                </td>
                <td className="px-4 py-2.5 data-cell">
                  {row.hasInput ? (
                    <span className={row.valuePct >= 30 ? 'signal-buy' : row.valuePct >= 0 ? 'signal-watch' : 'signal-pass'}>
                      {formatPct(row.valuePct)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {row.hasInput ? (
                    <span className={`inline-block px-2.5 py-1 rounded text-xs font-bold ${
                      row.signal === 'BUY' ? 'signal-buy-bg signal-buy' :
                      row.signal === 'WATCH' ? 'signal-watch-bg signal-watch' :
                      'signal-pass-bg signal-pass'
                    }`}>
                      {row.signal}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {totalAsk > 0 && (
            <tfoot>
              <tr className="border-t border-border bg-secondary/20">
                <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-foreground">Total Budget</td>
                <td className="px-4 py-3 data-cell font-bold text-primary">{formatCurrency(totalAsk)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default BreakerComparison;
