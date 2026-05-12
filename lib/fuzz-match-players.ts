/**
 * Fuzz-match a player name (within a sport) to the existing players table.
 *
 * Used by the Track A prospect-rank importer to map institutional CSV rows
 * (e.g. "Konnor Griffin" from MLB Pipeline) onto our players.id rows. Same
 * normalization rule as lib/variants-from-catalog.ts (lowercase + diacritic
 * strip) plus a Levenshtein edit-distance ≤ 2 fallback to tolerate small
 * typos and punctuation drift ("George Lombard Jr" vs "George Lombard Jr.").
 *
 * When a single input matches multiple players within a sport, the team
 * column is used as a tiebreaker. If team doesn't disambiguate, the match is
 * reported as ambiguous and the row is left for admin review — never written
 * silently to the wrong player.
 */

import { supabaseAdmin } from './supabase';

export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Iterative Levenshtein. n × m table; player names are short (< 40 chars)
// so memory + perf are non-issues.
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export interface FuzzMatchInput {
  player_name: string;
  team?: string | null;
  sport_id: string;
}

export type FuzzMatchOutcome =
  | { kind: 'matched'; player_id: string; matched_name: string; distance: number }
  | { kind: 'ambiguous'; candidates: Array<{ player_id: string; name: string; team: string | null; distance: number }> }
  | { kind: 'unmatched' };

export interface PlayerCandidate {
  id: string;
  name: string;
  team: string | null;
  sport_id: string;
}

export function matchOne(
  input: FuzzMatchInput,
  candidatesInSport: PlayerCandidate[],
  maxDistance = 2,
): FuzzMatchOutcome {
  const normInput = normalizePlayerName(input.player_name);
  const scored = candidatesInSport
    .map(c => ({ c, distance: editDistance(normInput, normalizePlayerName(c.name)) }))
    .filter(s => s.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  if (!scored.length) return { kind: 'unmatched' };

  const bestDistance = scored[0].distance;
  const tied = scored.filter(s => s.distance === bestDistance);

  if (tied.length === 1) {
    return {
      kind: 'matched',
      player_id: tied[0].c.id,
      matched_name: tied[0].c.name,
      distance: bestDistance,
    };
  }

  // Multiple equally-close candidates — use team as tiebreaker if provided.
  if (input.team) {
    const inputTeam = input.team.toLowerCase().trim();
    const teamHits = tied.filter(s => (s.c.team ?? '').toLowerCase().trim().includes(inputTeam)
      || inputTeam.includes((s.c.team ?? '').toLowerCase().trim()));
    if (teamHits.length === 1) {
      return {
        kind: 'matched',
        player_id: teamHits[0].c.id,
        matched_name: teamHits[0].c.name,
        distance: bestDistance,
      };
    }
  }

  return {
    kind: 'ambiguous',
    candidates: tied.map(s => ({
      player_id: s.c.id,
      name: s.c.name,
      team: s.c.team,
      distance: s.distance,
    })),
  };
}

/**
 * Load all players in a sport (one query, used across many fuzz-matches in a
 * batch). Pass the resulting array into `matchOne` per row.
 */
export async function loadPlayersForSport(sportId: string): Promise<PlayerCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id, name, team, sport_id')
    .eq('sport_id', sportId);
  if (error) throw error;
  return (data ?? []) as PlayerCandidate[];
}
