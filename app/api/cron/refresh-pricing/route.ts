import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
// Vercel Pro: 300s. The orchestrator itself is just dispatching HTTP fan-outs
// — the actual heavy work runs on separate Vercel invocations (each with its
// own 300s budget via app/api/admin/refresh-product-pricing/route.ts).
// The orchestrator completes when the slowest per-product call returns, which
// in practice is bounded by the longest product's refresh time (~200s for
// Bowman Chrome today). All products fan out in parallel — no throttle — so
// this scales to however many active products we have.
export const maxDuration = 300;

/**
 * Nightly at 4 AM UTC (see vercel.json).
 *
 * Fans out to `/api/admin/refresh-product-pricing` once per active product
 * that has at least one CH-matched player_product. All dispatches happen in
 * parallel; each runs on its own Vercel invocation with an independent 300s
 * budget. One slow product can't starve the others.
 *
 * We await all fan-outs here so the cron reports a useful summary in logs.
 * If a single product errors/times out, the others still complete.
 *
 * Scale note: this scales to at least 50 active products without trouble. Past
 * that, CH rate limits become the bottleneck — if we hit them, reintroduce a
 * concurrency cap here (was previously 3).
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();

  try {
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('id, name')
      .eq('is_active', true);

    if (error) throw error;
    if (!products?.length) return NextResponse.json({ refreshed: 0 });

    // Find products that actually have something priceable. Skip the rest.
    const priceable: { id: string; name: string }[] = [];
    for (const p of products) {
      const { count } = await supabaseAdmin
        .from('player_products')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', p.id)
        .not('cardhedger_card_id', 'is', null);
      if ((count ?? 0) > 0) priceable.push(p);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbreakiq.com';
    const endpoint = `${baseUrl}/api/admin/refresh-product-pricing`;

    // Fan out ALL products in parallel. Each fetch spawns its own Vercel
    // invocation with an independent 300s budget, so one slow product can't
    // starve the others. This orchestrator's only job is to dispatch and
    // collect — it does no heavy work itself.
    const results = await Promise.all(
      priceable.map(async product => {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({ productId: product.id }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            return {
              productId: product.id,
              productName: product.name,
              ok: false,
              status: res.status,
              error: text.slice(0, 200),
            };
          }
          const summary = await res.json().catch(() => null);
          return {
            productId: product.id,
            productName: product.name,
            ok: true as const,
            summary,
          };
        } catch (err) {
          return {
            productId: product.id,
            productName: product.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    const durationMs = Date.now() - started;

    console.log(
      `[cron/refresh-pricing] ${okCount}/${results.length} ok (${errCount} errors) in ${durationMs}ms`,
    );

    return NextResponse.json({
      total: priceable.length,
      ok: okCount,
      errors: errCount,
      durationMs,
      results: results.filter(r => !r.ok), // Only return the failures in the payload
    });
  } catch (err) {
    console.error('[cron/refresh-pricing]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
