import { BreakConfig } from "@/lib/data";
import { formatCurrency } from "@/lib/engine";

interface DashboardConfigProps {
  config: BreakConfig;
  onChange: (config: BreakConfig) => void;
}

const DashboardConfig = ({ config, onChange }: DashboardConfigProps) => {
  const update = (key: keyof BreakConfig, value: number) => {
    onChange({ ...config, [key]: value });
  };

  const hobbyTotal = config.hobbyCases * config.hobbyCaseCost * (1 + config.breakerMargin);
  const bdTotal = config.bdCases * config.bdCaseCost * (1 + config.breakerMargin);

  return (
    <div className="card-pulse-gradient rounded-lg border border-border p-6 glow-primary">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
        <h2 className="text-lg font-semibold text-foreground">Break Configuration</h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <InputField label="Hobby Cases" value={config.hobbyCases} onChange={v => update('hobbyCases', v)} />
        <InputField label="BD Cases" value={config.bdCases} onChange={v => update('bdCases', v)} />
        <InputField label="Hobby Case Cost" value={config.hobbyCaseCost} onChange={v => update('hobbyCaseCost', v)} prefix="$" />
        <InputField label="BD Case Cost" value={config.bdCaseCost} onChange={v => update('bdCaseCost', v)} prefix="$" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <InputField label="Breaker Margin" value={config.breakerMargin * 100} onChange={v => update('breakerMargin', v / 100)} suffix="%" />
        <InputField label="eBay Fee Rate" value={config.ebayFeeRate * 100} onChange={v => update('ebayFeeRate', v / 100)} suffix="%" />
        <InputField label="Shipping/Card" value={config.shippingPerCard} onChange={v => update('shippingPerCard', v)} prefix="$" />
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Hobby Break Cost</p>
          <p className="text-2xl font-bold text-primary font-mono">{formatCurrency(hobbyTotal)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total BD Break Cost</p>
          <p className="text-2xl font-bold text-primary font-mono">{formatCurrency(bdTotal)}</p>
        </div>
      </div>
    </div>
  );
};

function InputField({ label, value, onChange, prefix, suffix }: {
  label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          style={{ paddingLeft: prefix ? '1.5rem' : undefined }}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

export default DashboardConfig;
