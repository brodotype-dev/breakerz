'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SkippedPlayer = { playerName: string; catalogRows: number };

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | {
      kind: 'ok';
      setName: string;
      insertedCount: number;
      deletedCount: number;
      skippedPlayers: SkippedPlayer[];
      catalogCards: number;
      durationMs: number;
    }
  | { kind: 'error'; msg: string };

/**
 * Replace this product's player_product_variants with rows hydrated directly
 * from ch_set_cache. Every inserted row is pre-linked to its CardHedger
 * card_id — the matching pipeline has nothing to do for them.
 *
 * Requires:
 *   1. products.ch_set_name must be set (via the "Find on CH" widget)
 *   2. ch_set_cache must have rows for that set ("Refresh CH Catalog" first)
 *
 * See /Users/brody/.claude/plans/polymorphic-gathering-valley.md.
 */
export default function HydrateVariantsButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const router = useRouter();

  async function run() {
    const ok = window.confirm(
      'Replace all existing variants for this product with CH-sourced rows?\n\n' +
        'This deletes the current variants and recreates them from ch_set_cache. ' +
        "Re-running 'Import Checklist' can restore parser-driven rows if needed.",
    );
    if (!ok) return;

    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/hydrate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setStatus({ kind: 'error', msg: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({
        kind: 'ok',
        setName: json.setName,
        insertedCount: json.insertedCount,
        deletedCount: json.deletedCount,
        skippedPlayers: json.skippedPlayers ?? [],
        catalogCards: json.catalogCards,
        durationMs: json.durationMs,
      });
      router.refresh();
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  function downloadSkippedCsv(skipped: SkippedPlayer[]) {
    const rows = [
      ['player_name', 'catalog_rows'].join(','),
      ...skipped.map(s => `"${s.playerName.replace(/"/g, '""')}",${s.catalogRows}`),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skipped-players-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const skipped = status.kind === 'ok' ? status.skippedPlayers : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={status.kind === 'running'}
          className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          {status.kind === 'running' ? 'Hydrating variants…' : 'Hydrate Variants from CH ↻'}
        </button>
        {status.kind === 'ok' && (
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {status.insertedCount.toLocaleString()} inserted · {status.deletedCount.toLocaleString()} replaced ·{' '}
            {skipped.length} player{skipped.length === 1 ? '' : 's'} skipped · {(status.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
      </div>

      {status.kind === 'ok' && skipped.length > 0 && (
        <details
          className="rounded border text-xs"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)' }}
        >
          <summary
            className="cursor-pointer px-3 py-2 font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            {skipped.length} skipped player{skipped.length === 1 ? '' : 's'} — CH has cards but this product doesn&apos;t
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            <button
              onClick={() => downloadSkippedCsv(skipped)}
              className="rounded border px-2 py-1 text-xs font-medium hover:bg-muted transition-colors"
              style={{ borderColor: 'var(--terminal-border)' }}
            >
              Download CSV ↓
            </button>
            <div className="max-h-64 overflow-auto rounded" style={{ border: '1px solid var(--terminal-border)' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--terminal-surface)', color: 'var(--text-tertiary)' }}>
                    <th className="text-left px-2 py-1 font-bold uppercase tracking-wider">Player</th>
                    <th className="text-right px-2 py-1 font-bold uppercase tracking-wider">CH rows</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                  {skipped.map(s => (
                    <tr key={s.playerName}>
                      <td className="px-2 py-1" style={{ color: 'var(--text-primary)' }}>{s.playerName}</td>
                      <td className="px-2 py-1 font-mono text-right" style={{ color: 'var(--text-secondary)' }}>
                        {s.catalogRows}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ color: 'var(--text-tertiary)' }}>
              Add these players via Manage Players (if they belong on this product) and re-run hydrate. Otherwise
              ignore — CH has them but your checklist doesn&apos;t.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
