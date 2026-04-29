import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { recordCronRun } from '@/lib/cron-log';

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
// Orchestrator must finish its own work + write cron_run_log + return JSON
// before Vercel's 300s hard kill. Earlier we ran orchestrator to 270s, but
// in-flight fan-out fetches kept us alive past 300s and Vercel killed us
// before cron_run_log got written. 240s gives 60s headroom; in-flight
// fetches get aborted via the shared signal so workers exit deterministically.
// Per-product workers run on their own invocations and keep going regardless,
// so aborting the orchestrator's *view* of them doesn't lose work.
const ORCHESTRATOR_BUDGET_MS = 240_000;

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
      await recordCronRun({
        cronPath: '/api/cron/refresh-pricing',
        startedAt: started,
        processed: 0,
        ok: 0,
        errors: 0,
        skipped: 0,
        details: { total: products.length, message: 'all products fresh' },
      });
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
    // hit the SSO wall before reaching the app and fail 16/16 silently.
    // Resolve to the production alias (NEXT_PUBLIC_APP_URL), forcing the
    // www-prefixed host: an apex POST 307s to www and Vercel's edge strips
    // the Authorization header on that host change, so the fan-out arrives
    // unauthenticated and middleware redirects it to /admin/login (405).
    const reqUrl = new URL(req.url);
    const isDeploymentHost = /\.vercel\.app$/i.test(reqUrl.host);
    let baseUrl: string;
    if (isDeploymentHost && process.env.NEXT_PUBLIC_APP_URL) {
      const aliasUrl = new URL(process.env.NEXT_PUBLIC_APP_URL);
      // Normalize bare apex (getbreakiq.com) to www to skip the redirect that
      // would otherwise drop our bearer header.
      if (aliasUrl.hostname.split('.').length === 2) {
        aliasUrl.hostname = `www.${aliasUrl.hostname}`;
      }
      baseUrl = `${aliasUrl.protocol}//${aliasUrl.host}`;
    } else {
      baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    }
    const endpoint = `${baseUrl}/api/admin/refresh-product-pricing`;
    console.log(`[cron/refresh-pricing] reqHost=${reqUrl.host} fanOutHost=${new URL(endpoint).host}`);

    // Hard budget abort: when we hit ORCHESTRATOR_BUDGET_MS, every in-flight
    // fan-out fetch is signaled to abort. Without this, a fetch dispatched at
    // t=200s could await its own 240s timeout — orchestrator stays alive past
    // 300s and Vercel kills it before cron_run_log writes.
    const orchestratorAbort = new AbortController();
    const orchestratorAbortTimer = setTimeout(
      () => orchestratorAbort.abort(),
      ORCHESTRATOR_BUDGET_MS,
    );

    const dispatchOne = async (product: QueueItem): Promise<FetchOutcome> => {
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
          // Don't auto-follow: a redirect means our bearer was dropped or
          // we're talking to the wrong host. Surface it as an explicit
          // failure with the redirect target so we can diagnose instead of
          // ending up at /admin/login with a confusing 405.
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
        orchestratorAbort.signal.removeEventListener('abort', onOrchAbort);
      }
    };

    // Process the queue with bounded concurrency. Stop dispatching new work
    // once the orchestrator's own budget is exhausted; in-flight fetches get
    // aborted by orchestratorAbort, but per-product workers run on their own
    // Vercel invocations and finish writing pricing_cache regardless.
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
    clearTimeout(orchestratorAbortTimer);

    const okCount = results.filter(r => r.ok).length;
    const errCount = results.length - okCount;
    const durationMs = Date.now() - started;

    console.log(
      `[cron/refresh-pricing] processed=${results.length} ok=${okCount} err=${errCount} skipped=${skipped.length} durationMs=${durationMs}`,
    );

    await recordCronRun({
      cronPath: '/api/cron/refresh-pricing',
      startedAt: started,
      processed: results.length,
      ok: okCount,
      errors: errCount,
      skipped: skipped.length,
      details: {
        total: products.length,
        stale: queue.length,
        fanOutHost: new URL(endpoint).host,
        skippedProducts: skipped.map(s => s.name),
        failures: results.filter(r => !r.ok).slice(0, 10),
      },
    });

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
    await recordCronRun({
      cronPath: '/api/cron/refresh-pricing',
      startedAt: started,
      processed: 0,
      ok: 0,
      errors: 1,
      skipped: 0,
      details: { fatal: err instanceof Error ? err.message : String(err) },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
