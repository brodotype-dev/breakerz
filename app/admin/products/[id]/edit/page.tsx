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

      {/* Back button */}
      <Link
        href={`/admin/products/${id}`}
        className="inline-flex items-center gap-2 text-sm font-medium transition-colors group hover:text-[var(--accent-blue)]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Back to Dashboard
      </Link>

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
        <div className="relative flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
          >
            <Edit className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Edit Product
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
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
