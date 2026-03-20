import { supabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Product, Sport } from '@/lib/types';
import OddsUpload from './OddsUpload';

type PageProps = { params: Promise<{ id: string }> };

function StatusPill({ value }: { value: 'ok' | 'warn' | 'empty' }) {
  if (value === 'ok') return <span className="inline-block h-2 w-2 rounded-full bg-green-500" />;
  if (value === 'warn') return <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />;
}

export default async function ProductDashboardPage({ params }: PageProps) {
  const { id } = await params;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('id', id)
    .single<Product & { sport: Sport }>();

  if (!product) notFound();

  // Player/variant counts
  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('id, insert_only')
    .eq('product_id', id);

  const ppIds = (playerProducts ?? []).map(pp => pp.id);
  const autoEligibleCount = (playerProducts ?? []).filter(pp => !pp.insert_only).length;

  const { data: variants } = ppIds.length
    ? await supabaseAdmin
        .from('player_product_variants')
        .select('id, cardhedger_card_id, hobby_odds, breaker_odds, variant_name, card_number, player_product_id')
        .in('player_product_id', ppIds)
    : { data: [] };

  // For the unmatched list, join player names via player_products
  const { data: playerProductsWithPlayers } = ppIds.length
    ? await supabaseAdmin
        .from('player_products')
        .select('id, player:players(name)')
        .in('id', ppIds)
    : { data: [] };

  const ppPlayerMap = new Map(
    (playerProductsWithPlayers ?? []).map((pp: any) => [pp.id, pp.player?.name ?? ''])  // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  const unmatchedVariants = (variants ?? [])
    .filter(v => !v.cardhedger_card_id)
    .slice(0, 50) // cap at 50 rows for display
    .map(v => ({
      id: v.id,
      playerName: ppPlayerMap.get(v.player_product_id) ?? '',
      variantName: v.variant_name,
      cardNumber: v.card_number,
    }));

  const variantTotal = variants?.length ?? 0;
  const variantMatched = variants?.filter(v => v.cardhedger_card_id).length ?? 0;
  const variantWithOdds = variants?.filter(v => v.hobby_odds != null || v.breaker_odds != null).length ?? 0;

  // Pricing cache
  const { data: pricingCache } = ppIds.length
    ? await supabaseAdmin
        .from('pricing_cache')
        .select('player_product_id, fetched_at')
        .in('player_product_id', ppIds)
        .gt('expires_at', new Date().toISOString())
    : { data: [] };

  const cachedCount = pricingCache?.length ?? 0;
  const lastFetched = pricingCache?.sort((a, b) =>
    new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime()
  )[0]?.fetched_at;

  const playerStatus = autoEligibleCount > 0 ? 'ok' : 'empty';
  const variantMatchPct = variantTotal > 0 ? variantMatched / variantTotal : 0;
  const variantStatus = variantTotal === 0 ? 'empty' : variantMatchPct >= 0.8 ? 'ok' : 'warn';
  const oddsStatus = product.has_odds ? 'ok' : variantWithOdds > 0 ? 'warn' : 'empty';
  const pricingStatus = cachedCount === 0 ? 'empty' : cachedCount >= autoEligibleCount ? 'ok' : 'warn';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/admin/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Products
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold">{product.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {product.sport?.name} · {product.year} · Admin
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Readiness summary */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-[var(--topps-red)]" />
          <div className="p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Product Readiness
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Players */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusPill value={playerStatus} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Players</span>
                </div>
                <p className="text-2xl font-bold">{autoEligibleCount}</p>
                <p className="text-xs text-muted-foreground">{(playerProducts ?? []).length} total incl. inserts</p>
              </div>

              {/* Variants / CH match */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusPill value={variantStatus} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CH Matched</span>
                </div>
                <p className="text-2xl font-bold">
                  {variantTotal > 0 ? `${Math.round(variantMatchPct * 100)}%` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {variantMatched}/{variantTotal} variants
                </p>
              </div>

              {/* Odds */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusPill value={oddsStatus} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Odds</span>
                </div>
                <p className="text-2xl font-bold">
                  {product.has_odds ? 'Imported' : variantWithOdds > 0 ? 'Partial' : 'Pending'}
                </p>
                <p className="text-xs text-muted-foreground">{variantWithOdds} variants have odds</p>
              </div>

              {/* Pricing */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <StatusPill value={pricingStatus} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pricing</span>
                </div>
                <p className="text-2xl font-bold">{cachedCount}</p>
                <p className="text-xs text-muted-foreground">
                  {lastFetched
                    ? `Last: ${new Date(lastFetched).toLocaleDateString()}`
                    : 'Not yet fetched'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-muted" />
          <div className="p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Quick Actions
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/admin/products/${id}/players`}
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Manage Players →
              </Link>
              <Link
                href={`/admin/import-checklist?productId=${id}`}
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Import Checklist →
              </Link>
              <Link
                href={`/break/${product.slug}`}
                className="rounded border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                View Break Page →
              </Link>
            </div>
          </div>
        </div>

        {/* Odds upload */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-muted" />
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Import Odds
              </h2>
              {product.has_odds && (
                <span className="text-xs text-green-600 font-medium">Odds imported</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Upload the manufacturer odds PDF to apply pull rates to variants. Can be run independently of the checklist import.
            </p>
            <OddsUpload productId={id} />
          </div>
        </div>

        {/* Unmatched variants */}
        {unmatchedVariants.length > 0 && (
          <div className="bg-card border rounded overflow-hidden">
            <div className="h-1 bg-amber-400" />
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Unmatched Variants
                </h2>
                <span className="text-xs text-amber-500 font-medium">
                  {(variants ?? []).filter(v => !v.cardhedger_card_id).length} unmatched
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                These variants have no CardHedger card ID. Re-run matching from the import wizard, or import the checklist again if players are missing.
              </p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Player</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Variant</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">#</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {unmatchedVariants.map(v => (
                      <tr key={v.id} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium">{v.playerName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{v.variantName}</td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono">{v.cardNumber ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Product details */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-muted" />
          <div className="p-6 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Product Details
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Manufacturer</p>
                <p className="font-medium">{product.manufacturer}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Year</p>
                <p className="font-medium">{product.year}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Sport</p>
                <p className="font-medium">{product.sport?.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Hobby / Case</p>
                <p className="font-medium font-mono">${product.hobby_case_cost?.toLocaleString()}</p>
              </div>
              {product.bd_case_cost && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">BD / Case</p>
                  <p className="font-medium font-mono">${product.bd_case_cost.toLocaleString()}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                <p className={`font-medium ${product.is_active ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {product.is_active ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
