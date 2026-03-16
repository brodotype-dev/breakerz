import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import type { Product, Sport } from '@/lib/types';

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
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">CB</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Card Breakerz</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Break Analysis Engine</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Select a Product</h2>
          <p className="text-muted-foreground">Choose a break product to analyze slot pricing and market value.</p>
        </div>

        {Object.keys(bySport).length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            <p className="font-medium mb-2">No products yet</p>
            <p className="text-sm">Add sports and products via the Supabase dashboard to get started.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(bySport).map(([sport, sportProducts]) => (
              <div key={sport}>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  {sport}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sportProducts.map(product => (
                    <Link
                      key={product.id}
                      href={`/break/${product.slug}`}
                      className="rounded-lg border bg-card p-5 hover:border-primary transition-colors group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-xs text-muted-foreground font-mono">{product.year}</span>
                        <span className="text-xs text-muted-foreground">{product.manufacturer}</span>
                      </div>
                      <p className="font-semibold group-hover:text-primary transition-colors">{product.name}</p>
                      <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                        {product.hobby_case_cost && (
                          <span>Hobby ${product.hobby_case_cost.toLocaleString()}/case</span>
                        )}
                        {product.bd_case_cost && (
                          <span>BD ${product.bd_case_cost.toLocaleString()}/case</span>
                        )}
                      </div>
                    </Link>
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
