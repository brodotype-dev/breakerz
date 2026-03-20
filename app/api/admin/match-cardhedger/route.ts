import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CONCURRENCY = 8;

export async function POST(req: NextRequest) {
  const { productId } = await req.json();
  if (!productId) {
    return new Response(JSON.stringify({ error: 'productId required' }), { status: 400 });
  }

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, player_products(id, player:players(name), player_product_variants(id, variant_name, card_number, cardhedger_card_id))')
    .eq('id', productId)
    .single();

  if (!product) {
    return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
  }

  // Flatten all unmatched variants.
  type Task = {
    variantId: string;
    playerName: string;
    variantName: string;
    cardNumber: string | null;
    query: string;
  };

  const tasks: Task[] = [];
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

  const enc = new TextEncoder();
  const line = (obj: object) => enc.encode(JSON.stringify(obj) + '\n');

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(line({ type: 'total', count: tasks.length }));

      let completed = 0;

      // Process in batches of CONCURRENCY.
      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);

        const batchResults = await Promise.all(
          batch.map(async task => {
            try {
              const match = await cardMatch(task.query);
              const status: 'auto' | 'review' | 'no-match' =
                match.confidence >= 0.7 ? 'auto'
                : match.confidence >= 0.5 ? 'review'
                : 'no-match';

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
          })
        );

        for (const result of batchResults) {
          completed++;
          controller.enqueue(line({
            type: 'result',
            variantId: result.variantId,
            playerName: result.playerName,
            variantName: result.variantName,
            status: result.status,
            confidence: result.confidence,
            completed,
          }));
        }
      }

      controller.enqueue(line({ type: 'done' }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
