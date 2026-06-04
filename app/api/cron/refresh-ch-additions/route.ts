import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdditionsSummary } from '@/lib/cardhedger';
import { recordCronRun, recordCronStart } from '@/lib/cron-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Nightly cron: snapshot CardHedger's additions-summary into `ch_additions`.
 *
 * CH's closest thing to a release calendar (River pointed us here 2026-06-03):
 * what they added each day. We pull a small lookback window (4 days) and upsert
 * on (added_date, set_name, subset) so a skipped night self-heals and re-pulls
 * never duplicate. /admin/data-health renders the feed + flags additions to
 * sets we already track (a re-match signal).
 *
 * Scheduled via vercel.json. Vercel sends the CRON_SECRET as a bearer token.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  await recordCronStart('/api/cron/refresh-ch-additions', started);

  // 4-day lookback so a missed night back-fills; CH reports t-1 so this also
  // catches yesterday once it lands.
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 4);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const rows = await getAdditionsSummary(iso(start), iso(today));

    // Upsert each (added_date, set_name, subset). card_count/variants refresh
    // in case CH revises a day's totals.
    let upserted = 0;
    const CHUNK = 200;
    const fetchedAt = new Date().toISOString();
    const records = rows
      .filter(r => r.added_date && r.set_name)
      .map(r => ({
        added_date: r.added_date,
        category: r.category,
        set_name: r.set_name,
        subset: r.subset,
        variants: r.variants,
        card_count: r.card_count,
        fetched_at: fetchedAt,
      }));
    for (let i = 0; i < records.length; i += CHUNK) {
      const slice = records.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin
        .from('ch_additions')
        .upsert(slice, { onConflict: 'added_date,set_name,subset' });
      if (error) throw error;
      upserted += slice.length;
    }

    await recordCronRun({
      cronPath: '/api/cron/refresh-ch-additions',
      startedAt: started,
      processed: rows.length,
      ok: upserted,
      errors: 0,
      skipped: rows.length - records.length,
      details: { window: `${iso(start)}..${iso(today)}`, rows: rows.length },
    });

    return NextResponse.json({
      window: `${iso(start)}..${iso(today)}`,
      fetched: rows.length,
      upserted,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/refresh-ch-additions] fatal', msg);
    await recordCronRun({
      cronPath: '/api/cron/refresh-ch-additions',
      startedAt: started,
      processed: 0, ok: 0, errors: 1, skipped: 0,
      details: { fatal: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
