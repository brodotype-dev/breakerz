import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { get90DayPrices } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MIN_RAW_SALES_FOR_HISTORY = 3; // below this, treat as data-light
const CONCURRENCY = 5;

interface SnapshotRow {
  player_product_id: string;
  has_history: boolean;
  raw_avg_90d: number | null;
  psa9_avg_90d: number | null;
  psa10_avg_90d: number | null;
  raw_sales_90d: number | null;
  psa9_sales_90d: number | null;
  psa10_sales_90d: number | null;
}

/**
 * Pre-release player snapshots.
 *
 * For each player on a pre-release product's checklist, returns a snapshot of
 * what their existing cards do on the secondary market today. Rookies are
 * deliberately skipped (per product spec — stay data-light for first-year
 * cards).
 *
 * Cached per player_product with a 24h TTL. Cold cache for a 100-player
 * product runs at ~5 concurrent CH calls and finishes well under 60s.
 *
 * POST { productId: string }
 * → { snapshots: SnapshotRow[] }
 */
export async function POST(req: Request) {
  try {
    const { productId } = await req.json();
    if (!productId) {
      return NextResponse.json({ error: 'productId required' }, { status: 400 });
    }

    // Resolve product (need sport name for CH search) + roster
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('id, lifecycle_status, sport:sports(name)')
      .eq('id', productId)
      .single();
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    if (product.lifecycle_status !== 'pre_release') {
      // Endpoint is pre-release-only — once a product is live, the regular
      // pricing engine takes over.
      return NextResponse.json({ snapshots: [] });
    }
    const sportName = (product.sport as any)?.name as string | undefined;

    const { data: roster } = await supabaseAdmin
      .from('player_products')
      .select('id, player:players(id, name, is_rookie)')
      .eq('product_id', productId);

    if (!roster?.length) {
      return NextResponse.json({ snapshots: [] });
    }

    // Pull existing fresh cache rows in one query
    const ppIds = roster.map(r => r.id);
    const { data: cached } = await supabaseAdmin
      .from('pre_release_player_snapshots')
      .select('*')
      .in('player_product_id', ppIds);
    const cacheByPP = new Map<string, any>();
    for (const row of cached ?? []) cacheByPP.set(row.player_product_id, row);

    const cutoff = Date.now() - TTL_MS;
    const stale: typeof roster = [];
    const results: SnapshotRow[] = [];

    for (const r of roster) {
      const c = cacheByPP.get(r.id);
      if (c && new Date(c.fetched_at).getTime() > cutoff) {
        results.push({
          player_product_id: r.id,
          has_history: c.has_history,
          raw_avg_90d: c.raw_avg_90d,
          psa9_avg_90d: c.psa9_avg_90d,
          psa10_avg_90d: c.psa10_avg_90d,
          raw_sales_90d: c.raw_sales_90d,
          psa9_sales_90d: c.psa9_sales_90d,
          psa10_sales_90d: c.psa10_sales_90d,
        });
        continue;
      }
      stale.push(r);
    }

    // Hit CH for stale rows in parallel (capped concurrency).
    if (stale.length > 0) {
      const fresh = await runWithConcurrency(stale, CONCURRENCY, async (r) => {
        const player = r.player as any;
        const playerName: string = player?.name ?? '';
        const isRookie: boolean = !!player?.is_rookie;

        // Rookies skip the CH lookup entirely — first-year cards mostly don't
        // exist yet, and querying for "Wemby" pre-2023 returned college noise.
        if (isRookie || !playerName.trim()) {
          return {
            player_product_id: r.id,
            has_history: false,
            raw_avg_90d: null,
            psa9_avg_90d: null,
            psa10_avg_90d: null,
            raw_sales_90d: null,
            psa9_sales_90d: null,
            psa10_sales_90d: null,
          } as SnapshotRow;
        }

        try {
          const data = await get90DayPrices(playerName, undefined, sportName);
          const raw = data.prices?.find(p => p.grade === 'Raw');
          const psa9 = data.prices?.find(p => p.grade === 'PSA 9');
          const psa10 = data.prices?.find(p => p.grade === 'PSA 10');
          const rawSales = raw?.sale_count ?? 0;
          const hasHistory = rawSales >= MIN_RAW_SALES_FOR_HISTORY;
          return {
            player_product_id: r.id,
            has_history: hasHistory,
            raw_avg_90d: hasHistory ? Number(raw?.avg_price ?? null) : null,
            psa9_avg_90d: psa9?.sale_count ? Number(psa9.avg_price ?? null) : null,
            psa10_avg_90d: psa10?.sale_count ? Number(psa10.avg_price ?? null) : null,
            raw_sales_90d: hasHistory ? rawSales : null,
            psa9_sales_90d: psa9?.sale_count ?? null,
            psa10_sales_90d: psa10?.sale_count ?? null,
          } as SnapshotRow;
        } catch (err) {
          console.error('[pre-release/player-snapshots] CH error for', playerName, err);
          return {
            player_product_id: r.id,
            has_history: false,
            raw_avg_90d: null,
            psa9_avg_90d: null,
            psa10_avg_90d: null,
            raw_sales_90d: null,
            psa9_sales_90d: null,
            psa10_sales_90d: null,
          } as SnapshotRow;
        }
      });

      // Persist to cache (upsert).
      const upserts = fresh.map(s => ({
        player_product_id: s.player_product_id,
        has_history: s.has_history,
        raw_avg_90d: s.raw_avg_90d,
        psa9_avg_90d: s.psa9_avg_90d,
        psa10_avg_90d: s.psa10_avg_90d,
        raw_sales_90d: s.raw_sales_90d,
        psa9_sales_90d: s.psa9_sales_90d,
        psa10_sales_90d: s.psa10_sales_90d,
        fetched_at: new Date().toISOString(),
      }));
      if (upserts.length > 0) {
        const { error: upErr } = await supabaseAdmin
          .from('pre_release_player_snapshots')
          .upsert(upserts, { onConflict: 'player_product_id' });
        if (upErr) console.error('[pre-release/player-snapshots] upsert failed:', upErr);
      }

      results.push(...fresh);
    }

    return NextResponse.json({ snapshots: results });
  } catch (err) {
    console.error('[pre-release/player-snapshots]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/** Cap parallelism so we don't hammer CH or saturate the function's network slots. */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}
