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

  const total = breakType === 'hobby'
    ? config.hobbyCases * config.hobbyCaseCost
    : config.bdCases * config.bdCaseCost;

  const totalLabel = breakType === 'hobby' ? 'Total Hobby Break' : 'Total BD Break';

  const msrp = breakType === 'hobby' ? hobbyMsrp : bdMsrp;
  const amPrice = breakType === 'hobby' ? hobbyAmPrice : bdAmPrice;
  const showRef = msrp != null || amPrice != null;

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
              <FormLabel>Your Cost / Case</FormLabel>
              <CostInput value={config.hobbyCaseCost} onChange={v => update('hobbyCaseCost', v)} />
              {showRef && <PriceRef msrp={msrp} amPrice={amPrice} />}
            </div>
          </>
        ) : (
          <>
            <div>
              <FormLabel>BD Cases</FormLabel>
              <CounterInput value={config.bdCases} onChange={v => update('bdCases', v)} min={1} />
            </div>
            <div>
              <FormLabel>Your Cost / Case</FormLabel>
              <CostInput value={config.bdCaseCost} onChange={v => update('bdCaseCost', v)} />
              {showRef && <PriceRef msrp={msrp} amPrice={amPrice} />}
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

function PriceRef({ msrp, amPrice }: { msrp: number | null | undefined; amPrice: number | null | undefined }) {
  return (
    <p className="mt-1.5 text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
      {msrp != null && <span>MSRP ${msrp.toLocaleString()}</span>}
      {msrp != null && amPrice != null && <span className="mx-1">·</span>}
      {amPrice != null && <span style={{ color: 'var(--accent-orange)' }}>Market ${amPrice.toLocaleString()}</span>}
    </p>
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
