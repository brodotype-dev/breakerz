import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { refreshProductPricing } from '@/lib/pricing-refresh';

export const dynamic = 'force-dynamic';
// Vercel Hobby caps at 60s. For products with 6,000+ variants this may still
// time out — partial cache rows that were written before the cutoff survive.
// See BACKLOG items C (Pro upgrade) and D (per-variant price cache) for the
// proper fix.
export const maxDuration = 60;

/**
 * Admin on-demand pricing refresh for a single product. Runs the full batch
 * CH fetch → fallback ladder → pricing_cache upsert. Replaces the old
 * `POST /api/pricing` live path, which has been demoted to cache-read.
 *
 * Also called by `/api/cron/refresh-pricing` once per active product, so each
 * product gets its own 60s budget instead of all of them sharing one.
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

  try {
    const summary = await refreshProductPricing(productId);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/refresh-product-pricing]', msg);
    return NextResponse.json({ error: msg, productId }, { status: 500 });
  }
}
