'use client';

import { useState } from 'react';
import { errText } from '@/lib/format-error';

interface Move {
  playerId: string;
  playerName: string;
  source: string;
  kind: 'riser' | 'faller' | 'new' | 'dropped';
  priorRank: number | null;
  newRank: number | null;
  delta: number | null;
  description: string;
}

interface Diff {
  comparedAgainst: string | null;
  riserCount: number;
  fallerCount: number;
  newCount: number;
  droppedCount: number;
  moves: Move[];
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; scraped: number; matched: number; written: number; unmatchedNames: string[]; diff: Diff | null }
  | { kind: 'error'; msg: string };

type Endorse =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; applied: number }
  | { kind: 'error'; msg: string };

/**
 * Track A scraper + inline endorsement (web-sourced-intel Slices 1, 2a, 2b).
 *
 * - Scrapes the MLB Pipeline Top 100, writes matched prospects directly to
 *   prospect_rankings (objective fact, no approval).
 * - Diffs against the prior scrape and surfaces material moves (≥3 spots,
 *   new entries, drop-offs).
 * - Admin endorses selected moves inline → /api/admin/apply-prospect-moves
 *   writes player-scoped prospect_rank_move market_observations (the
 *   subjective layer). Does NOT touch breakerz_score or the engine.
 *
 * Sport-wide source: matches the entire baseball roster, not just this
 * product. The button lives on a product page for convenience.
 */
export default function ScrapeMlbPipelineButton() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [endorse, setEndorse] = useState<Endorse>({ kind: 'idle' });

  async function run() {
    setStatus({ kind: 'running' });
    setEndorse({ kind: 'idle' });
    setSelected(new Set());
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
      const diff: Diff | null = json.diff ?? null;
      // Default every surfaced move to selected — admin unchecks noise.
      if (diff?.moves?.length) setSelected(new Set(diff.moves.map(m => m.playerId)));
      setStatus({
        kind: 'ok',
        scraped: json.scraped,
        matched: json.matched,
        written: json.written,
        unmatchedNames: Array.isArray(json.unmatchedNames) ? json.unmatchedNames : [],
        diff,
      });
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  function toggle(playerId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  async function endorseSelected(moves: Move[]) {
    const chosen = moves.filter(m => selected.has(m.playerId));
    if (chosen.length === 0) return;
    setEndorse({ kind: 'running' });
    try {
      const res = await fetch('/api/admin/apply-prospect-moves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: chosen }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) {
        setEndorse({ kind: 'error', msg: errText(json?.error, `HTTP ${res.status}`) });
        return;
      }
      setEndorse({ kind: 'ok', applied: json.applied ?? chosen.length });
    } catch (err) {
      setEndorse({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
    }
  }

  const moves = status.kind === 'ok' && status.diff ? status.diff.moves : [];
  const selectedCount = moves.filter(m => selected.has(m.playerId)).length;

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

      {/* Material rank moves vs the prior scrape. First-ever scrape has no
          prior → baseline note. Otherwise a selectable checklist the admin
          endorses into prospect_rank_move observations (Slice 2b). */}
      {status.kind === 'ok' && status.diff && (
        status.diff.comparedAgainst === null ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Baseline scrape — no prior snapshot to diff against yet. Re-scrape later to see movers.
          </p>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <div className="mb-1">
              {status.diff.riserCount} risers · {status.diff.fallerCount} fallers ·{' '}
              {status.diff.newCount} new · {status.diff.droppedCount} dropped (since last scrape)
            </div>
            {moves.length > 0 && (
              <>
                <ul className="space-y-0.5 leading-relaxed">
                  {moves.map(m => (
                    <li key={m.playerId} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(m.playerId)}
                        onChange={() => toggle(m.playerId)}
                        disabled={endorse.kind === 'running' || endorse.kind === 'ok'}
                      />
                      <span>{m.description}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => endorseSelected(moves)}
                    disabled={selectedCount === 0 || endorse.kind === 'running' || endorse.kind === 'ok'}
                    className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {endorse.kind === 'running'
                      ? 'Endorsing…'
                      : `Endorse ${selectedCount} signal${selectedCount === 1 ? '' : 's'}`}
                  </button>
                  {endorse.kind === 'ok' && (
                    <span style={{ color: 'var(--signal-buy)' }}>
                      ✓ {endorse.applied} prospect_rank_move observation{endorse.applied === 1 ? '' : 's'} written
                    </span>
                  )}
                  {endorse.kind === 'error' && <span className="text-red-500">{endorse.msg}</span>}
                </div>
              </>
            )}
          </div>
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
