import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { scrapeMlbPipelineTop100, MLB_PIPELINE_TOP100_URL } from '@/lib/scrapers/mlb-pipeline';
import { importMlbPipelineRankings } from '@/lib/prospect-rankings-import';
import { computeProspectDiff, describeMove } from '@/lib/prospect-rankings-diff';

export const dynamic = 'force-dynamic';
// Firecrawl scrape (waitFor 3s + render) + roster match + chunked inserts.
// Comfortably inside a generous window; 120s mirrors the waxstat refresh.
export const maxDuration = 120;

/**
 * POST /api/admin/scrape-mlb-pipeline
 *
 * Slice 1 of the web-sourced-intel plan (Track A). Scrapes the MLB
 * Pipeline Top 100, matches prospects against our baseball roster, and
 * writes matched rankings directly to prospect_rankings. No Discord
 * proposal — rank position is objective fact (architecture step 3). The
 * engine does not read prospect_rankings yet (gated behind
 * feature_flags.prospect_rank_enabled), so this is non-consumer-visible.
 *
 * Manual admin trigger only in Slice 1 (no cron). Body may optionally
 * override the URL for testing; defaults to the public Top 100 page.
 */
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let url = MLB_PIPELINE_TOP100_URL;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.url === 'string' && body.url.trim()) url = body.url.trim();
  } catch {
    // no body — use the default URL
  }

  try {
    const rows = await scrapeMlbPipelineTop100(url);
    const summary = await importMlbPipelineRankings(rows, url);

    // Slice 2a — compute material rank moves vs the prior scrape and
    // surface them in the response. This is report-only; turning approved
    // moves into derived signals (Slice 2b) is a separate decision.
    const diff = await computeProspectDiff(summary.source, summary.capturedAt);

    return NextResponse.json({
      ...summary,
      diff: {
        comparedAgainst: diff.comparedAgainst,
        riserCount: diff.riserCount,
        fallerCount: diff.fallerCount,
        newCount: diff.newCount,
        droppedCount: diff.droppedCount,
        // Structured + capped at 40 so the admin UI can render a
        // selectable checklist (player_id + ranks) for inline endorsement
        // → /api/admin/apply-prospect-moves. Full set lives in
        // prospect_rankings regardless.
        moves: diff.moves.slice(0, 40).map(m => ({
          playerId: m.playerId,
          playerName: m.playerName,
          source: summary.source,
          kind: m.kind,
          priorRank: m.priorRank,
          newRank: m.newRank,
          delta: m.delta,
          description: describeMove(m, summary.source),
        })),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'MLB Pipeline scrape failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
