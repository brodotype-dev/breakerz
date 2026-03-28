import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { Package, Plus, ChevronRight, Edit, DollarSign } from 'lucide-react';
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

export default async function AdminProductsPage() {
  const [{ data: products }, { data: playerCountRows }] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, slug, year, manufacturer, is_active, hobby_case_cost, sport:sports(name)')
      .order('name'),
    supabaseAdmin
      .from('player_products')
      .select('product_id')
      .eq('insert_only', false),
  ]);

  // Build player count map
  const playerCountMap = new Map<string, number>();
  for (const row of playerCountRows ?? []) {
    playerCountMap.set(row.product_id, (playerCountMap.get(row.product_id) ?? 0) + 1);
  }

  const totalPlayers = playerCountRows?.length ?? 0;
  const activeCount = (products ?? []).filter((p: any) => p.is_active).length;

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
          <div>
            <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Products
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Click a product to manage players, checklists, and settings
            </p>
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

                      {/* Status Badge */}
                      {product.is_active ? (
                        <div
                          className="flex items-center gap-1.5 px-2 py-1 rounded-full shrink-0 ml-2"
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
                          className="px-2 py-1 rounded-full text-[9px] font-bold uppercase shrink-0 ml-2"
                          style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-disabled)', letterSpacing: '0.06em' }}
                        >
                          DRAFT
                        </div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                        <div className="terminal-label-muted mb-1">HOBBY CASE</div>
                        <div className="font-mono text-lg font-bold" style={{ color: primary }}>
                          {product.hobby_case_cost != null ? `$${Number(product.hobby_case_cost).toLocaleString()}` : '—'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
                        <div className="terminal-label-muted mb-1">PLAYERS</div>
                        <div className="font-mono text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                          {playerCount}
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
