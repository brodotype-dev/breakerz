import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import ProductForm from '@/components/admin/ProductForm';
import type { Product, Sport } from '@/lib/types';

async function getProduct(id: string): Promise<Product | null> {
  const { data } = await supabaseAdmin.from('products').select('*').eq('id', id).maybeSingle();
  return data;
}

async function getSports(): Promise<Sport[]> {
  const { data } = await supabaseAdmin.from('sports').select('*').order('name');
  return data ?? [];
}

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, sports] = await Promise.all([getProduct(id), getSports()]);

  if (!product) notFound();

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
          Admin / Products
        </p>
        <h1 className="text-2xl font-black">Edit Product</h1>
        <p className="text-sm text-muted-foreground mt-1">{product.name}</p>
      </div>

      <div className="bg-card border rounded overflow-hidden">
        <div className="h-1 bg-[oklch(0.28_0.08_250)]" />
        <div className="p-6">
          <ProductForm sports={sports} product={product} />
        </div>
      </div>
    </div>
  );
}
