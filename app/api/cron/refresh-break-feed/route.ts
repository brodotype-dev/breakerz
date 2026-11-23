import { NextResponse } from 'next/server';
import { refreshBreakFeed } from '@/lib/break-feed';
import { recordCronRun, recordCronStart } from '@/lib/cron-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Nightly cron: refresh the break feed.
 *
 * Cheap — one Alexandria call per Steel City page (3 today) plus one Firecrawl
 * scrape per Fanatics Live shop. Runs at 09:00 UTC, after the pricing crons
 * have finished competing for the function budget.
 *
 * `recordCronStart` fires at entry so the admin Cron Status panel sees the run
 * even if we get killed before the summary lands (the catalog cron learned
 * this the hard way — see CLAUDE.md observability notes).
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  await recordCronStart('/api/cron/refresh-break-feed', started);

  try {
    const summary = await refreshBreakFeed();

    await recordCronRun({
      cronPath: '/api/cron/refresh-break-feed',
      startedAt: started,
      processed: summary.rowsSeen,
      ok: summary.rowsUpserted,
      errors: summary.errors.length,
      skipped: summary.nonSportsSkipped,
      details: { summary },
    });

    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Break feed refresh failed';
    await recordCronRun({
      cronPath: '/api/cron/refresh-break-feed',
      startedAt: started,
      processed: 0,
      ok: 0,
      errors: 1,
      skipped: 0,
      details: { error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
