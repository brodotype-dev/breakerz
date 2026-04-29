import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recordCronRun } from '@/lib/cron-log';

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
// Mirror refresh-pricing: hard budget that aborts in-flight fetches so the
// orchestrator returns cleanly inside the 300s Vercel cap and writes its
// cron_run_log row. Dormant pool is small so we rarely hit this in practice.
const ORCHESTRATOR_BUDGET_MS = 240_000;

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
      await recordCronRun({
        cronPath: '/api/cron/refresh-dormant-pricing',
        startedAt: started,
        processed: 0, ok: 0, errors: 0, skipped: 0,
        details: { message: 'no dormant products' },
      });
      return NextResponse.json({
        refreshed: 0,
        durationMs: Date.now() - started,
        message: 'no dormant products',
      });
    }

    // Same Vercel-Deployment-Protection workaround as refresh-pricing —
    // fan out to NEXT_PUBLIC_APP_URL with the host normalized to www so
    // the apex→www redirect doesn't drop our bearer header.
    const reqUrl = new URL(req.url);
    const isDeploymentHost = /\.vercel\.app$/i.test(reqUrl.host);
    let baseUrl: string;
    if (isDeploymentHost && process.env.NEXT_PUBLIC_APP_URL) {
      const aliasUrl = new URL(process.env.NEXT_PUBLIC_APP_URL);
      if (aliasUrl.hostname.split('.').length === 2) {
        aliasUrl.hostname = `www.${aliasUrl.hostname}`;
      }
      baseUrl = `${aliasUrl.protocol}//${aliasUrl.host}`;
    } else {
      baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    }
    const endpoint = `${baseUrl}/api/admin/refresh-product-pricing`;

    const orchestratorAbort = new AbortController();
    const orchestratorAbortTimer = setTimeout(
      () => orchestratorAbort.abort(),
      ORCHESTRATOR_BUDGET_MS,
    );

    const dispatchOne = async (product: { id: string; name: string }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_FETCH_TIMEOUT_MS);
      const onOrchAbort = () => ac.abort();
      orchestratorAbort.signal.addEventListener('abort', onOrchAbort);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({ productId: product.id }),
          signal: ac.signal,
          redirect: 'manual',
        });
        if (res.status >= 300 && res.status < 400) {
          return {
            productId: product.id,
            productName: product.name,
            ok: false,
            status: res.status,
            error: `redirected to ${res.headers.get('location') ?? 'unknown'}`,
          };
        }
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
        orchestratorAbort.signal.removeEventListener('abort', onOrchAbort);
      }
    };

    const results = await Promise.all(products.map(dispatchOne));
    clearTimeout(orchestratorAbortTimer);
    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    const durationMs = Date.now() - started;

    console.log(
      `[cron/refresh-dormant-pricing] processed=${results.length} ok=${okCount} err=${errCount} durationMs=${durationMs}`,
    );

    await recordCronRun({
      cronPath: '/api/cron/refresh-dormant-pricing',
      startedAt: started,
      processed: results.length,
      ok: okCount,
      errors: errCount,
      skipped: 0,
      details: { failures: results.filter(r => !r.ok).slice(0, 10) },
    });

    return NextResponse.json({
      total: products.length,
      ok: okCount,
      errors: errCount,
      durationMs,
      failures: results.filter(r => !r.ok),
    });
  } catch (err) {
    console.error('[cron/refresh-dormant-pricing]', err);
    await recordCronRun({
      cronPath: '/api/cron/refresh-dormant-pricing',
      startedAt: started,
      processed: 0, ok: 0, errors: 1, skipped: 0,
      details: { fatal: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
