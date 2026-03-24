import { supabaseAdmin } from '@/lib/supabase';
import NewProductForm from '../NewProductForm';

export default async function NewProductPage() {
  const { data: sports } = await supabaseAdmin.from('sports').select('*').order('name');

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
          <NewProductForm sports={sports ?? []} />
        </div>
      </div>
    </div>
  );
}
