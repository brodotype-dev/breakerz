import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import NewProductForm from './NewProductForm';
import type { Sport } from '@/lib/types';

export default async function AdminProductsPage() {
  const [{ data: products }, { data: sports }] = await Promise.all([
    supabaseAdmin.from('products').select('id, name, slug, year, manufacturer, sport:sports(name)').order('name'),
    supabaseAdmin.from('sports').select('id, name, slug').order('name'),
  ]);

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

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Add new product */}
        <div className="bg-card border rounded overflow-hidden">
          <div className="h-1 bg-[oklch(0.28_0.08_250)]" />
          <div className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-5">
              Add Product
            </h2>
            <NewProductForm sports={(sports ?? []) as Sport[]} />
          </div>
        </div>

        {/* Existing products */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Products ({products?.length ?? 0})
            </h2>
            <Link
              href="/admin/import-checklist"
              className="text-xs text-primary hover:underline font-medium"
            >
              Import Checklist →
            </Link>
          </div>

          {!products?.length ? (
            <div className="rounded border p-12 text-center text-muted-foreground text-sm">
              No products yet.
            </div>
          ) : (
            <div className="rounded border overflow-hidden divide-y">
              {products.map((product: any) => (
                <div key={product.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(product.sport as any)?.name} · {product.manufacturer} · {product.year}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Link
                      href={`/admin/products/${product.id}/players`}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      Players
                    </Link>
                    <Link
                      href={`/admin/products/${product.id}`}
                      className="text-xs text-primary hover:underline font-medium shrink-0"
                    >
                      Dashboard →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
