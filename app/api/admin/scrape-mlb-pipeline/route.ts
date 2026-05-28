import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { scrapeMlbPipelineTop100, MLB_PIPELINE_TOP100_URL } from '@/lib/scrapers/mlb-pipeline';
import { importMlbPipelineRankings } from '@/lib/prospect-rankings-import';

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
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'MLB Pipeline scrape failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
