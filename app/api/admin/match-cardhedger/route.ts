import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — needs Vercel Pro; on Hobby it caps at 60s

// Run up to CONCURRENCY cardMatch calls in parallel to stay within function timeout.
const CONCURRENCY = 8;

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export async function POST(req: NextRequest) {
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, player_products(id, player:players(name), player_product_variants(id, variant_name, card_number, cardhedger_card_id))')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  // Flatten all unmatched variants into a task list.
  type VariantTask = {
    variantId: string;
    playerName: string;
    variantName: string;
    cardNumber: string | null;
    query: string;
  };

  const tasks: VariantTask[] = [];
  for (const pp of (product as any).player_products ?? []) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const playerName = pp.player?.name;
    if (!playerName) continue;
    for (const variant of pp.player_product_variants ?? []) {
      if (variant.cardhedger_card_id) continue;
      tasks.push({
        variantId: variant.id,
        playerName,
        variantName: variant.variant_name,
        cardNumber: variant.card_number ?? null,
        query: [playerName, product.name, variant.card_number].filter(Boolean).join(' '),
      });
    }
  }

  // Match all variants in parallel (bounded by CONCURRENCY).
  const matchResults = await runWithConcurrency(
    tasks.map(task => async () => {
      try {
        const match = await cardMatch(task.query);
        const status: 'auto' | 'review' | 'no-match' =
          match.confidence >= 0.7 ? 'auto' : match.confidence >= 0.5 ? 'review' : 'no-match';

        const update = status === 'auto'
          ? { cardhedger_card_id: match.card_id, match_confidence: match.confidence }
          : { match_confidence: match.confidence };

        await supabaseAdmin
          .from('player_product_variants')
          .update(update)
          .eq('id', task.variantId);

        return { ...task, cardId: match.card_id, confidence: match.confidence, status };
      } catch {
        return { ...task, cardId: null, confidence: 0, status: 'no-match' as const };
      }
    }),
    CONCURRENCY
  );

  const results = matchResults.map(r => ({
    variantId: r.variantId,
    playerName: r.playerName,
    variantName: r.variantName,
    cardNumber: r.cardNumber,
    cardId: r.cardId,
    confidence: r.confidence,
    status: r.status,
  }));

  return NextResponse.json({ results });
}
