'use client';

import { useState } from 'react';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; scraped: number; matched: number; written: number; unmatched: number }
  | { kind: 'error'; msg: string };

/**
 * Slice 1 of the web-sourced-intel plan (Track A). Scrapes the MLB
 * Pipeline Top 100 and writes matched prospects directly to
 * prospect_rankings. Manual trigger only — no cron in Slice 1. The
 * engine doesn't read prospect_rankings yet (feature-flag gated), so
 * this is non-consumer-visible groundwork.
 *
 * Sport-wide source: matches against the entire baseball roster, not
 * just this product. The button lives on a product page for convenience.
 */
export default function ScrapeMlbPipelineButton() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function run() {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/scrape-mlb-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setStatus({ kind: 'error', msg: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({
        kind: 'ok',
        scraped: json.scraped,
        matched: json.matched,
        written: json.written,
        unmatched: Array.isArray(json.unmatchedNames) ? json.unmatchedNames.length : 0,
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
        {status.kind === 'running' ? 'Scraping MLB Pipeline…' : 'Scrape MLB Pipeline Top 100 ↻'}
      </button>
      {status.kind === 'ok' && (
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {status.scraped} scraped · {status.matched} matched · {status.written} written
          {status.unmatched > 0 ? ` · ${status.unmatched} unmatched` : ''}
        </span>
      )}
      {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
    </div>
  );
}
