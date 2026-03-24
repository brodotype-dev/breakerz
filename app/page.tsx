import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import type { Product, Sport } from '@/lib/types';
import ProductCard from '@/components/breakerz/ProductCard';

async function getProducts(): Promise<(Product & { sport: Sport })[]> {
  const { data } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('is_active', true)
    .order('year', { ascending: false });
  return data ?? [];
}

export default async function HomePage() {
  const products = await getProducts();

  const bySport = products.reduce<Record<string, (Product & { sport: Sport })[]>>((acc, p) => {
    const sport = p.sport?.name ?? 'Other';
    if (!acc[sport]) acc[sport] = [];
    acc[sport].push(p);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-[oklch(0.28_0.08_250)] text-white">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 mb-0.5">
              Break Analysis Engine
            </p>
            <h1 className="text-2xl font-black tracking-tight">Card Breakerz</h1>
          </div>
          <div className="flex items-center gap-4 pb-0.5">
            <Link href="/analysis" className="text-xs text-white/70 hover:text-white font-semibold transition-colors">
              Breaker Says →
            </Link>
            <p className="text-xs text-white/40 font-mono">v2.1</p>
          </div>
        </div>
      </header>
      <div className="h-1 bg-[var(--topps-red)]" />

      <main className="max-w-5xl mx-auto px-4 py-10">
        {Object.keys(bySport).length === 0 ? (
          <div className="rounded border border-dashed p-12 text-center text-muted-foreground">
            <p className="font-semibold mb-1">No products yet</p>
            <p className="text-sm">Add sports and products via the Supabase dashboard.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {Object.entries(bySport).map(([sport, sportProducts]) => (
              <div key={sport}>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[11px] font-black uppercase tracking-[0.15em] text-[oklch(0.28_0.08_250)]">
                    {sport}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {sportProducts.map(product => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
