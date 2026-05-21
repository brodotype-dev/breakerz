// WaxStat importer.
//
// For one product:
//   1. Read the three waxstat_*_url columns (hobby / BD / jumbo).
//   2. Fetch each non-null URL in parallel via fetchBoxPanel.
//   3. Write a waxstat_pricing_snapshots row per fetch (success or error).
//   4. Update the matching products.*_am_case_cost column with the latest
//      avgPrice when the fetch succeeded.
//
// Wax price ≈ case price for the format. WaxStat's "average price" is the
// average sealed-box transaction price across retailers, which is what
// "after-market case cost" already represents in our schema. One sealed
// box = one case for our case-mix math; this is the same convention the
// admin uses when typing a value into Hobby AM / Case manually.
//
// Errors are isolated per-format: a 404 on the hobby URL doesn't tank the
// BD + jumbo refreshes.

import { supabaseAdmin } from '@/lib/supabase';
import { fetchBoxPanel } from '@/lib/waxstat';

type Format = 'hobby' | 'bd' | 'jumbo';

const URL_COL: Record<Format, 'waxstat_hobby_url' | 'waxstat_bd_url' | 'waxstat_jumbo_url'> = {
  hobby: 'waxstat_hobby_url',
  bd: 'waxstat_bd_url',
  jumbo: 'waxstat_jumbo_url',
};

const AM_COST_COL: Record<Format, 'hobby_am_case_cost' | 'bd_am_case_cost' | 'jumbo_am_case_cost'> = {
  hobby: 'hobby_am_case_cost',
  bd: 'bd_am_case_cost',
  jumbo: 'jumbo_am_case_cost',
};

export type ProductWaxstatRefreshSummary = {
  productId: string;
  attempted: number;
  ok: number;
  errors: number;
  perFormat: Record<Format, { url: string | null; ok: boolean; error?: string; avgPrice?: number | null }>;
};

export async function refreshProductWaxstat(productId: string): Promise<ProductWaxstatRefreshSummary> {
  const { data: product, error } = await supabaseAdmin
    .from('products')
    .select('id, waxstat_hobby_url, waxstat_bd_url, waxstat_jumbo_url')
    .eq('id', productId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product ${productId}: ${error.message}`);
  if (!product) throw new Error(`Product ${productId} not found`);

  const formats: Format[] = ['hobby', 'bd', 'jumbo'];
  const perFormat: ProductWaxstatRefreshSummary['perFormat'] = {
    hobby: { url: null, ok: false },
    bd: { url: null, ok: false },
    jumbo: { url: null, ok: false },
  };

  let attempted = 0;
  let ok = 0;
  let errors = 0;

  await Promise.all(
    formats.map(async fmt => {
      const url = (product as Record<string, string | null>)[URL_COL[fmt]];
      perFormat[fmt].url = url;
      if (!url) return; // not configured for this format — skip silently

      attempted++;
      try {
        const panel = await fetchBoxPanel(url);
        await supabaseAdmin.from('waxstat_pricing_snapshots').insert({
          product_id: productId,
          format: fmt,
          source_url: url,
          avg_price: panel.avgPrice,
          low_30d: panel.low30d,
          high_30d: panel.high30d,
          trend_7d: panel.trend7d,
          error_message: null,
        });

        if (panel.avgPrice != null && panel.avgPrice > 0) {
          const { error: updErr } = await supabaseAdmin
            .from('products')
            .update({ [AM_COST_COL[fmt]]: panel.avgPrice })
            .eq('id', productId);
          if (updErr) throw new Error(`AM cost update failed: ${updErr.message}`);
        }

        perFormat[fmt] = { url, ok: true, avgPrice: panel.avgPrice };
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabaseAdmin.from('waxstat_pricing_snapshots').insert({
          product_id: productId,
          format: fmt,
          source_url: url,
          avg_price: null,
          low_30d: null,
          high_30d: null,
          trend_7d: null,
          error_message: msg.slice(0, 500),
        });
        perFormat[fmt] = { url, ok: false, error: msg };
        errors++;
      }
    }),
  );

  return { productId, attempted, ok, errors, perFormat };
}

export type LatestSnapshot = {
  format: Format;
  source_url: string;
  avg_price: number | null;
  low_30d: number | null;
  high_30d: number | null;
  trend_7d: number | null;
  error_message: string | null;
  fetched_at: string;
};

// Returns the latest snapshot per format for one product. Used by the
// admin panel to render "Last refresh + value" per row.
export async function getLatestWaxstatSnapshots(productId: string): Promise<LatestSnapshot[]> {
  // Distinct-on (format) ordered by fetched_at DESC. PostgREST doesn't
  // expose DISTINCT ON, so do it via a window-function RPC alternative:
  // pull the most recent 30 rows + dedupe client-side. Per product the
  // table grows by ~3 rows/week so 30 covers ~10 weeks of history.
  const { data, error } = await supabaseAdmin
    .from('waxstat_pricing_snapshots')
    .select('format, source_url, avg_price, low_30d, high_30d, trend_7d, error_message, fetched_at')
    .eq('product_id', productId)
    .order('fetched_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  const byFormat = new Map<Format, LatestSnapshot>();
  for (const row of (data ?? []) as LatestSnapshot[]) {
    if (!byFormat.has(row.format)) byFormat.set(row.format, row);
  }
  return Array.from(byFormat.values());
}
