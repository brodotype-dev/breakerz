/**
 * lib/pricing-read.ts — shared cached read of the consumer pricing view.
 *
 * Extracted from `app/api/pricing/route.ts` so both the API route AND
 * server components can import the same `unstable_cache`-wrapped function
 * without going through an internal HTTP roundtrip.
 *
 * Behavior is identical to what the route had before the extraction:
 *
 *   - Fetches `player_products` (non-insert-only) for the productId.
 *   - Joins each row's pricing from `pricing_cache` (24h TTL on the table,
 *     30s in-memory cache via unstable_cache).
 *   - Skips the cross-product fallback path — that was never wired up
 *     through this code path; live + estimated pricing comes from
 *     pricing_cache only.
 *
 * Auth: this helper does NOT check auth. Callers must gate access.
 * The API route still calls `supabase.auth.getUser()` before invoking
 * this function. Server components called from authenticated route
 * groups (e.g. `app/(consumer)/...`) inherit middleware's session check.
 */

import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from './supabase';
import type { PlayerWithPricing } from './types';

async function loadCachedRaw(productId: string): Promise<PlayerWithPricing[]> {
  const { data: playerProducts, error } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility, c_score')
    .eq('product_id', productId)
    .eq('insert_only', false)
    .order('id');

  if (error) throw error;
  if (!playerProducts?.length) return [];

  const ids = playerProducts.map(pp => pp.id);

  // Chunked .in() — 278+ UUIDs exceeds PostgREST's ~8KB URL limit.
  // See CLAUDE.md gotcha #11.
  const IN_CHUNK = 200;
  const cached: { player_product_id: string; ev_low: number; ev_mid: number; ev_high: number; confidence: number | null }[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error: cErr } = await supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, ev_low, ev_mid, ev_high, confidence')
      .in('player_product_id', slice)
      .gt('expires_at', new Date().toISOString());
    if (cErr) throw cErr;
    if (data) cached.push(...data);
  }

  const cacheMap = new Map(cached.map(c => [c.player_product_id, c]));

  const players: PlayerWithPricing[] = playerProducts.map(pp => {
    const c = cacheMap.get(pp.id);
    const evMid = c?.ev_mid ?? 0;
    return {
      ...pp,
      evLow: c?.ev_low ?? 0,
      evMid,
      evHigh: c?.ev_high ?? 0,
      hobbyEVPerBox: evMid,
      hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
      totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
      pricingSource: c ? 'cached' as const : 'none' as const,
      confidence: c?.confidence ?? null,
    };
  });

  return players;
}

/**
 * Per-productId 30s cache for the consumer pricing view.
 *
 * The underlying `pricing_cache` table is rewritten by:
 *   - `/api/cron/refresh-pricing` (nightly fan-out, ~6h cadence)
 *   - `POST /api/admin/refresh-product-pricing` (admin button, on-demand)
 *
 * 30s in-memory cache means consecutive requests within that window
 * skip the DB read entirely. Cache key includes productId so different
 * products don't collide. Tag is per-product so a future invalidation
 * hook can bust via `revalidateTag` if we wire it up.
 */
export async function loadCached(productId: string): Promise<PlayerWithPricing[]> {
  return unstable_cache(
    () => loadCachedRaw(productId),
    ['pricing-cache-read', productId],
    { revalidate: 30, tags: [`pricing-${productId}`] },
  )();
}
