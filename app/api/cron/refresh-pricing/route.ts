import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Vercel Cron — runs nightly to refresh pricing cache for active products.
// Vercel automatically sends the CRON_SECRET as a bearer token.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find all active products that have at least one player_product with a card ID
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('id, name')
      .eq('is_active', true);

    if (error) throw error;
    if (!products?.length) return NextResponse.json({ refreshed: 0 });

    let refreshed = 0;
    const errors: string[] = [];

    for (const product of products) {
      try {
        // Check if this product has any player_products with cardhedger_card_ids
        const { count } = await supabaseAdmin
          .from('player_products')
          .select('id', { count: 'exact', head: true })
          .eq('product_id', product.id)
          .not('cardhedger_card_id', 'is', null);

        if (!count || count === 0) continue;

        // Trigger the pricing POST to refresh (reuses the same logic as the break page)
        const url = new URL('/api/pricing', process.env.NEXT_PUBLIC_APP_URL ?? 'https://getbreakiq.com');
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: product.id }),
        });

        if (!res.ok) {
          errors.push(`${product.name}: HTTP ${res.status}`);
        } else {
          refreshed++;
        }
      } catch (err) {
        errors.push(`${product.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      refreshed,
      total: products.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[cron/refresh-pricing]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
