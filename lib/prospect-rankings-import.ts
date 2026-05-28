// Prospect-rankings importer — Slice 1.
//
// Takes scraped MLB Pipeline rows, matches each named prospect against
// our baseball roster, and writes matched players directly to
// prospect_rankings. Rank position is objective fact, so this path does
// NOT go through the Discord proposal flow (see web-sourced-intel
// brainstorm, architecture step 3). The engine does not read
// prospect_rankings yet (gated behind feature_flags.prospect_rank_enabled).
//
// Name matching is normalized exact-match: lowercase, strip accents,
// drop generational suffixes (Jr./Sr./II/III), strip punctuation,
// collapse whitespace. Unmatched names are dropped and reported in the
// summary — we only store rankings for players we actually track, and a
// missed match is honest ("we don't carry this prospect") rather than a
// fabricated row. Fuzzy / Claude-assisted matching is deferred.

import { supabaseAdmin } from './supabase';
import { isCardSubsetCode } from './checklist-aggregates';
import type { MlbPipelineRow } from './scrapers/mlb-pipeline';

export interface ProspectImportSummary {
  source: string;
  sourceUrl: string;
  scraped: number;
  matched: number;
  written: number;
  unmatchedNames: string[];
  capturedAt: string;
}

/** Normalize a player name for matching. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')           // strip accents
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')  // drop generational suffixes
    .replace(/[.'’,]/g, '')                     // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a normalized-name → player_id map for baseball players who appear
 * in at least one product (active or not — prospect rank is valuable even
 * for players whose cards aren't currently in rotation, same reasoning as
 * the risk-flag two-tier roster). Excludes multi-player concatenated rows
 * and card-subset codes.
 */
async function loadBaseballRoster(): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('players')
      .select('id, name, sport:sports!inner(slug), player_products!inner(id)')
      .eq('sport.slug', 'baseball')
      .not('name', 'like', '%/%')
      .order('name')
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[prospect-import] roster query failed:', error);
      break;
    }
    if (!data || data.length === 0) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of data as any[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (isCardSubsetCode(row.name)) continue;
      const key = normalizeName(row.name);
      if (!key) continue;
      // First match wins on collision — note we don't expect many within
      // a single sport's product roster. Collisions just mean the rank
      // attaches to the alphabetically-first player_products entry.
      if (!byName.has(key)) byName.set(key, row.id);
    }
    if (data.length < PAGE) break;
  }
  return byName;
}

/**
 * Match scraped rows against the baseball roster and write matched
 * rankings directly to prospect_rankings. Returns a summary for the
 * admin UI. Does not throw on partial failure — collects what it can.
 */
export async function importMlbPipelineRankings(
  rows: MlbPipelineRow[],
  sourceUrl: string,
): Promise<ProspectImportSummary> {
  const source = 'mlb_pipeline';
  const capturedAt = new Date().toISOString();
  const roster = await loadBaseballRoster();

  type Row = {
    player_id: string;
    source: string;
    rank_value: number;
    rank_scope: string;
    source_url: string;
    captured_at: string;
  };

  // Dedupe by player_id WITHIN this scrape, keeping the best (lowest)
  // rank. The MLB ranked-table page surfaces some prospects in more than
  // one section (e.g. a "top risers" highlight + the main table), so the
  // raw scrape can contain the same player twice. Writing both would put
  // two rows for one player at one captured_at and break the "one current
  // rank per player per scrape" invariant the diff logic (Slice 2) relies
  // on. Keep one row per player at their best rank.
  const byPlayer = new Map<string, Row>();
  let matchedRowCount = 0; // raw matched scrape rows, before dedupe
  const unmatchedNames: string[] = [];

  for (const r of rows) {
    const key = normalizeName(r.player_name);
    const playerId = roster.get(key);
    if (!playerId) {
      unmatchedNames.push(r.player_name);
      continue;
    }
    matchedRowCount++;
    const candidate: Row = {
      player_id: playerId,
      source,
      rank_value: r.rank,
      rank_scope: 'overall',
      source_url: sourceUrl,
      captured_at: capturedAt,
    };
    const existing = byPlayer.get(playerId);
    if (!existing || candidate.rank_value < existing.rank_value) {
      byPlayer.set(playerId, candidate);
    }
  }

  const dedupedRows = [...byPlayer.values()];

  // Insert in chunks. 200-row inserts are well under any URL/body cap;
  // chunk anyway for parity with the codebase's .in()/insert conventions.
  let written = 0;
  const INSERT_CHUNK = 200;
  for (let i = 0; i < dedupedRows.length; i += INSERT_CHUNK) {
    const slice = dedupedRows.slice(i, i + INSERT_CHUNK);
    const { error } = await supabaseAdmin.from('prospect_rankings').insert(slice);
    if (error) {
      console.error('[prospect-import] insert chunk failed:', error);
      throw new Error(`prospect_rankings insert failed: ${error.message}`);
    }
    written += slice.length;
  }

  return {
    source,
    sourceUrl,
    scraped: rows.length,
    matched: matchedRowCount,
    written,
    unmatchedNames,
    capturedAt,
  };
}
