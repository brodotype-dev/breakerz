'use client';

import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/engine';
import type { BreakConfig } from '@/lib/types';

interface Props {
  config: BreakConfig;
  onChange: (config: BreakConfig) => void;
}

export default function DashboardConfig({ config, onChange }: Props) {
  const update = (key: keyof BreakConfig, value: number) => {
    onChange({ ...config, [key]: value });
  };

  const hobbyTotal = config.hobbyCases * config.hobbyCaseCost * (1 + config.breakerMargin);
  const bdTotal = config.bdCases * config.bdCaseCost * (1 + config.breakerMargin);

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-5">Break Configuration</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Field label="Hobby Cases" value={config.hobbyCases} onChange={v => update('hobbyCases', v)} />
        <Field label="BD Cases" value={config.bdCases} onChange={v => update('bdCases', v)} />
        <Field label="Hobby Case Cost" value={config.hobbyCaseCost} onChange={v => update('hobbyCaseCost', v)} prefix="$" />
        <Field label="BD Case Cost" value={config.bdCaseCost} onChange={v => update('bdCaseCost', v)} prefix="$" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <Field label="Breaker Margin" value={config.breakerMargin * 100} onChange={v => update('breakerMargin', v / 100)} suffix="%" />
        <Field label="eBay Fee Rate" value={config.ebayFeeRate * 100} onChange={v => update('ebayFeeRate', v / 100)} suffix="%" />
        <Field label="Shipping / Card" value={config.shippingPerCard} onChange={v => update('shippingPerCard', v)} prefix="$" />
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Hobby Break Cost</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(hobbyTotal)}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total BD Break Cost</p>
          <p className="text-2xl font-bold font-mono">{formatCurrency(bdTotal)}</p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, prefix, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm z-10">{prefix}</span>}
        <Input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="font-mono"
          style={{ paddingLeft: prefix ? '1.5rem' : undefined, paddingRight: suffix ? '1.75rem' : undefined }}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{suffix}</span>}
      </div>
    </div>
  );
}
