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
 *  - Hard cap each fetch at PER_FETCH_TIMEOUT_MS so the orchestrator can give
 *    up on slow workers and dispatch the next product.
 *  - Stop dispatching new work once we're within ORCHESTRATOR_BUDGET_MS.
 *
 * Why CONCURRENCY=3: with 16 products fanning out at once, CH rate-limited
 * everyone and individual workers blew past their 300s cap. 3 keeps CH happy.
 *
 * 2026-05-10: removed the orchestrator-level abort signal that propagated
 * across all in-flight fetches at ORCHESTRATOR_BUDGET_MS. The intent was
 * "stop waiting on slow workers so the orchestrator can return on time," but
 * aborting the client side closed the TCP connection to each worker. On the
 * runtime BreakIQ is on, that disconnect appears to terminate the worker
 * function before any chunk completes — pricing_cache went 36+ hours without
 * a single write because every worker died before its first writeback. The
 * per-fetch AbortController still fires per-product if a single worker stalls,
 * but the orchestrator no longer signals an across-the-board cancellation.
 * Workers run truly independently on their own 300s invocations.
 */
const STALE_AFTER_HOURS = 22;
const CONCURRENCY = 3;
const PER_FETCH_TIMEOUT_MS = 280_000;
// Orchestrator must return + write cron_run_log inside Vercel's 300s kill.
// Stop dispatching new fetches at this mark; in-flight fetches are NOT
// aborted (workers continue writing to ch_price_cache and pricing_cache on
// their own invocations even if the orchestrator returns first).
const ORCHESTRATOR_BUDGET_MS = 285_000;

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

    // Per-fetch timeout only — no orchestrator-level abort signal (see header
    // comment). A slow individual worker times out at PER_FETCH_TIMEOUT_MS
    // so the next worker can dispatch, but the orchestrator never broadcasts
    // a global abort (which previously killed worker functions via TCP
    // disconnect on this runtime).
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
            ? 'per-fetch timeout (worker continues on its own invocation; check ch_price_cache for partial writes)'
            : err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }
    };

    // Process the queue with bounded concurrency. Stop dispatching new work
    // once the orchestrator's own budget is exhausted; in-flight fetches are
    // NOT aborted by the orchestrator (the global-abort approach killed
    // workers via TCP disconnect) — workers continue independently on their
    // own 300s invocations and finish writing ch_price_cache + pricing_cache.
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

    // Race the worker pool against a hard return deadline. If the deadline
    // wins, in-flight fetches are abandoned (orchestrator's view only — the
    // worker functions on the other end continue running on their own
    // invocations) so we still return in time to write cron_run_log.
    const HARD_RETURN_MS = 290_000;
    let raced = false;
    const workersDone = Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const hardReturn = new Promise<void>(resolve => {
      setTimeout(() => { raced = true; resolve(); }, HARD_RETURN_MS);
    });
    await Promise.race([workersDone, hardReturn]);

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
        hardReturnHit: raced,
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
