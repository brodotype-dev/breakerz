import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { refreshBreakFeed } from '@/lib/break-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST → pull every active break-feed source, re-match against our active
 * products, upsert.
 *
 * Accepts either an admin/contributor session (the Refresh button on
 * /admin/break-feed) or `Authorization: Bearer ${CRON_SECRET}` so the nightly
 * cron and any script can drive the same path — same arrangement as
 * /api/admin/match-cardhedger.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;

  if (!isCron) {
    const auth = await checkRole('admin', 'contributor');
    if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const summary = await refreshBreakFeed();
    // Per-source failures are reported inside the summary rather than thrown:
    // one dead source should not hide a healthy one's results.
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Break feed refresh failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
