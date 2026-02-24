import { SlotPricing } from "@/lib/data";
import { formatCurrency } from "@/lib/engine";

interface PlayerTableProps {
  pricing: SlotPricing[];
}

const tierColors: Record<string, string> = {
  "S🔥": "bg-[hsl(15,90%,55%)]",
  "S": "bg-[hsl(42,90%,55%)]",
  "A+": "bg-[hsl(48,80%,50%)]",
  "A": "bg-[hsl(200,70%,55%)]",
  "A-": "bg-[hsl(200,50%,45%)]",
  "B+": "bg-[hsl(220,30%,55%)]",
  "B": "bg-[hsl(220,20%,45%)]",
  "C": "bg-[hsl(220,10%,40%)]",
};

const PlayerTable = ({ pricing }: PlayerTableProps) => {
  return (
    <div className="card-pulse-gradient rounded-lg border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Player Slot Pricing</h2>
        <span className="text-xs text-muted-foreground font-mono">{pricing.length} players</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {["#", "Player", "Team", "Tier", "EV Mid", "H Sets", "BD Sets", "Hobby Slot", "BD Slot", "Total", "Max Pay"].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pricing.map((row, i) => (
              <tr key={row.player.name} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                <td className="px-3 py-2 data-cell text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-sm font-medium text-foreground">
                  {row.player.name}
                  {row.player.isRookie && <span className="ml-1.5 text-[10px] text-primary font-bold">RC</span>}
                  {row.player.evOverride && <span className="ml-1 text-[10px] text-signal-watch">⚡</span>}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.player.team}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-background ${tierColors[row.player.tier] || 'bg-muted'}`}>
                    {row.player.tier}
                  </span>
                </td>
                <td className="px-3 py-2 data-cell text-foreground">{formatCurrency(row.player.evMid)}</td>
                <td className="px-3 py-2 data-cell text-muted-foreground">{row.player.hobbySets}</td>
                <td className="px-3 py-2 data-cell text-muted-foreground">{row.player.bdOnlySets}</td>
                <td className="px-3 py-2 data-cell text-foreground">{formatCurrency(row.hobbySlotCost)}</td>
                <td className="px-3 py-2 data-cell text-foreground">{formatCurrency(row.bdSlotCost)}</td>
                <td className="px-3 py-2 data-cell font-semibold text-primary">{formatCurrency(row.totalCost)}</td>
                <td className="px-3 py-2 data-cell text-muted-foreground">{formatCurrency(row.maxPay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PlayerTable;
