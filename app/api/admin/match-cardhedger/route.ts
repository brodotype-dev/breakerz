import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch } from '@/lib/cardhedger';

export async function POST(req: NextRequest) {
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  // Get product name for search context
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, player_products(id, player:players(name), player_product_variants(id, variant_name, card_number, cardhedger_card_id))')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const results: Array<{
    variantId: string;
    playerName: string;
    variantName: string;
    cardNumber: string | null;
    cardId: string | null;
    confidence: number;
    status: 'auto' | 'review' | 'no-match';
  }> = [];

  for (const pp of (product as any).player_products ?? []) {
    const playerName = pp.player?.name;
    if (!playerName) continue;

    for (const variant of pp.player_product_variants ?? []) {
      if (variant.cardhedger_card_id) continue; // already matched

      const query = [playerName, product.name, variant.card_number].filter(Boolean).join(' ');
      try {
        const match = await cardMatch(query);
        const status = match.confidence >= 0.7 ? 'auto' : match.confidence >= 0.5 ? 'review' : 'no-match';

        if (status === 'auto') {
          await supabaseAdmin
            .from('player_product_variants')
            .update({ cardhedger_card_id: match.card_id })
            .eq('id', variant.id);
        }

        results.push({
          variantId: variant.id,
          playerName,
          variantName: variant.variant_name,
          cardNumber: variant.card_number,
          cardId: match.card_id,
          confidence: match.confidence,
          status,
        });
      } catch {
        results.push({
          variantId: variant.id,
          playerName,
          variantName: variant.variant_name,
          cardNumber: variant.card_number,
          cardId: null,
          confidence: 0,
          status: 'no-match',
        });
      }
    }
  }

  return NextResponse.json({ results });
}
