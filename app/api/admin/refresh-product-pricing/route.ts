import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { refreshProductPricing } from '@/lib/pricing-refresh';
import { recordCronRun } from '@/lib/cron-log';

export const dynamic = 'force-dynamic';
// Vercel Pro: 300s cap. Covers jumbo products (6,000+ variants) which run
// ~160s under typical CH latency. The graceful-deadline logic in
// lib/pricing-refresh.ts still reserves budget for upsert regardless.
export const maxDuration = 300;

/**
 * Admin on-demand pricing refresh for a single product. Runs the full batch
 * CH fetch → fallback ladder → pricing_cache upsert. Replaces the old
 * `POST /api/pricing` live path, which has been demoted to cache-read.
 *
 * Also called by `/api/cron/refresh-pricing` once per active product, so each
 * product gets its own 300s budget instead of all of them sharing one.
 *
 * Auth: admin/contributor role via cookie OR `Authorization: Bearer <CRON_SECRET>`
 *       header (used by the cron).
 *
 * Body: { productId: string }
 * Returns: RefreshSummary from lib/pricing-refresh.ts
 */
export async function POST(req: NextRequest) {
  // Accept cron-secret auth (for the nightly fan-out) or admin cookie auth.
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const ok = await checkRole('admin', 'contributor');
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  // Cron-triggered worker checkpoint: write to cron_run_log so we have proof of
  // life even if the orchestrator's view of this fetch dies (TCP disconnect).
  // Skip for admin-cookie-triggered manual refreshes — those have a UI element
  // already showing progress; cron is the path that needed observability.
  const workerStarted = Date.now();
  if (isCron) {
    await recordCronRun({
      cronPath: '/api/admin/refresh-product-pricing/start',
      startedAt: workerStarted,
      processed: 0, ok: 0, errors: 0, skipped: 0,
      details: { productId },
    }).catch(err => console.error('[refresh-product-pricing] start checkpoint failed:', err));
  }

  try {
    const summary = await refreshProductPricing(productId);
    if (isCron) {
      await recordCronRun({
        cronPath: '/api/admin/refresh-product-pricing/done',
        startedAt: workerStarted,
        processed: summary.totalPlayers,
        ok: summary.cacheRowsWritten,
        errors: summary.partial ? 1 : 0,
        skipped: 0,
        details: { productId, summary },
      }).catch(err => console.error('[refresh-product-pricing] done checkpoint failed:', err));
    }
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/refresh-product-pricing]', msg);
    if (isCron) {
      await recordCronRun({
        cronPath: '/api/admin/refresh-product-pricing/error',
        startedAt: workerStarted,
        processed: 0, ok: 0, errors: 1, skipped: 0,
        details: { productId, error: msg },
      }).catch(logErr => console.error('[refresh-product-pricing] error checkpoint failed:', logErr));
    }
    return NextResponse.json({ error: msg, productId }, { status: 500 });
  }
}
