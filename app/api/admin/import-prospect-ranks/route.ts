/**
 * Track A — Objective prospect-rank importer.
 *
 * Accepts a batch of rows from an institutional source (MLB Pipeline, ESPN
 * Big Board, NHL Central Scouting, etc.) and writes prospect_rank +
 * prospect_status onto matching players. Per the plan, source attribution is
 * institutional only — personal names are rejected. Bulk-imported subjective
 * sentiment (team / product / etc.) goes through a different endpoint with
 * per-row personal attribution.
 *
 * See docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.
 *
 * Auth: admin / contributor cookie session OR `Bearer ${CRON_SECRET}`.
 *
 * Body:
 *   {
 *     source: string,        // e.g. "MLB Pipeline 2026-05" — must contain an institutional keyword
 *     dryRun?: boolean,      // when true, report fuzz-match outcomes but write nothing
 *     rows: Array<{
 *       sport: string,                                                  // sport slug ("baseball", "basketball", ...)
 *       player_name: string,
 *       prospect_rank?: number | null,
 *       prospect_status?: 'graduated_rc' | 'international_signee' | null,
 *       team?: string | null,                                           // tiebreaker for ambiguous name matches
 *     }>,
 *   }
 *
 * Returns: { written, dryRun, summary, perRow: [...] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { loadPlayersForSport, matchOne, type PlayerCandidate } from '@/lib/fuzz-match-players';

export const dynamic = 'force-dynamic';

// Source strings must contain one of these institutional keywords. Personal
// names are rejected — Kyle / Brody / etc. opinions belong in Track B
// (Discord /insight). "via Kyle CrossRef" trailing on an otherwise-institutional
// string is OK because the keyword test still passes.
const INSTITUTIONAL_KEYWORDS = [
  'pipeline',
  'big board',
  'central scouting',
  'mckenzie',
  'pff',
  'kiper',
  'jeremiah',
  '247sports',
  'eliteprospects',
  'tsn',
  'mlb',
  'espn',
  'nhl',
  'nfl',
  'nba',
  'baseball america',
];

function isInstitutionalSource(source: string): boolean {
  const lower = source.toLowerCase();
  return INSTITUTIONAL_KEYWORDS.some(k => lower.includes(k));
}

const STATUS_VALUES = new Set(['graduated_rc', 'international_signee']);

interface InRow {
  sport?: unknown;
  player_name?: unknown;
  prospect_rank?: unknown;
  prospect_status?: unknown;
  team?: unknown;
}

interface ValidatedRow {
  index: number;
  sport: string;
  player_name: string;
  prospect_rank: number | null;
  prospect_status: 'graduated_rc' | 'international_signee' | null;
  team: string | null;
}

interface RowResult {
  index: number;
  player_name: string;
  team: string | null;
  outcome:
    | { kind: 'written'; player_id: string; matched_name: string; distance: number }
    | { kind: 'dryrun_matched'; player_id: string; matched_name: string; distance: number }
    | { kind: 'unmatched' }
    | { kind: 'ambiguous'; candidates: Array<{ player_id: string; name: string; team: string | null; distance: number }> }
    | { kind: 'invalid'; reason: string }
    | { kind: 'sport_unknown'; sport: string };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const ok = await checkRole('admin', 'contributor');
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { source?: unknown; dryRun?: unknown; rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const source = typeof body.source === 'string' ? body.source.trim() : '';
  if (!source) {
    return NextResponse.json({ error: 'source required' }, { status: 400 });
  }
  if (!isInstitutionalSource(source)) {
    return NextResponse.json(
      {
        error:
          'source must be an institutional attribution (e.g. "MLB Pipeline 2026-05"), not a personal name. ' +
          'Subjective contributions belong in Track B via Discord /insight.',
      },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun === true;

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows array required' }, { status: 400 });
  }
  if (body.rows.length > 5000) {
    return NextResponse.json({ error: 'rows capped at 5000 per batch' }, { status: 400 });
  }

  // Validate every row up-front so the response surfaces every problem in one
  // pass instead of bailing on the first bad row.
  const validated: ValidatedRow[] = [];
  const invalid: RowResult[] = [];

  (body.rows as InRow[]).forEach((raw, index) => {
    const sport = typeof raw.sport === 'string' ? raw.sport.trim().toLowerCase() : '';
    const player_name = typeof raw.player_name === 'string' ? raw.player_name.trim() : '';

    if (!sport || !player_name) {
      invalid.push({
        index,
        player_name,
        team: null,
        outcome: { kind: 'invalid', reason: 'sport and player_name are required' },
      });
      return;
    }

    let prospect_rank: number | null = null;
    if (raw.prospect_rank != null && raw.prospect_rank !== '') {
      const n = Number(raw.prospect_rank);
      if (!Number.isFinite(n) || n < 1 || n > 5000 || !Number.isInteger(n)) {
        invalid.push({
          index,
          player_name,
          team: null,
          outcome: { kind: 'invalid', reason: `prospect_rank must be a positive integer (got ${raw.prospect_rank})` },
        });
        return;
      }
      prospect_rank = n;
    }

    let prospect_status: 'graduated_rc' | 'international_signee' | null = null;
    if (raw.prospect_status != null && raw.prospect_status !== '') {
      if (typeof raw.prospect_status !== 'string' || !STATUS_VALUES.has(raw.prospect_status)) {
        invalid.push({
          index,
          player_name,
          team: null,
          outcome: {
            kind: 'invalid',
            reason: `prospect_status must be one of graduated_rc | international_signee | null (got ${JSON.stringify(raw.prospect_status)})`,
          },
        });
        return;
      }
      prospect_status = raw.prospect_status as 'graduated_rc' | 'international_signee';
    }

    if (prospect_rank == null && prospect_status == null) {
      invalid.push({
        index,
        player_name,
        team: null,
        outcome: { kind: 'invalid', reason: 'row provides neither prospect_rank nor prospect_status — nothing to write' },
      });
      return;
    }

    const team = typeof raw.team === 'string' ? raw.team.trim() : null;
    validated.push({ index, sport, player_name, prospect_rank, prospect_status, team });
  });

  // Resolve sport slugs → sport_id in one query, then load candidates per sport.
  const sportSlugs = Array.from(new Set(validated.map(r => r.sport)));
  const { data: sports, error: sportsErr } = await supabaseAdmin
    .from('sports')
    .select('id, slug')
    .in('slug', sportSlugs);
  if (sportsErr) {
    return NextResponse.json({ error: `sport lookup failed: ${sportsErr.message}` }, { status: 500 });
  }
  const sportIdBySlug = new Map((sports ?? []).map(s => [s.slug as string, s.id as string]));

  const candidatesBySport = new Map<string, PlayerCandidate[]>();
  for (const slug of sportSlugs) {
    const sportId = sportIdBySlug.get(slug);
    if (!sportId) continue;
    candidatesBySport.set(slug, await loadPlayersForSport(sportId));
  }

  const perRow: RowResult[] = [...invalid];
  const writes: Array<{ player_id: string; row: ValidatedRow; matched_name: string; distance: number }> = [];

  for (const row of validated) {
    const sportId = sportIdBySlug.get(row.sport);
    if (!sportId) {
      perRow.push({
        index: row.index,
        player_name: row.player_name,
        team: row.team,
        outcome: { kind: 'sport_unknown', sport: row.sport },
      });
      continue;
    }
    const candidates = candidatesBySport.get(row.sport) ?? [];
    const result = matchOne(
      { player_name: row.player_name, team: row.team, sport_id: sportId },
      candidates,
    );

    if (result.kind === 'matched') {
      writes.push({ player_id: result.player_id, row, matched_name: result.matched_name, distance: result.distance });
      if (dryRun) {
        perRow.push({
          index: row.index,
          player_name: row.player_name,
          team: row.team,
          outcome: { kind: 'dryrun_matched', player_id: result.player_id, matched_name: result.matched_name, distance: result.distance },
        });
      }
    } else if (result.kind === 'ambiguous') {
      perRow.push({
        index: row.index,
        player_name: row.player_name,
        team: row.team,
        outcome: { kind: 'ambiguous', candidates: result.candidates },
      });
    } else {
      perRow.push({
        index: row.index,
        player_name: row.player_name,
        team: row.team,
        outcome: { kind: 'unmatched' },
      });
    }
  }

  let written = 0;
  if (!dryRun && writes.length > 0) {
    const updatedAt = new Date().toISOString();
    // Sequential updates — Postgres can handle parallel but the batch sizes
    // here are small (under 100 per import) and sequential writes give us
    // clean per-row error reporting.
    for (const w of writes) {
      const update: {
        prospect_rank?: number | null;
        prospect_status?: 'graduated_rc' | 'international_signee' | null;
        prospect_rank_source: string;
        prospect_rank_updated_at: string;
      } = {
        prospect_rank_source: source,
        prospect_rank_updated_at: updatedAt,
      };
      // Only include columns the row explicitly provides — don't blank out
      // existing rank when this batch only carries a status, and vice versa.
      if (w.row.prospect_rank != null) update.prospect_rank = w.row.prospect_rank;
      if (w.row.prospect_status != null) update.prospect_status = w.row.prospect_status;

      const { error: updErr } = await supabaseAdmin
        .from('players')
        .update(update)
        .eq('id', w.player_id);

      if (updErr) {
        perRow.push({
          index: w.row.index,
          player_name: w.row.player_name,
          team: w.row.team,
          outcome: { kind: 'invalid', reason: `db update failed: ${updErr.message}` },
        });
      } else {
        written++;
        perRow.push({
          index: w.row.index,
          player_name: w.row.player_name,
          team: w.row.team,
          outcome: {
            kind: 'written',
            player_id: w.player_id,
            matched_name: w.matched_name,
            distance: w.distance,
          },
        });
      }
    }
  }

  perRow.sort((a, b) => a.index - b.index);

  const summary = {
    rowsReceived: (body.rows as unknown[]).length,
    rowsValidated: validated.length,
    rowsInvalid: invalid.length,
    rowsMatched: writes.length,
    rowsUnmatched: perRow.filter(r => r.outcome.kind === 'unmatched').length,
    rowsAmbiguous: perRow.filter(r => r.outcome.kind === 'ambiguous').length,
    rowsWritten: written,
    dryRun,
    source,
  };

  return NextResponse.json({ summary, perRow });
}
