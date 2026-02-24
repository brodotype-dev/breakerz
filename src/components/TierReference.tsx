import { TIER_TABLE } from "@/lib/data";
import { formatCurrency } from "@/lib/engine";

const TierReference = () => {
  return (
    <div className="card-pulse-gradient rounded-lg border border-border p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Tier EV Benchmarks</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIER_TABLE.map(t => (
          <div key={t.tier} className="bg-secondary/30 rounded-md p-3 border border-border/50">
            <div className="text-sm font-bold text-foreground mb-1">{t.tier}</div>
            <div className="space-y-0.5">
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Low</span>
                <span className="font-mono text-muted-foreground">{formatCurrency(t.evLow)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-primary font-medium">Mid</span>
                <span className="font-mono text-primary font-semibold">{formatCurrency(t.evMid)}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">High</span>
                <span className="font-mono text-muted-foreground">{formatCurrency(t.evHigh)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TierReference;
