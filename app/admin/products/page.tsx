import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { Package, Plus, ChevronRight, Edit, DollarSign, CheckCircle2, Minus, AlertTriangle } from 'lucide-react';
import DeleteProductButton from './DeleteProductButton';

function getSportKey(sportName: string): 'baseball' | 'basketball' | 'football' {
  const s = sportName?.toLowerCase() ?? '';
  if (s === 'basketball') return 'basketball';
  if (s === 'football') return 'football';
  return 'baseball';
}

const sportGradients = {
  baseball: 'var(--gradient-blue)',
  basketball: 'var(--gradient-orange)',
  football: 'var(--gradient-green)',
};

const sportColors = {
  baseball: 'var(--sport-baseball-primary)',
  basketball: 'var(--sport-basketball-primary)',
  football: 'var(--sport-football-primary)',
};

/** Relative label for a UTC timestamp. Server-safe (no browser Date quirks). */
function formatFetchedAt(ts: string | null | undefined): string {
  if (!ts) return 'Never';
  const diffH = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return 'Today';
  if (diffH < 48) return 'Yesterday';
  return `${Math.floor(diffH / 24)}d ago`;
}

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;

  const [{ data: allProducts }, playerCountRows, { data: cacheRows }, { data: catalogLogRows }] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, slug, year, manufacturer, is_active, has_odds, sport:sports(name)')
      .order('name'),
    // Counts ALL players in each product (insert_only included) — matches /admin.
    // Paginate past PostgREST's 1000-row default since hydrated products push
    // total player_products well past that.
    (async () => {
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
    })(),
    // One row per player_product in the cache; join gives us the parent product_id.
    // ~750–3k rows max across all products — acceptable as a full scan.
    supabaseAdmin
      .from('pricing_cache')
      .select('fetched_at, player_products!inner(product_id)'),
    // ch_set_refresh_log is tiny (one row per cron/admin run per product).
    // Max completed_at per product = when the CH catalog was last pulled.
    supabaseAdmin
      .from('ch_set_refresh_log')
      .select('product_id, completed_at')
      .eq('success', true)
      .not('product_id', 'is', null)
      .order('completed_at', { ascending: false }),
  ]);

  // Build player count map
  const playerCountMap = new Map<string, number>();
  for (const row of playerCountRows) {
    playerCountMap.set(row.product_id, (playerCountMap.get(row.product_id) ?? 0) + 1);
  }

  // Build last-priced map (max fetched_at per product)
  const lastPricedMap = new Map<string, string>();
  for (const row of cacheRows ?? []) {
    const productId = (row.player_products as any)?.product_id as string | undefined;
    if (!productId) continue;
    const existing = lastPricedMap.get(productId);
    if (!existing || row.fetched_at > existing) {
      lastPricedMap.set(productId, row.fetched_at);
    }
  }

  // Build last-catalog-refresh map (max completed_at per product from ch_set_refresh_log).
  // needsRefresh = catalog was pulled more recently than pricing last ran, meaning
  // new CH cards may exist that haven't been hydrated + priced yet.
  const lastCatalogMap = new Map<string, string>();
  for (const row of catalogLogRows ?? []) {
    if (!row.product_id || !row.completed_at) continue;
    if (!lastCatalogMap.has(row.product_id)) {
      lastCatalogMap.set(row.product_id, row.completed_at); // already ordered desc
    }
  }

  const totalPlayers = playerCountRows.length;
  const activeCount = (allProducts ?? []).filter((p: any) => p.is_active).length;
  const draftCount = (allProducts?.length ?? 0) - activeCount;

  const products = filter === 'active'
    ? (allProducts ?? []).filter((p: any) => p.is_active)
    : filter === 'draft'
      ? (allProducts ?? []).filter((p: any) => !p.is_active)
      : (allProducts ?? []);

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* Hero Header */}
      <div
        className="relative overflow-hidden rounded-2xl p-8"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />

        <div className="relative">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
              >
                <Package className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  Product Dashboard
                </h1>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Manage your sports card products and checklists
                </p>
              </div>
            </div>

            <Link href="/admin/products/new">
              <button
                className="flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-base transition-all group hover:scale-105"
                style={{ background: 'var(--gradient-blue)', color: 'white', boxShadow: 'var(--glow-blue)' }}
              >
                <Plus className="w-5 h-5" />
                New Product
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Products" value={String(products?.length ?? 0)} gradient="var(--gradient-blue)" />
            <StatCard label="Active Products" value={String(activeCount)} gradient="var(--gradient-green)" />
            <StatCard label="Total Players" value={totalPlayers.toLocaleString()} gradient="var(--gradient-orange)" />
          </div>
        </div>
      </div>

      {/* Products Grid */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface)' }}>
            {([
              { label: 'All', value: undefined, count: allProducts?.length ?? 0 },
              { label: 'Active', value: 'active', count: activeCount },
              { label: 'Draft', value: 'draft', count: draftCount },
            ] as const).map(tab => {
              const active = (filter ?? undefined) === tab.value;
              return (
                <Link
                  key={tab.label}
                  href={tab.value ? `/admin/products?filter=${tab.value}` : '/admin/products'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all"
                  style={{
                    backgroundColor: active ? 'var(--terminal-surface-hover)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  }}
                >
                  {tab.label}
                  <span
                    className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}
                  >
                    {tab.count}
                  </span>
                </Link>
              );
            })}
          </div>
          <Link
            href="/admin/import-checklist"
            className="text-xs font-medium transition-colors"
            style={{ color: 'var(--accent-blue)' }}
          >
            Import Checklist →
          </Link>
        </div>

        {!products?.length ? (
          <div
            className="rounded-xl border p-12 text-center"
            style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)' }}
          >
            No products yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product: any) => {
              const sportKey = getSportKey((product.sport as any)?.name ?? '');
              const gradient = sportGradients[sportKey];
              const primary = sportColors[sportKey];
              const playerCount = playerCountMap.get(product.id) ?? 0;
              const lastPriced = lastPricedMap.get(product.id) ?? null;
              const lastCatalog = lastCatalogMap.get(product.id) ?? null;
              // Catalog refreshed more recently than pricing ran → variants likely stale
              const needsRefresh = lastCatalog != null && (lastPriced == null || lastCatalog > lastPriced);

              return (
                <div
                  key={product.id}
                  className="relative overflow-hidden rounded-xl border transition-all group hover:scale-[1.02] hover:border-[var(--terminal-border-hover)]"
                  style={{
                    borderColor: 'var(--terminal-border)',
                    backgroundColor: 'var(--terminal-surface)',
                    boxShadow: 'var(--shadow-md)',
                  }}
                >
                  {/* Sport gradient top bar */}
                  <div className="absolute top-0 left-0 right-0 h-1.5" style={{ background: gradient }} />

                  {/* Hover glow */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ background: `radial-gradient(circle at center, ${primary}12 0%, transparent 70%)` }}
                  />

                  <div className="relative p-6 pt-7">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-xs font-bold uppercase px-2 py-1 rounded"
                            style={{ backgroundColor: `${primary}20`, color: primary }}
                          >
                            {(product.sport as any)?.name ?? 'Sport'}
                          </span>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                            {product.year}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold leading-tight mb-1" style={{ color: 'var(--text-primary)' }}>
                          {product.name}
                        </h3>
                        <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {product.manufacturer}
                        </div>
                      </div>

                      {/* Status + Odds badges (stacked) */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0 ml-2">
                        {product.is_active ? (
                          <div
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'var(--signal-buy-bg)' }}
                          >
                            <div
                              className="w-2 h-2 rounded-full animate-pulse"
                              style={{ backgroundColor: 'var(--signal-buy)', boxShadow: 'var(--glow-green)' }}
                            />
                            <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--signal-buy)', letterSpacing: '0.06em' }}>
                              LIVE
                            </span>
                          </div>
                        ) : (
                          <div
                            className="px-2 py-1 rounded-full text-[9px] font-bold uppercase"
                            style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-disabled)', letterSpacing: '0.06em' }}
                          >
                            DRAFT
                          </div>
                        )}

                        {/* Needs-refresh badge */}
                        {needsRefresh && (
                          <div
                            className="flex items-center gap-1 px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
                            title="CH catalog refreshed after last pricing run — re-hydrate and refresh pricing"
                          >
                            <AlertTriangle className="w-3 h-3" style={{ color: '#f59e0b' }} />
                            <span className="text-[9px] font-bold uppercase" style={{ color: '#f59e0b', letterSpacing: '0.06em' }}>
                              STALE
                            </span>
                          </div>
                        )}

                        {/* Odds badge */}
                        {product.has_odds ? (
                          <div
                            className="flex items-center gap-1 px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)' }}
                          >
                            <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--signal-buy)' }} />
                            <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--signal-buy)', letterSpacing: '0.06em' }}>
                              ODDS
                            </span>
                          </div>
                        ) : (
                          <div
                            className="flex items-center gap-1 px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'var(--terminal-surface-hover)' }}
                          >
                            <Minus className="w-3 h-3" style={{ color: 'var(--text-disabled)' }} />
                            <span className="text-[9px] font-bold uppercase" style={{ color: 'var(--text-disabled)', letterSpacing: '0.06em' }}>
                              ODDS
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                        <div className="terminal-label-muted mb-1">PLAYERS</div>
                        <div className="font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                          {playerCount}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                        <div className="terminal-label-muted mb-1">LAST PRICED</div>
                        <div
                          className="font-mono text-lg font-bold"
                          style={{ color: lastPriced ? 'var(--text-primary)' : 'var(--text-disabled)' }}
                        >
                          {formatFetchedAt(lastPriced)}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all"
                        style={{ backgroundColor: `${primary}15`, borderLeft: `3px solid ${primary}`, color: primary }}
                      >
                        <Edit className="w-4 h-4" />
                        Manage
                      </Link>
                      {product.slug && (
                        <Link
                          href={`/break/${product.slug}`}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all"
                          style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-secondary)' }}
                        >
                          <DollarSign className="w-4 h-4" />
                          View
                        </Link>
                      )}
                      <DeleteProductButton productId={product.id} productName={product.name} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, gradient }: { label: string; value: string; gradient: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(19, 24, 32, 0.6)', border: '1px solid var(--terminal-border-hover)' }}
    >
      <div className="terminal-label-muted mb-2">{label}</div>
      <div
        className="text-4xl font-bold font-mono"
        style={{ background: gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
      >
        {value}
      </div>
    </div>
  );
}
