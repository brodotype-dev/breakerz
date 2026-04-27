import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { hydrateVariantsFromCatalog } from '@/lib/variants-from-catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Admin-invoked variant hydration from ch_set_cache.
 *
 * Replaces the product's player_product_variants with one row per matching
 * ch_set_cache entry, pre-linked via cardhedger_card_id. See
 * /Users/brody/.claude/plans/polymorphic-gathering-valley.md for rationale.
 *
 * Body: { productId: string }
 * Returns: HydrateResult — see lib/variants-from-catalog.ts
 */
export async function POST(req: NextRequest) {
  // Accept admin cookie auth OR Authorization: Bearer <CRON_SECRET> for
  // server-to-server invocations (e.g. one-off bulk re-hydrate scripts).
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const auth = await checkRole('admin', 'contributor');
    if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { productId } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: 'productId required' }, { status: 400 });
  }

  try {
    const result = await hydrateVariantsFromCatalog(productId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/hydrate-variants]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
