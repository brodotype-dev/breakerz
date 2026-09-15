import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { ACTIVE_PRODUCTS_TAG } from '@/lib/cache-tags';
import type { Product, Sport } from '@/lib/types';
import ActiveProductsBrowser, { type ProductSignal } from '../ActiveProductsBrowser';
import AnalysisClient from './AnalysisClient';

/**
 * Research — value a spot, then browse what's live.
 *
 * Active Products moved here from the old `/breaks` page (2026-09-15): the
 * product grid belongs next to the tool that values a spot, not on its own
 * destination. `/breaks` was merged into Breaks (`/my-breaks`), which is the
 * historical record of what you analyzed and bought.
 *
 * This file is a SERVER wrapper because the grid needs a richer query than the
 * client's `/api/analysis` products list (7-day break counts + active hype
 * tags). The valuation tool itself stays client-side in AnalysisClient.
 */

// NO `export const revalidate` here, deliberately.
//
// The old /breaks page carried `revalidate = 60` plus a comment claiming the
// render was cached and that admin mutations busted it via revalidatePath('/').
// Both were false, verified 2026-09-15 against the build's prerender manifest:
// this route is absent from it, i.e. DYNAMIC. The consumer layout calls
// getCurrentUserFromSession() -> cookies(), which opts the whole segment into
// dynamic rendering and makes any `revalidate` on the page inert. And no
// revalidatePath('/') exists anywhere in app/admin.
//
// So the page render was never cached — meaning every navigation re-ran the
// three Supabase queries below. That's the cost worth fixing (prod is
// IO-constrained), not a staleness problem: edits already appeared instantly.
//
// Fix: cache the DATA rather than the render, and tag it so admin product
// mutations bust it immediately. Same pattern as lib/pricing-read.ts.
// (The tag lives in lib/cache-tags.ts — page modules may only export a known
// set of names, so declaring it here is a type error.)

const POSITIVE_HYPE_TAGS = new Set(['release_premium', 'underhyped']);

async function getProductsUncached(): Promise<{
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
const getProducts = unstable_cache(
  getProductsUncached,
  ['research-active-products'],
  { revalidate: 60, tags: [ACTIVE_PRODUCTS_TAG] },
);

export default async function ResearchPage() {
  const { products, signals } = await getProducts();

  return (
    <>
      <AnalysisClient />

      {/* Active products — below the two boxes, per the 2026-09-15 IA change. */}
      <div className="px-6 pb-12">
        <div className="max-w-7xl mx-auto">
          <div className="mb-5" style={{ borderTop: '1px solid var(--rule)', paddingTop: 26 }}>
            <div
              className="font-mono uppercase mb-1"
              style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}
            >
              Active products
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink2)' }}>
              Every product we&rsquo;re pricing right now. Pick one to value a spot in it.
            </p>
          </div>
          <ActiveProductsBrowser products={products} signals={signals} />
        </div>
      </div>
    </>
  );
}
