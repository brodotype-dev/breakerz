import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { Plus } from 'lucide-react';
import ProductsTableView, { type ProductRow } from './ProductsTableView';
import CronStatusPanel from '@/components/admin/CronStatusPanel';

export const dynamic = 'force-dynamic';

async function getAllPlayerProducts(): Promise<{ product_id: string }[]> {
  // Paginate past PostgREST's 1000-row default since hydrated products push
  // total player_products well past that.
  const rows: { product_id: string }[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('player_products')
      .select('product_id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

export default async function AdminProductsPage() {
  const [
    { data: rawProducts },
    playerProductRows,
    { data: cacheRows },
    { data: catalogLogRows },
  ] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, slug, year, manufacturer, is_active, has_odds, lifecycle_status, release_date, sport:sports(name)')
      .order('name'),
    getAllPlayerProducts(),
    supabaseAdmin
      .from('pricing_cache')
      .select('fetched_at, player_products!inner(product_id)'),
    supabaseAdmin
      .from('ch_set_refresh_log')
      .select('product_id, completed_at')
      .eq('success', true)
      .not('product_id', 'is', null)
      .order('completed_at', { ascending: false }),
  ]);

  // Player counts (all players, including insert_only)
  const playerCountMap = new Map<string, number>();
  for (const row of playerProductRows) {
    playerCountMap.set(row.product_id, (playerCountMap.get(row.product_id) ?? 0) + 1);
  }

  // Last priced (max fetched_at per product)
  const lastPricedMap = new Map<string, string>();
  for (const row of cacheRows ?? []) {
    const productId = (row.player_products as any)?.product_id as string | undefined;
    if (!productId) continue;
    const existing = lastPricedMap.get(productId);
    if (!existing || row.fetched_at > existing) lastPricedMap.set(productId, row.fetched_at);
  }

  // Last catalog refresh (max completed_at per product)
  const lastCatalogMap = new Map<string, string>();
  for (const row of catalogLogRows ?? []) {
    if (!row.product_id || !row.completed_at) continue;
    if (!lastCatalogMap.has(row.product_id)) lastCatalogMap.set(row.product_id, row.completed_at);
  }

  const products: ProductRow[] = (rawProducts ?? []).map((p: any) => {
    const lastPriced = lastPricedMap.get(p.id) ?? null;
    const lastCatalog = lastCatalogMap.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      year: p.year,
      manufacturer: p.manufacturer,
      sportName: p.sport?.name ?? null,
      isActive: !!p.is_active,
      hasOdds: !!p.has_odds,
      lifecycleStatus: (p.lifecycle_status ?? 'live') as 'pre_release' | 'live' | 'dormant',
      releaseDate: p.release_date ?? null,
      playerCount: playerCountMap.get(p.id) ?? 0,
      lastPriced,
      needsRefresh: lastCatalog != null && (lastPriced == null || lastCatalog > lastPriced),
    };
  });

  const totalPlayers = playerProductRows.length;
  const activeCount = products.filter(p => p.isActive).length;

  // Filter options derived from data
  const sports = Array.from(new Set(products.map(p => p.sportName).filter(Boolean))) as string[];
  const years = Array.from(new Set(products.map(p => p.year).filter(Boolean))) as string[];
  sports.sort();
  years.sort().reverse();

  return (
    <div className="space-y-6">
      {/* Compact header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
            Admin
          </p>
          <h1 className="text-2xl font-black">Products</h1>
        </div>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--gradient-blue)', color: 'white' }}
        >
          <Plus className="w-4 h-4" />
          New Product
        </Link>
      </div>

      {/* Inline stats strip */}
      <div
        className="flex items-center gap-6 px-4 py-3 rounded-lg"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <Stat label="Products" value={products.length} />
        <Divider />
        <Stat label="Active" value={activeCount} accent="var(--signal-buy)" />
        <Divider />
        <Stat label="Draft" value={products.length - activeCount} />
        <Divider />
        <Stat label="Total Players" value={totalPlayers.toLocaleString()} />
      </div>

      <CronStatusPanel />

      <ProductsTableView products={products} sports={sports} years={years} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      <span className="font-mono text-base font-bold" style={{ color: accent ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="w-px h-5" style={{ backgroundColor: 'var(--terminal-border)' }} />;
}
