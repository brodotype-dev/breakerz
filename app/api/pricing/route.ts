/**
 * /api/pricing — consumer-facing pricing read.
 *
 * Both GET and POST return cached pricing only. POST exists for frontend
 * compatibility with the old "Refresh" button, but it no longer triggers a
 * live CardHedger fetch — that job moved to:
 *
 *   - `POST /api/admin/refresh-product-pricing`  (admin-on-demand, one product)
 *   - `/api/cron/refresh-pricing`                (nightly fan-out, all active)
 *
 * Reason: at 6,000+ variants per product × CH's 5-30s batch latency, we could
 * never finish a live refresh inside Vercel Hobby's 60s cap. Eight iterations
 * of the old POST pipeline ended in the same 504. See CHANGELOG 2026-04-22.
 */

import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import type { PlayerWithPricing } from '@/lib/types';

// `dynamic = 'force-dynamic'` was dropping us out of any caching layer
// even though the response is functionally the same for every user
// holding the same productId. Pricing data only changes when the cron
// or admin "Refresh Pricing" button rewrites pricing_cache rows (~6h
// cadence). Pulling the bulk DB read into `unstable_cache` with a 30s
// revalidate gives us in-memory cache hits across nearby requests
// without compromising fresh-pricing on actual updates.
//
// Auth check stays per-request — we don't want to cache 401 responses
// for unauthed users.

async function loadCachedRaw(productId: string) {
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

// Per-productId 30s cache. Key includes productId so different products
// don't collide. Tags allow targeted invalidation if we ever want to
// pop the cache after an admin pricing refresh (not wired up yet —
// 30s natural revalidation is acceptable; the admin button user
// already accepts a small wait).
async function loadCached(productId: string) {
  return unstable_cache(
    () => loadCachedRaw(productId),
    ['pricing-cache-read', productId],
    { revalidate: 30, tags: [`pricing-${productId}`] },
  )();
}

async function checkAuth(req: NextRequest) {
  if (process.env.NODE_ENV === 'development') return true;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

export async function GET(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
  try {
    const players = await loadCached(productId);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
  try {
    const players = await loadCached(productId);
    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
