'use client';

import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/engine';
import type { BreakConfig } from '@/lib/types';

interface Props {
  config: BreakConfig;
  onChange: (config: BreakConfig) => void;
}

export default function DashboardConfig({ config, onChange }: Props) {
  const update = (key: keyof BreakConfig, value: number) =>
    onChange({ ...config, [key]: value });

  const hobbyTotal = config.hobbyCases * config.hobbyCaseCost * (1 + config.breakerMargin);
  const bdTotal = config.bdCases * config.bdCaseCost * (1 + config.breakerMargin);

  return (
    <div className="bg-card border rounded overflow-hidden">
      {/* Heritage accent stripe */}
      <div className="h-1 bg-[oklch(0.28_0.08_250)]" />

      <div className="p-5">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground mb-4">
          Break Configuration
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <Field label="Hobby Cases"    value={config.hobbyCases}    onChange={v => update('hobbyCases', v)} />
          <Field label="BD Cases"       value={config.bdCases}       onChange={v => update('bdCases', v)} />
          <Field label="Hobby / Case"   value={config.hobbyCaseCost} onChange={v => update('hobbyCaseCost', v)} prefix="$" />
          <Field label="BD / Case"      value={config.bdCaseCost}    onChange={v => update('bdCaseCost', v)} prefix="$" />
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <Field label="Breaker Margin" value={config.breakerMargin * 100} onChange={v => update('breakerMargin', v / 100)} suffix="%" />
          <Field label="eBay Fee"       value={config.ebayFeeRate * 100}   onChange={v => update('ebayFeeRate', v / 100)} suffix="%" />
          <Field label="Shipping / Card" value={config.shippingPerCard}    onChange={v => update('shippingPerCard', v)} prefix="$" />
        </div>

        {/* Totals — Heritage banner style */}
        <div className="grid grid-cols-2 gap-3 border-t pt-4">
          <div className="rounded bg-secondary px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Total Hobby Break</p>
            <p className="text-xl font-black font-mono">{formatCurrency(hobbyTotal)}</p>
          </div>
          <div className="rounded bg-secondary px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Total BD Break</p>
            <p className="text-xl font-black font-mono">{formatCurrency(bdTotal)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, prefix, suffix }: {
  label: string; value: number; onChange: (v: number) => void; prefix?: string; suffix?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none z-10">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="font-mono text-sm bg-background"
          style={{ paddingLeft: prefix ? '1.5rem' : undefined, paddingRight: suffix ? '1.75rem' : undefined }}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
