'use client';

import { formatCurrency } from '@/lib/engine';
import { ElevatedCard, FormLabel, CounterInput } from '@/components/breakiq/ds';
import type { BreakConfig } from '@/lib/types';

interface Props {
  config: BreakConfig;
  onChange: (config: BreakConfig) => void;
  breakType: 'hobby' | 'bd';
  hobbyMsrp?: number | null;
  hobbyAmPrice?: number | null;
  bdMsrp?: number | null;
  bdAmPrice?: number | null;
}

export default function DashboardConfig({ config, onChange, breakType, hobbyMsrp, hobbyAmPrice, bdMsrp, bdAmPrice }: Props) {
  const update = (key: keyof BreakConfig, value: number) =>
    onChange({ ...config, [key]: value });

  const cases = breakType === 'hobby' ? config.hobbyCases : config.bdCases;
  const casesKey = breakType === 'hobby' ? 'hobbyCases' : 'bdCases';
  const casePrice = breakType === 'hobby' ? config.hobbyCaseCost : config.bdCaseCost;
  const amPrice = breakType === 'hobby' ? hobbyAmPrice : bdAmPrice;
  const msrp = breakType === 'hobby' ? hobbyMsrp : bdMsrp;
  const total = cases * casePrice;
  const totalLabel = breakType === 'hobby' ? 'Total Hobby Break' : 'Total BD Break';

  const priceLabel = amPrice != null ? 'market' : msrp != null ? 'MSRP' : null;

  return (
    <ElevatedCard>
      <p className="terminal-label mb-5">Break Configuration</p>

      <div className="mb-6">
        <FormLabel>{breakType === 'hobby' ? 'Hobby Cases' : 'BD Cases'}</FormLabel>
        <CounterInput value={cases} onChange={v => update(casesKey, v)} min={1} />
        {casePrice > 0 && (
          <p className="mt-1.5 text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
            at {formatCurrency(casePrice)}/case
            {priceLabel && (
              <span
                className="ml-1"
                style={{ color: amPrice != null ? 'var(--accent-orange)' : 'var(--text-disabled)' }}
              >
                ({priceLabel})
              </span>
            )}
          </p>
        )}
      </div>

      <div className="border-t pt-5" style={{ borderColor: 'var(--terminal-border)' }}>
        <div className="rounded-lg px-4 py-3" style={{ backgroundColor: 'var(--terminal-bg)' }}>
          <p className="terminal-label mb-1">{totalLabel}</p>
          <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
            {formatCurrency(total)}
          </p>
        </div>
      </div>
    </ElevatedCard>
  );
}
