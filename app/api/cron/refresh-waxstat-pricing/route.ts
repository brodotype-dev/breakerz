import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshProductWaxstat } from '@/lib/waxstat-importer';
import { recordCronRun, recordCronStart } from '@/lib/cron-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_PATH = '/api/cron/refresh-waxstat-pricing';

// Weekly cron: refresh WaxStat box pricing for every active product with at
// least one waxstat_*_url configured. Scheduled Sundays 04:00 UTC via
// vercel.json. Serial per product (Firecrawl rate limits + we only have a
// handful of active products); per-format fetches inside refreshProductWaxstat
// are parallel.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  await recordCronStart(CRON_PATH, started);

  try {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('id, name, waxstat_hobby_url, waxstat_bd_url, waxstat_jumbo_url')
      .eq('is_active', true)
      .or('waxstat_hobby_url.not.is.null,waxstat_bd_url.not.is.null,waxstat_jumbo_url.not.is.null');

    if (error) {
      await recordCronRun({
        cronPath: CRON_PATH,
        startedAt: started,
        processed: 0, ok: 0, errors: 1, skipped: 0,
        details: { phase: 'load', error: error.message },
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const list = products ?? [];
    let ok = 0;
    let errors = 0;
    const perProduct: Array<{ id: string; name: string; ok: number; errors: number }> = [];

    for (const p of list) {
      try {
        const summary = await refreshProductWaxstat(p.id);
        ok += summary.ok;
        errors += summary.errors;
        perProduct.push({ id: p.id, name: p.name, ok: summary.ok, errors: summary.errors });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors++;
        perProduct.push({ id: p.id, name: p.name, ok: 0, errors: 1 });
        console.error(`[cron/refresh-waxstat-pricing] ${p.name}:`, msg);
      }
    }

    await recordCronRun({
      cronPath: CRON_PATH,
      startedAt: started,
      processed: list.length,
      ok,
      errors,
      skipped: 0,
      details: { perProduct },
    });

    return NextResponse.json({
      products: list.length,
      ok,
      errors,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordCronRun({
      cronPath: CRON_PATH,
      startedAt: started,
      processed: 0, ok: 0, errors: 1, skipped: 0,
      details: { phase: 'fatal', error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
