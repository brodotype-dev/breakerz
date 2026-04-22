import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
// Vercel Pro: 300s. The orchestrator awaits per-product HTTP fan-out responses.
// With concurrency=3 and per-product budget of 300s each, a batch of up to ~9
// products fits here cleanly; past that, some runners won't finish before we
// return, but the per-product invocations still complete on their own budget
// (they're separate Vercel invocations).
export const maxDuration = 300;

/**
 * Nightly at 4 AM UTC (see vercel.json).
 *
 * Fans out to `/api/admin/refresh-product-pricing` once per active product.
 * Each product gets its own Vercel invocation (its own 60s budget), so one
 * slow product doesn't starve the others.
 *
 * We await all fan-outs here so the cron reports a useful summary in logs.
 * If a single product errors/times out, the rest still complete.
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

    // Run fan-out concurrency-limited so we don't spawn 50 parallel invocations
    // on a Pro plan upgrade. Each invocation is already doing heavy CH work;
    // 3 at a time balances throughput against CH rate limits.
    const FAN_OUT_CONCURRENCY = 3;
    const results: Array<{
      productId: string;
      productName: string;
      ok: boolean;
      status?: number;
      error?: string;
      summary?: unknown;
    }> = [];
    let cursor = 0;
    const runners = Array.from(
      { length: Math.min(FAN_OUT_CONCURRENCY, priceable.length) },
      async () => {
        while (true) {
          const i = cursor++;
          if (i >= priceable.length) return;
          const product = priceable[i];
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
              results.push({
                productId: product.id,
                productName: product.name,
                ok: false,
                status: res.status,
                error: text.slice(0, 200),
              });
            } else {
              const summary = await res.json().catch(() => null);
              results.push({
                productId: product.id,
                productName: product.name,
                ok: true,
                summary,
              });
            }
          } catch (err) {
            results.push({
              productId: product.id,
              productName: product.name,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
    );
    await Promise.all(runners);

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
