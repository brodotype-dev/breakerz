import { NextResponse } from 'next/server';
import {
  listActiveProductsWithCHSet,
  refreshSetCatalog,
} from '@/lib/cardhedger-catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — large sets can take a minute each

/**
 * Nightly cron: refresh ch_set_cache for every active product with a canonical ch_set_name.
 *
 * Runs serially across sets to be polite to CardHedger's API. Each call fires its own
 * internal concurrency (8 pages at a time), so we don't need to parallelize at the set level.
 *
 * Scheduled via vercel.json. Vercel sends the CRON_SECRET as a bearer token.
 * See docs/catalog-preload-architecture.md for where this fits in the pipeline.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();

  try {
    const products = await listActiveProductsWithCHSet();
    if (!products.length) {
      return NextResponse.json({ refreshed: 0, total: 0, durationMs: Date.now() - started });
    }

    // Deduplicate by ch_set_name — multiple products may share a canonical set.
    const uniqueSets = new Map<string, { setName: string; productId: string; productName: string }>();
    for (const p of products) {
      if (!uniqueSets.has(p.ch_set_name)) {
        uniqueSets.set(p.ch_set_name, {
          setName: p.ch_set_name,
          productId: p.id,
          productName: p.name,
        });
      }
    }

    let refreshed = 0;
    const errors: Array<{ setName: string; error: string }> = [];

    // Serial per set — bounded by CH rate limits and our own 5min maxDuration.
    for (const { setName, productId } of uniqueSets.values()) {
      try {
        const result = await refreshSetCatalog(setName, { productId });
        console.log(
          `[cron/refresh-ch-catalogs] "${setName}" — ${result.cardsFetched} cards in ${result.durationMs}ms`,
        );
        refreshed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/refresh-ch-catalogs] failed "${setName}":`, msg);
        errors.push({ setName, error: msg });
      }
    }

    return NextResponse.json({
      refreshed,
      total: uniqueSets.size,
      durationMs: Date.now() - started,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[cron/refresh-ch-catalogs] fatal', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
