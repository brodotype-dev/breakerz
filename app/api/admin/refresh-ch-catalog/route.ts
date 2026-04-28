import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRole } from '@/lib/auth';
import { refreshSetCatalog, findCanonicalSet } from '@/lib/cardhedger-catalog';

export const dynamic = 'force-dynamic';
// 300s — large sets (Topps Baseball at 56k cards across ~561 pages with
// CONCURRENCY=4) take 100–200s including retries on CH transient 5xx.
// Match the cron's budget so admin-on-demand never times out where the cron
// would have completed.
export const maxDuration = 300;

/**
 * Admin-invoked on-demand CH catalog refresh for a single product.
 * Resolves ch_set_name via /set-search if missing, then paginates the full set
 * into ch_set_cache. See docs/catalog-preload-architecture.md for the pipeline.
 *
 * Body: { productId: string }
 * Returns: { setName, cardsFetched, pagesFetched, durationMs }
 */
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, ch_set_name, sport:sports(name)')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  let chSetName = product.ch_set_name as string | null;

  // Auto-resolve canonical name if the product doesn't have one stored.
  if (!chSetName) {
    const productName = product.name ?? '';
    const sportName = ((product as unknown as { sport: { name?: string } | null }).sport)?.name;
    const yearMatch = productName.match(/^(\d{4})/);
    const year = yearMatch?.[1] ?? '';
    const shortSetName = productName
      .replace(/^\d{4}(?:-\d{2})?\s+/, '')
      .replace(/\s+(baseball|basketball|football|soccer)\s*$/i, '')
      .trim();
    const category = sportName
      ? sportName.charAt(0).toUpperCase() + sportName.slice(1).toLowerCase()
      : undefined;

    const candidates = await findCanonicalSet(`${year} ${shortSetName}`.trim(), category);
    chSetName = candidates[0]?.set_name ?? null;

    if (chSetName) {
      await supabaseAdmin
        .from('products')
        .update({ ch_set_name: chSetName })
        .eq('id', productId);
    }
  }

  if (!chSetName) {
    return NextResponse.json(
      { error: 'Could not resolve a CardHedger set name for this product.' },
      { status: 422 },
    );
  }

  try {
    const result = await refreshSetCatalog(chSetName, { productId });
    return NextResponse.json({ ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/refresh-ch-catalog]', msg);
    return NextResponse.json({ error: msg, setName: chSetName }, { status: 500 });
  }
}
