import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Pricing refresh orchestrator. Scheduled at 4:00, 4:30, 5:00, 5:30, 6:00 UTC
 * (see vercel.json) — five staggered firings so the work is spread across an
 * hour-long window and any product that doesn't fit in one invocation gets
 * picked up by the next.
 *
 * Per invocation:
 *  - Pick active products whose latest pricing_cache.fetched_at is null or
 *    older than STALE_AFTER_HOURS, oldest first. Already-fresh products are
 *    skipped, so back-to-back firings don't redo work.
 *  - Dispatch CONCURRENCY workers in parallel via HTTP POST to
 *    /api/admin/refresh-product-pricing. Each worker runs on its own Vercel
 *    invocation with its own 300s budget.
 *  - Hard cap each fetch at PER_FETCH_TIMEOUT_MS so the orchestrator returns
 *    inside its own 300s budget. Aborted workers keep running and writing to
 *    pricing_cache regardless.
 *  - Stop dispatching new batches once we're within DEADLINE_BUFFER_MS of the
 *    orchestrator's 300s cap.
 *
 * Why CONCURRENCY=3: with 16 products fanning out at once, CH rate-limited
 * everyone and individual workers blew past their 300s cap. 3 keeps CH happy.
 */
const STALE_AFTER_HOURS = 22;
const CONCURRENCY = 3;
const PER_FETCH_TIMEOUT_MS = 240_000;
const ORCHESTRATOR_BUDGET_MS = 270_000;

type FetchOutcome = {
  productId: string;
  productName: string;
  ok: boolean;
  status?: number;
  error?: string;
  summary?: unknown;
};

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
      .eq('is_active', true)
      .eq('lifecycle_status', 'live');

    if (error) throw error;
    if (!products?.length) return NextResponse.json({ refreshed: 0 });

    // Build a stale-first queue: products whose latest pricing_cache row is
    // null or older than STALE_AFTER_HOURS. Oldest first so we make progress
    // on the most-stale products even if we run out of budget.
    const staleCutoff = new Date(Date.now() - STALE_AFTER_HOURS * 3600 * 1000).toISOString();
    const { data: cacheRows, error: cacheErr } = await supabaseAdmin
      .from('pricing_cache')
      .select('fetched_at, player_products!inner(product_id)');
    if (cacheErr) throw cacheErr;

    const lastFetchedByProduct = new Map<string, string>();
    for (const row of cacheRows ?? []) {
      const productId = (row.player_products as unknown as { product_id?: string })?.product_id;
      if (!productId) continue;
      const existing = lastFetchedByProduct.get(productId);
      if (!existing || row.fetched_at > existing) {
        lastFetchedByProduct.set(productId, row.fetched_at);
      }
    }

    type QueueItem = { id: string; name: string; lastFetched: string | null };
    const queue: QueueItem[] = products
      .map(p => ({
        id: p.id,
        name: p.name,
        lastFetched: lastFetchedByProduct.get(p.id) ?? null,
      }))
      .filter(p => p.lastFetched == null || p.lastFetched < staleCutoff)
      .sort((a, b) => {
        if (a.lastFetched == null && b.lastFetched == null) return 0;
        if (a.lastFetched == null) return -1;
        if (b.lastFetched == null) return 1;
        return a.lastFetched < b.lastFetched ? -1 : 1;
      });

    if (queue.length === 0) {
      return NextResponse.json({
        total: products.length,
        stale: 0,
        processed: 0,
        durationMs: Date.now() - started,
        message: 'all products fresh, nothing to do',
      });
    }

    // Vercel cron invokes us at the deployment URL (*.vercel.app), which is
    // behind Vercel Deployment Protection (SSO). Fan-out POSTs to that host
    // hit the SSO wall before reaching the app and fail 16/16 — the silent
    // failure pattern that hid this for weeks. Always fan out to the
    // production alias (NEXT_PUBLIC_APP_URL) which has no SSO. We still fall
    // back to req.url for local dev / preview deployments.
    //
    // NEXT_PUBLIC_APP_URL must be the canonical www host (e.g.
    // https://www.getbreakiq.com). If you set it to the apex, the apex→www
    // 301 downgrades POST to GET.
    const reqUrl = new URL(req.url);
    const productionAlias = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    const isDeploymentHost = /\.vercel\.app$/i.test(reqUrl.host);
    const baseUrl = isDeploymentHost && productionAlias
      ? productionAlias
      : `${reqUrl.protocol}//${reqUrl.host}`;
    const endpoint = `${baseUrl}/api/admin/refresh-product-pricing`;
    console.log(`[cron/refresh-pricing] reqHost=${reqUrl.host} fanOutHost=${new URL(endpoint).host}`);

    const dispatchOne = async (product: QueueItem): Promise<FetchOutcome> => {
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
          ok: true,
          summary,
        };
      } catch (err) {
        const aborted = ac.signal.aborted;
        return {
          productId: product.id,
          productName: product.name,
          ok: false,
          error: aborted
            ? 'orchestrator aborted fetch (worker may still complete on its own invocation)'
            : err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }
    };

    // Process the queue with bounded concurrency. Stop dispatching new work
    // once the orchestrator's own budget is exhausted; in-flight work
    // continues until PER_FETCH_TIMEOUT_MS or its own completion.
    const results: FetchOutcome[] = [];
    let cursor = 0;
    const skipped: QueueItem[] = [];

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const item = queue[idx];
        if (Date.now() - started > ORCHESTRATOR_BUDGET_MS) {
          skipped.push(item);
          continue;
        }
        const outcome = await dispatchOne(item);
        results.push(outcome);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    const durationMs = Date.now() - started;

    console.log(
      `[cron/refresh-pricing] processed=${results.length} ok=${okCount} err=${errCount} skipped=${skipped.length} durationMs=${durationMs}`,
    );

    return NextResponse.json({
      total: products.length,
      stale: queue.length,
      processed: results.length,
      ok: okCount,
      errors: errCount,
      skipped: skipped.length,
      skippedProducts: skipped.map(s => s.name),
      durationMs,
      failures: results.filter(r => !r.ok),
    });
  } catch (err) {
    console.error('[cron/refresh-pricing]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
