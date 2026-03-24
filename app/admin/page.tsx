import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import type { Product, Sport } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PencilIcon, UsersIcon } from 'lucide-react';

async function getProducts() {
  const { data } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .order('created_at', { ascending: false });
  return (data ?? []) as (Product & { sport: Sport })[];
}

async function getPlayerCounts() {
  const { data } = await supabaseAdmin
    .from('player_products')
    .select('product_id');
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.product_id] = (counts[row.product_id] ?? 0) + 1;
  }
  return counts;
}

export default async function AdminPage() {
  const [products, playerCounts] = await Promise.all([getProducts(), getPlayerCounts()]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
            Admin
          </p>
          <h1 className="text-2xl font-black">Products</h1>
        </div>
        <Link
          href="/admin/products/new"
          className="inline-flex items-center h-8 px-3 rounded-lg bg-[oklch(0.28_0.08_250)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Product
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="border border-dashed rounded p-12 text-center text-muted-foreground">
          <p className="font-semibold mb-1">No products yet</p>
          <Link href="/admin/products/new" className="text-sm underline">
            Add your first product
          </Link>
        </div>
      ) : (
        <div className="border rounded overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sport</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Manufacturer</TableHead>
                <TableHead>Hobby / Case</TableHead>
                <TableHead>BD / Case</TableHead>
                <TableHead>Players</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">{product.sport?.name}</TableCell>
                  <TableCell className="font-mono text-sm">{product.year}</TableCell>
                  <TableCell>{product.manufacturer}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {product.hobby_case_cost ? `$${product.hobby_case_cost.toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {product.bd_case_cost ? `$${product.bd_case_cost.toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {playerCounts[product.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    <Badge variant={product.is_active ? 'default' : 'outline'}>
                      {product.is_active ? 'Active' : 'Draft'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/products/${product.id}/edit`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit product"
                      >
                        <PencilIcon className="size-4" />
                      </Link>
                      <Link
                        href={`/admin/products/${product.id}/players`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Manage players"
                      >
                        <UsersIcon className="size-4" />
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
