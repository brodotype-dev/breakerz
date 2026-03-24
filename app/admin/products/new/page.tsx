import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import ProductForm from '@/components/admin/ProductForm';
import type { Sport } from '@/lib/types';

async function getSports(): Promise<Sport[]> {
  const { data } = await supabaseAdmin.from('sports').select('*').order('name');
  return data ?? [];
}

function RedirectOnSave({ id }: { id: string }) {
  redirect(`/admin/products/${id}/players`);
}

export default async function NewProductPage() {
  const sports = await getSports();

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-0.5">
          Admin / Products
        </p>
        <h1 className="text-2xl font-black">New Product</h1>
      </div>

      <div className="bg-card border rounded overflow-hidden">
        <div className="h-1 bg-[oklch(0.28_0.08_250)]" />
        <div className="p-6">
          <ProductForm sports={sports} />
        </div>
      </div>
    </div>
  );
}
