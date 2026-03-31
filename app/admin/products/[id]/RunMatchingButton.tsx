'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Progress = { completed: number; total: number; auto: number; review: number };
type DebugRow = { playerName: string; query: string; status: string; confidence: number; topResult: Record<string, string> | null };

export default function RunMatchingButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0, auto: 0, review: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [debugRows, setDebugRows] = useState<DebugRow[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const router = useRouter();

  async function run() {
    setStatus('running');
    setProgress({ completed: 0, total: 0, auto: 0, review: 0 });
    setErrorMsg(null);
    setDebugRows([]);
    setShowDebug(false);

    let offset = 0;
    let totalAuto = 0;
    let totalReview = 0;
    let grandTotal = 0;
    const accumulated: DebugRow[] = [];

    try {
      while (true) {
        const res = await fetch('/api/admin/match-cardhedger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, offset }),
        });

        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);

        grandTotal = json.total;
        totalAuto += json.results.filter((r: DebugRow) => r.status === 'auto').length;
        totalReview += json.results.filter((r: DebugRow) => r.status === 'review').length;
        offset += json.processed;

        json.results.filter((r: DebugRow) => r.status !== 'auto').forEach((r: DebugRow) => accumulated.push(r));

        setProgress({ completed: offset, total: grandTotal, auto: totalAuto, review: totalReview });

        if (!json.hasMore) break;
        await new Promise(r => setTimeout(r, 300));
      }

      setDebugRows(accumulated);
      setStatus('done');
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  if (status === 'running') {
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {progress.completed} / {progress.total || '…'}
        </span>
      </div>
    );
  }

  if (status === 'done') {
    const noMatch = progress.total - progress.auto - progress.review;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>✓ {progress.auto} matched · {progress.review} review · {noMatch} no match</span>
          {debugRows.length > 0 && (
            <button onClick={() => setShowDebug(v => !v)} className="underline hover:text-foreground">
              {showDebug ? 'Hide' : 'View'} {debugRows.length} unmatched
            </button>
          )}
          <button onClick={() => { setStatus('idle'); setDebugRows([]); }} className="underline hover:text-foreground">
            Run again
          </button>
        </div>

        {showDebug && debugRows.length > 0 && (
          <button
            onClick={() => {
              const header = 'Player,Query,Status,Confidence,CH Player,CH Set,CH Variant';
              const rows = debugRows.map(r => [
                `"${r.playerName}"`,
                `"${r.query}"`,
                r.status,
                r.confidence > 0 ? r.confidence.toFixed(2) : '',
                `"${r.topResult?.player_name ?? ''}"`,
                `"${r.topResult?.set_name ?? ''}"`,
                `"${r.topResult?.variant ?? ''}"`,
              ].join(','));
              const csv = [header, ...rows].join('\n');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              a.download = 'unmatched-variants.csv';
              a.click();
            }}
            className="text-xs underline hover:text-foreground"
            style={{ color: 'var(--accent-blue)' }}
          >
            Export CSV
          </button>
        )}
        {showDebug && debugRows.length > 0 && (
          <div className="rounded border overflow-auto max-h-64" style={{ borderColor: 'var(--terminal-border)' }}>
            <table className="w-full text-xs">
              <thead style={{ backgroundColor: 'var(--terminal-surface-hover)' }}>
                <tr>
                  {['Player', 'Query sent', 'Status', 'Conf.', 'CH returned'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                {debugRows.map((r, i) => (
                  <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--terminal-surface-hover)' }}>
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{r.playerName}</td>
                    <td className="px-3 py-1.5 font-mono max-w-xs truncate" style={{ color: 'var(--text-secondary)' }}>{r.query}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span style={{ color: r.status === 'review' ? 'var(--signal-watch)' : 'var(--text-disabled)' }}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      {r.confidence > 0 ? r.confidence.toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-1.5 max-w-xs truncate" style={{ color: r.topResult ? 'var(--text-secondary)' : 'var(--text-disabled)' }}>
                      {r.topResult
                        ? `${r.topResult.player_name} · ${r.topResult.set_name} · ${r.topResult.variant}`
                        : '(no results)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={run} className="rounded border px-4 py-2 text-sm font-medium text-red-500 hover:bg-muted transition-colors">
          Retry Matching
        </button>
        {errorMsg && <span className="text-xs text-red-500">{errorMsg}</span>}
      </div>
    );
  }

  return (
    <button onClick={run} className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
      Re-run Matching →
    </button>
  );
}
