'use client';

import { useState } from 'react';
import { errText } from '@/lib/format-error';

interface Diff {
  comparedAgainst: string | null;
  riserCount: number;
  fallerCount: number;
  newCount: number;
  droppedCount: number;
  moves: string[];
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; scraped: number; matched: number; written: number; unmatchedNames: string[]; diff: Diff | null }
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
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) {
        setStatus({ kind: 'error', msg: errText(json?.error, `HTTP ${res.status}`) });
        return;
      }
      setStatus({
        kind: 'ok',
        scraped: json.scraped,
        matched: json.matched,
        written: json.written,
        unmatchedNames: Array.isArray(json.unmatchedNames) ? json.unmatchedNames : [],
        diff: json.diff ?? null,
      });
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-2">
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
            {status.unmatchedNames.length > 0 ? ` · ${status.unmatchedNames.length} unmatched` : ''}
          </span>
        )}
        {status.kind === 'error' && <span className="text-xs text-red-500">{status.msg}</span>}
      </div>

      {/* Material rank moves vs the prior scrape (Slice 2a, report-only).
          First-ever scrape has no prior → comparedAgainst is null and we
          show a baseline note instead. */}
      {status.kind === 'ok' && status.diff && (
        status.diff.comparedAgainst === null ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Baseline scrape — no prior snapshot to diff against yet. Re-scrape later to see movers.
          </p>
        ) : (
          <details className="text-xs" style={{ color: 'var(--text-tertiary)' }} open>
            <summary className="cursor-pointer select-none">
              {status.diff.riserCount} risers · {status.diff.fallerCount} fallers ·{' '}
              {status.diff.newCount} new · {status.diff.droppedCount} dropped (since last scrape)
            </summary>
            {status.diff.moves.length > 0 && (
              <ul className="mt-1 space-y-0.5 leading-relaxed">
                {status.diff.moves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </details>
        )
      )}

      {/* Unmatched names — surfaced so we can tell genuinely-not-carried
          prospects from name-normalization misses (e.g. an accented or
          Jr./Sr. name that should have matched). Most are expected
          (Top 100 prospects not on our scoped products). */}
      {status.kind === 'ok' && status.unmatchedNames.length > 0 && (
        <details className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <summary className="cursor-pointer select-none">
            {status.unmatchedNames.length} unmatched names (expand)
          </summary>
          <p className="mt-1 leading-relaxed">{status.unmatchedNames.join(' · ')}</p>
        </details>
      )}
    </div>
  );
}
