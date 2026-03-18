import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';

export default async function AdminProductsPage() {
  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, slug, year, manufacturer')
    .order('name');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Home
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold">Admin</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Products</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Actions */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Products</h1>
          <Link
            href="/admin/import-checklist"
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Import Checklist
          </Link>
        </div>

        {/* Product list */}
        {!products?.length ? (
          <div className="rounded border p-12 text-center text-muted-foreground">
            No products found. Add products via Supabase or import a checklist.
          </div>
        ) : (
          <div className="rounded border overflow-hidden divide-y">
            {products.map(product => (
              <div key={product.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                <div>
                  <p className="text-sm font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {product.manufacturer} · {product.year}
                  </p>
                </div>
                <Link
                  href={`/admin/products/${product.id}/players`}
                  className="text-xs text-primary hover:underline font-medium shrink-0"
                >
                  Manage players →
                </Link>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
