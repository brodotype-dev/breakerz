'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | {
      kind: 'ok';
      totalPlayers: number;
      livePriced: number;
      crossPriced: number;
      searchPriced: number;
      defaultPriced: number;
      variantsFetched: number;
      variantsTotal: number;
      batchDurationMs: number;
      totalDurationMs: number;
      cacheRowsWritten?: number;
      partial?: boolean;
    }
  | { kind: 'error'; msg: string };

/**
 * Admin on-demand pricing refresh for a single product. Calls
 * `POST /api/admin/refresh-product-pricing` — the heavy CH batch fetch that
 * used to live on the consumer break page's Refresh button. Moved here
 * because consumer-side 504s were unacceptable.
 *
 * The nightly cron runs this same endpoint for every active product. Use
 * this button when you've just hydrated a product and don't want to wait
 * until 4 AM UTC, or when investigating a pricing anomaly.
 */
export default function RefreshPricingButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const router = useRouter();

  async function run() {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/refresh-product-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      // Vercel returns plaintext on 504/hard-crash. Read text first, then try JSON.
      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body, likely a Vercel runtime error page */
      }
      if (!res.ok || (json && typeof json.error === 'string')) {
        const msg =
          (json && typeof json.error === 'string' ? json.error : null) ??
          (text ? text.slice(0, 140).trim() : null) ??
          `HTTP ${res.status}`;
        const hint =
          res.status === 504 || /timed? out|FUNCTION_INVOCATION_TIMEOUT|An error occurred/i.test(text)
            ? ' — likely 60s cap on this jumbo product; nightly cron will complete it, or upgrade to Vercel Pro (backlog C)'
            : '';
        setStatus({ kind: 'error', msg: `${msg}${hint}` });
        return;
      }
      if (!json) {
        setStatus({ kind: 'error', msg: 'Empty response from server' });
        return;
      }
      setStatus({ ...(json as unknown as Omit<Extract<Status, { kind: 'ok' }>, 'kind'>), kind: 'ok' });
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
        {status.kind === 'running' ? 'Refreshing pricing…' : 'Refresh Pricing ↻'}
      </button>
      {status.kind === 'ok' && (
        <span className="text-xs" style={{ color: status.partial ? 'var(--warning, #f59e0b)' : 'var(--text-secondary)' }}>
          {status.partial ? '⚠ partial · ' : ''}
          {status.totalPlayers} players · live={status.livePriced} cross={status.crossPriced}{' '}
          search={status.searchPriced} default={status.defaultPriced} ·{' '}
          {status.variantsFetched}/{status.variantsTotal} variants ·{' '}
          {typeof status.cacheRowsWritten === 'number' ? `${status.cacheRowsWritten} cached · ` : ''}
          {(status.totalDurationMs / 1000).toFixed(1)}s
        </span>
      )}
      {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
    </div>
  );
}
