import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import type { Product, Sport } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PencilIcon, UsersIcon, CheckCircle2, Minus, AlertTriangle } from 'lucide-react';

/** Relative label for a UTC timestamp. Server-safe. */
function formatFetchedAt(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diffH = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return 'Today';
  if (diffH < 48) return 'Yesterday';
  return `${Math.floor(diffH / 24)}d ago`;
}

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

async function getLastPricedMap(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from('pricing_cache')
    .select('fetched_at, player_products!inner(product_id)');
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const productId = (row.player_products as any)?.product_id as string | undefined;
    if (!productId) continue;
    const existing = map.get(productId);
    if (!existing || row.fetched_at > existing) map.set(productId, row.fetched_at);
  }
  return map;
}

async function getLastCatalogMap(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from('ch_set_refresh_log')
    .select('product_id, completed_at')
    .eq('success', true)
    .not('product_id', 'is', null)
    .order('completed_at', { ascending: false });
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.product_id || !row.completed_at) continue;
    if (!map.has(row.product_id)) map.set(row.product_id, row.completed_at);
  }
  return map;
}

export default async function AdminPage() {
  const [products, playerCounts, lastPricedMap, lastCatalogMap] = await Promise.all([
    getProducts(),
    getPlayerCounts(),
    getLastPricedMap(),
    getLastCatalogMap(),
  ]);

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
                <TableHead>Players</TableHead>
                <TableHead>Last Priced</TableHead>
                <TableHead>Odds</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const lastPriced = lastPricedMap.get(product.id) ?? null;
                const lastCatalog = lastCatalogMap.get(product.id) ?? null;
                const needsRefresh = lastCatalog != null && (lastPriced == null || lastCatalog > lastPriced);

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {product.name}
                        {needsRefresh && (
                          <span title="CH catalog refreshed after last pricing run — re-hydrate and refresh pricing">
                            <AlertTriangle className="size-3.5 shrink-0" style={{ color: '#f59e0b' }} />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{product.sport?.name}</TableCell>
                    <TableCell className="font-mono text-sm">{product.year}</TableCell>
                    <TableCell>{product.manufacturer}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {playerCounts[product.id] ?? 0}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {formatFetchedAt(lastPriced)}
                    </TableCell>
                    <TableCell>
                      {(product as any).has_odds ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : (
                        <Minus className="size-4 text-muted-foreground" />
                      )}
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
