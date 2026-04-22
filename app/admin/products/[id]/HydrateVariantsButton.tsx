'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | {
      kind: 'ok';
      setName: string;
      insertedCount: number;
      deletedCount: number;
      skippedCount: number;
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
        skippedCount: (json.skippedPlayers ?? []).length,
        catalogCards: json.catalogCards,
        durationMs: json.durationMs,
      });
      router.refresh();
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
        {status.kind === 'running' ? 'Hydrating variants…' : 'Hydrate Variants from CH ↻'}
      </button>
      {status.kind === 'ok' && (
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {status.insertedCount.toLocaleString()} inserted · {status.deletedCount.toLocaleString()} replaced ·{' '}
          {status.skippedCount} player{status.skippedCount === 1 ? '' : 's'} skipped · {(status.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
    </div>
  );
}
