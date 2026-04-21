'use client';

import { useState } from 'react';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; setName: string; cardsFetched: number; pagesFetched: number; durationMs: number }
  | { kind: 'error'; msg: string };

/**
 * Pulls the full CardHedger catalog for this product's canonical set into ch_set_cache.
 * The matching pipeline reads from that cache — see docs/catalog-preload-architecture.md.
 * Nightly cron auto-refreshes active products, so this button is for on-demand refresh
 * after checklist edits, product creation, or when investigating a match anomaly.
 */
export default function RefreshCatalogButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function run() {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/refresh-ch-catalog', {
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
        cardsFetched: json.cardsFetched,
        pagesFetched: json.pagesFetched,
        durationMs: json.durationMs,
      });
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={status.kind === 'running'}
        className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
      >
        {status.kind === 'running' ? 'Refreshing CH catalog…' : 'Refresh CH Catalog ↻'}
      </button>
      {status.kind === 'ok' && (
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {status.setName} · {status.cardsFetched.toLocaleString()} cards · {status.pagesFetched} pages ·{' '}
          {(status.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
    </div>
  );
}
