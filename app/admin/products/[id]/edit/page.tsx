import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { Edit, ArrowLeft } from 'lucide-react';
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
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header with back link */}
      <div className="flex items-center gap-4">
        <Link
          href={`/admin/products/${id}`}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--terminal-surface-hover)]"
          style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--gradient-blue)' }}
          >
            <Edit className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
              Edit Product
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {product.name}
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
      >
        <div className="h-1" style={{ background: 'var(--gradient-blue)' }} />
        <div className="p-6">
          <ProductForm sports={sports} product={product} />
        </div>
      </div>
    </div>
  );
}
