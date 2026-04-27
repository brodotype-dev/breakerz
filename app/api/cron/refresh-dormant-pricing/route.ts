import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Biweekly dormant-pricing refresh.
 *
 * Scheduled twice a month (1st + 15th at 7 AM UTC, see vercel.json) to give
 * dormant products a "we still know what these are worth" snapshot without
 * burning the daily-cron budget on products no one is actively breaking.
 *
 * Flow mirrors /api/cron/refresh-pricing: fan out one HTTP call per dormant
 * product to /api/admin/refresh-product-pricing, each on its own Vercel
 * invocation. Dormant set is small (typically <10 products) so concurrency
 * isn't an issue — runs them all in parallel.
 *
 * If a dormant product is later reactivated (lifecycle → live), the daily
 * cron picks it up automatically next run; nothing to do here.
 */
const PER_FETCH_TIMEOUT_MS = 240_000;

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
      .eq('lifecycle_status', 'dormant');
    // Note: deliberately NOT gating on is_active — a dormant product might be
    // unpublished but we still want its frozen snapshot to stay accurate.

    if (error) throw error;
    if (!products?.length) {
      return NextResponse.json({
        refreshed: 0,
        durationMs: Date.now() - started,
        message: 'no dormant products',
      });
    }

    const reqUrl = new URL(req.url);
    const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const endpoint = `${baseUrl}/api/admin/refresh-product-pricing`;

    const dispatchOne = async (product: { id: string; name: string }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({ productId: product.id }),
          signal: ac.signal,
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
      } finally {
        clearTimeout(timer);
      }
    };

    const results = await Promise.all(products.map(dispatchOne));
    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    const durationMs = Date.now() - started;

    console.log(
      `[cron/refresh-dormant-pricing] processed=${results.length} ok=${okCount} err=${errCount} durationMs=${durationMs}`,
    );

    return NextResponse.json({
      total: products.length,
      ok: okCount,
      errors: errCount,
      durationMs,
      failures: results.filter(r => !r.ok),
    });
  } catch (err) {
    console.error('[cron/refresh-dormant-pricing]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
