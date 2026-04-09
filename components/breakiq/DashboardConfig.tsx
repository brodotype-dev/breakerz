'use client';

import { formatCurrency } from '@/lib/engine';
import { ElevatedCard, FormLabel, CounterInput } from '@/components/breakiq/ds';
import type { BreakConfig } from '@/lib/types';

interface Props {
  config: BreakConfig;
  onChange: (config: BreakConfig) => void;
  breakType: 'hobby' | 'bd';
}

export default function DashboardConfig({ config, onChange, breakType }: Props) {
  const update = (key: keyof BreakConfig, value: number) =>
    onChange({ ...config, [key]: value });

  const total = breakType === 'hobby'
    ? config.hobbyCases * config.hobbyCaseCost
    : config.bdCases * config.bdCaseCost;

  const totalLabel = breakType === 'hobby' ? 'Total Hobby Break' : 'Total BD Break';

  return (
    <ElevatedCard>
      <p className="terminal-label mb-5">Break Configuration</p>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {breakType === 'hobby' ? (
          <>
            <div>
              <FormLabel>Hobby Cases</FormLabel>
              <CounterInput value={config.hobbyCases} onChange={v => update('hobbyCases', v)} min={1} />
            </div>
            <div>
              <FormLabel>Hobby / Case</FormLabel>
              <CostInput value={config.hobbyCaseCost} onChange={v => update('hobbyCaseCost', v)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <FormLabel>BD Cases</FormLabel>
              <CounterInput value={config.bdCases} onChange={v => update('bdCases', v)} min={1} />
            </div>
            <div>
              <FormLabel>BD / Case</FormLabel>
              <CostInput value={config.bdCaseCost} onChange={v => update('bdCaseCost', v)} />
            </div>
          </>
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

function CostInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <span
        className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono pointer-events-none z-10"
        style={{ color: 'var(--text-tertiary)' }}
      >
        $
      </span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-lg border text-sm font-mono focus:outline-none"
        style={{
          backgroundColor: 'var(--terminal-bg)',
          borderColor: 'var(--terminal-border)',
          color: 'var(--text-primary)',
          paddingLeft: '1.5rem',
          paddingRight: '0.75rem',
          paddingTop: '0.625rem',
          paddingBottom: '0.625rem',
        }}
        onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
        onBlur={e => (e.target.style.borderColor = 'var(--terminal-border)')}
      />
    </div>
  );
}
