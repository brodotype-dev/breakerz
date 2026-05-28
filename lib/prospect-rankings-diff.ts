// Prospect-rankings diff engine — Slice 2.
//
// Compares the latest scrape of a source against the most-recent PRIOR
// scrape of the same source, and surfaces only MATERIAL moves: a player
// rose or fell by >= PROSPECT_RANK_MATERIAL_DELTA spots, newly entered
// the list, or dropped off entirely. Steady-state ranks (moved 0-2 spots)
// stay silent.
//
// Slice 2a (this file + admin reporting) computes + surfaces moves.
// Slice 2b (a later decision) turns approved moves into derived signals
// (sentiment / hype_tag) via the Discord proposal flow — intentionally
// NOT wired here; the diff output is the input that layer will consume.
//
// Reads use supabaseAdmin (service role) — prospect_rankings is admin-only.

import { supabaseAdmin } from './supabase';

// Materiality threshold (web-sourced-intel brainstorm decision, 2026-05-27):
// a move of >= 3 ranking positions is material; 1-2 spots stays silent.
// Single shared constant so it's tunable per-source later if one proves
// noisier.
export const PROSPECT_RANK_MATERIAL_DELTA = 3;

export type ProspectMoveKind = 'riser' | 'faller' | 'new' | 'dropped';

export interface ProspectMove {
  playerId: string;
  playerName: string;
  /** Rank in the prior scrape; null when the player is a new entry. */
  priorRank: number | null;
  /** Rank in the latest scrape; null when the player dropped off. */
  newRank: number | null;
  /** priorRank - newRank. Positive = rose (toward #1). null for new/dropped. */
  delta: number | null;
  kind: ProspectMoveKind;
}

export interface ProspectDiffResult {
  /** Material moves only, sorted: risers first (biggest jump), then
   *  fallers, then new entries (by new rank), then drop-offs. */
  moves: ProspectMove[];
  /** captured_at of the prior scrape we compared against; null when this
   *  was the first-ever scrape (no baseline — nothing to diff, no moves). */
  comparedAgainst: string | null;
  riserCount: number;
  fallerCount: number;
  newCount: number;
  droppedCount: number;
}

interface RankRow {
  player_id: string;
  rank_value: number;
  player_name: string;
}

async function fetchScrapeRows(source: string, capturedAt: string): Promise<RankRow[]> {
  const { data, error } = await supabaseAdmin
    .from('prospect_rankings')
    .select('player_id, rank_value, players!inner(name)')
    .eq('source', source)
    .eq('captured_at', capturedAt);
  if (error) {
    console.error('[prospect-diff] fetch rows failed:', error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    player_id: r.player_id,
    rank_value: r.rank_value,
    player_name: Array.isArray(r.players) ? (r.players[0]?.name ?? '') : (r.players?.name ?? ''),
  }));
}

/**
 * Compute material rank moves for `source` between the scrape at
 * `latestCapturedAt` and the most-recent prior scrape. Returns empty moves
 * (comparedAgainst=null) when there is no prior scrape — the first run just
 * establishes the baseline.
 */
export async function computeProspectDiff(
  source: string,
  latestCapturedAt: string,
): Promise<ProspectDiffResult> {
  const empty: ProspectDiffResult = {
    moves: [],
    comparedAgainst: null,
    riserCount: 0,
    fallerCount: 0,
    newCount: 0,
    droppedCount: 0,
  };

  // Find the prior scrape's captured_at (most recent strictly before latest).
  const { data: priorRow, error: priorErr } = await supabaseAdmin
    .from('prospect_rankings')
    .select('captured_at')
    .eq('source', source)
    .lt('captured_at', latestCapturedAt)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorErr) {
    console.error('[prospect-diff] prior-scrape lookup failed:', priorErr);
    return empty;
  }
  if (!priorRow) return empty; // first-ever scrape — baseline only

  const priorCapturedAt = priorRow.captured_at as string;

  const [latestRows, priorRows] = await Promise.all([
    fetchScrapeRows(source, latestCapturedAt),
    fetchScrapeRows(source, priorCapturedAt),
  ]);

  const latestById = new Map(latestRows.map(r => [r.player_id, r]));
  const priorById = new Map(priorRows.map(r => [r.player_id, r]));

  const moves: ProspectMove[] = [];

  // Players in the latest scrape: risers, fallers, new entries.
  for (const cur of latestRows) {
    const prior = priorById.get(cur.player_id);
    if (!prior) {
      moves.push({
        playerId: cur.player_id,
        playerName: cur.player_name,
        priorRank: null,
        newRank: cur.rank_value,
        delta: null,
        kind: 'new',
      });
      continue;
    }
    const delta = prior.rank_value - cur.rank_value; // + = rose toward #1
    if (Math.abs(delta) >= PROSPECT_RANK_MATERIAL_DELTA) {
      moves.push({
        playerId: cur.player_id,
        playerName: cur.player_name,
        priorRank: prior.rank_value,
        newRank: cur.rank_value,
        delta,
        kind: delta > 0 ? 'riser' : 'faller',
      });
    }
  }

  // Players in the prior scrape but absent from the latest: drop-offs.
  for (const prior of priorRows) {
    if (!latestById.has(prior.player_id)) {
      moves.push({
        playerId: prior.player_id,
        playerName: prior.player_name,
        priorRank: prior.rank_value,
        newRank: null,
        delta: null,
        kind: 'dropped',
      });
    }
  }

  // Sort: risers (biggest jump first), fallers (biggest drop first),
  // new (by new rank), dropped (by prior rank).
  const kindOrder: Record<ProspectMoveKind, number> = { riser: 0, faller: 1, new: 2, dropped: 3 };
  moves.sort((a, b) => {
    if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.kind === 'riser') return (b.delta ?? 0) - (a.delta ?? 0);
    if (a.kind === 'faller') return (a.delta ?? 0) - (b.delta ?? 0);
    if (a.kind === 'new') return (a.newRank ?? 0) - (b.newRank ?? 0);
    return (a.priorRank ?? 0) - (b.priorRank ?? 0);
  });

  return {
    moves,
    comparedAgainst: priorCapturedAt,
    riserCount: moves.filter(m => m.kind === 'riser').length,
    fallerCount: moves.filter(m => m.kind === 'faller').length,
    newCount: moves.filter(m => m.kind === 'new').length,
    droppedCount: moves.filter(m => m.kind === 'dropped').length,
  };
}

/** One-line human summary of a move, for the admin UI / future proposals. */
export function describeMove(m: ProspectMove, source: string): string {
  const label = source === 'mlb_pipeline' ? 'MLB Pipeline' : source;
  switch (m.kind) {
    case 'riser':
      return `${m.playerName} ↑${m.delta} (#${m.priorRank}→#${m.newRank}) on ${label}`;
    case 'faller':
      return `${m.playerName} ↓${Math.abs(m.delta ?? 0)} (#${m.priorRank}→#${m.newRank}) on ${label}`;
    case 'new':
      return `${m.playerName} NEW at #${m.newRank} on ${label}`;
    case 'dropped':
      return `${m.playerName} dropped off ${label} (was #${m.priorRank})`;
  }
}
