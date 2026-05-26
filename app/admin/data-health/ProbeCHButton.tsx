'use client';

import { useState } from 'react';
import { Loader2, Radio, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';
import { probeProductCHAction } from './actions';
import type { CHProbeResult } from '@/lib/ch-coverage';

// Per-row "Probe CH live" button on the data-health table. Hits CH's
// card-search with the product's ch_set_name page_size=1 — the response
// returns a total count we can compare to our ch_set_cache mirror to
// detect CH-side growth, set rename / restructure, or our ch_set_name
// being stale. Cheap (1 small live CH call) but interactive — never
// fires on page load so the dashboard stays a cache-only render.

export default function ProbeCHButton({ productId }: { productId: string }) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; probe: CHProbeResult }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  async function probe() {
    setState({ kind: 'loading' });
    const res = await probeProductCHAction(productId);
    if (res.probe) setState({ kind: 'ok', probe: res.probe });
    else setState({ kind: 'error', msg: res.error ?? 'Probe failed' });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={probe}
        disabled={state.kind === 'loading'}
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border transition-colors disabled:opacity-50 hover:bg-[var(--terminal-surface-hover)]"
        style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        title="One-shot live CH call (compares CH's set count to our ch_set_cache)"
      >
        {state.kind === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
        {state.kind === 'loading' ? 'Probing' : 'Probe CH'}
      </button>

      {state.kind === 'ok' && <ProbeBadge probe={state.probe} />}
      {state.kind === 'error' && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono"
          style={{ color: '#fca5a5' }}
          title={state.msg}
        >
          <AlertTriangle className="w-3 h-3" />
          {truncate(state.msg, 40)}
        </span>
      )}
    </div>
  );
}

function ProbeBadge({ probe }: { probe: CHProbeResult }) {
  const { chCount, ourCount, cardsDelta } = probe;

  // Diagnosis tiers — the badge color + label both encode the result.
  //   match    → CH and our mirror agree (cardsDelta === 0). Healthy.
  //   ch_grew  → CH has more cards than we do. Refresh the catalog.
  //   we_grew  → We have more than CH (rare; usually CH demoted a card).
  //   empty    → CH returned 0 cards. Bad ch_set_name or CH outage.
  //   no_data  → We have rows but CH knows nothing about this set name.
  let label: string;
  let color: string;
  let Icon = CheckCircle2;
  if (chCount === 0 && ourCount > 0) {
    label = 'CH returned 0 (bad set name?)';
    color = '#fca5a5';
    Icon = AlertTriangle;
  } else if (chCount === 0 && ourCount === 0) {
    label = 'CH 0 / Ours 0';
    color = 'var(--text-tertiary)';
    Icon = AlertTriangle;
  } else if (cardsDelta === 0) {
    label = `match (${chCount.toLocaleString()})`;
    color = 'var(--signal-buy)';
    Icon = CheckCircle2;
  } else if (cardsDelta > 0) {
    label = `CH +${cardsDelta.toLocaleString()} (refresh catalog)`;
    color = 'var(--signal-watch)';
    Icon = TrendingUp;
  } else {
    label = `Ours +${Math.abs(cardsDelta).toLocaleString()}`;
    color = 'var(--text-tertiary)';
    Icon = TrendingDown;
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono"
      style={{ color }}
      title={`CH: ${chCount.toLocaleString()} · Ours: ${ourCount.toLocaleString()} · probed ${probe.probedAt}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
