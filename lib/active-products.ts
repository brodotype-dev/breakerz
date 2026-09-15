import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { ACTIVE_PRODUCTS_TAG } from '@/lib/cache-tags';
import type { Product, Sport } from '@/lib/types';
import type { ProductSignal } from '@/app/(consumer)/ActiveProductsBrowser';

/**
 * Active products + their consumer signals (7-day break counts, live hype tags).
 *
 * Shared by Research (the grid) and Home (the quick-value picker) so both hit
 * ONE cache entry rather than each running the queries. Prod is IO-constrained,
 * so that matters.
 *
 * Cache-safe: touches only supabaseAdmin — no cookies, no headers, nothing
 * per-user. Busted immediately by updateTag(ACTIVE_PRODUCTS_TAG) in the admin
 * product mutations. See docs/plans/2026-09-15-ux-rethink-build-plan.md and the
 * note in app/(consumer)/analysis/page.tsx on why the ROUTE can't be cached.
 */
const POSITIVE_HYPE_TAGS = new Set(['release_premium', 'underhyped']);

export async function getActiveProductsUncached(): Promise<{
  products: (Product & { sport: Sport })[];
  signals: Record<string, ProductSignal>;
}> {
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const [productsRes, breaksRes, hypeRes] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('*, sport:sports(*)')
      .eq('is_active', true)
      .order('year', { ascending: false }),
    supabaseAdmin
      .from('user_breaks')
      .select('product_id')
      .gte('created_at', sevenDaysAgoIso)
      .neq('status', 'abandoned'),
    supabaseAdmin
      .from('market_observations')
      .select('product_id, payload, observed_at')
      .eq('observation_type', 'hype_tag')
      .eq('scope_type', 'product')
      .gt('expires_at', nowIso)
      .is('superseded_at', null)
      .order('observed_at', { ascending: false }),
  ]);

  const products = productsRes.data ?? [];

  const breakCounts: Record<string, number> = {};
  for (const row of breaksRes.data ?? []) {
    const pid = (row as { product_id: string }).product_id;
    breakCounts[pid] = (breakCounts[pid] ?? 0) + 1;
  }

  const hypeTags: Record<string, { tag: string; observedAt: string }> = {};
  for (const row of hypeRes.data ?? []) {
    const r = row as { product_id: string; payload: { tag?: string }; observed_at: string };
    if (hypeTags[r.product_id]) continue;
    if (!r.payload?.tag || !POSITIVE_HYPE_TAGS.has(r.payload.tag)) continue;
    hypeTags[r.product_id] = { tag: r.payload.tag, observedAt: r.observed_at };
  }

  const signals: Record<string, ProductSignal> = {};
  for (const p of products) {
    signals[p.id] = {
      breakCount7d: breakCounts[p.id] ?? 0,
      hypeTag: hypeTags[p.id] ?? null,
    };
  }

  return { products, signals };
}

// Safe to cache: getProductsUncached touches only supabaseAdmin (service role)
// — no cookies, no headers, nothing per-user. The grid is identical for every
// logged-in user, so one set of queries per 60s serves every navigation in that
// window, and revalidateTag(ACTIVE_PRODUCTS_TAG) in the admin product actions
// drops it the moment a product changes.
export const getActiveProducts = unstable_cache(
  getActiveProductsUncached,
  ['research-active-products'],
  { revalidate: 60, tags: [ACTIVE_PRODUCTS_TAG] },
);

