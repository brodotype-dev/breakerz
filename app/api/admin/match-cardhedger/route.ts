import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONCURRENCY = 8;
const DEFAULT_CHUNK = 40; // variants per request — keeps each call under ~15s

async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
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
  const { productId, offset = 0, limit = DEFAULT_CHUNK } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  // Fetch player name map for this product.
  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('id, player:players(name)')
    .eq('product_id', productId);

  const ppPlayerMap = new Map(
    (playerProducts ?? []).map((pp: any) => [pp.id, (pp.player as any)?.name ?? '']) // eslint-disable-line @typescript-eslint/no-explicit-any
  );
  const ppIds = [...ppPlayerMap.keys()];

  if (!ppIds.length) return NextResponse.json({ results: [], total: 0, hasMore: false });

  // Count total unmatched variants (for progress display).
  const { count: total } = await supabaseAdmin
    .from('player_product_variants')
    .select('id', { count: 'exact', head: true })
    .in('player_product_id', ppIds)
    .is('cardhedger_card_id', null);

  // Fetch this chunk of unmatched variants.
  const { data: variants } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, variant_name, card_number, player_product_id')
    .in('player_product_id', ppIds)
    .is('cardhedger_card_id', null)
    .range(offset, offset + limit - 1);

  if (!variants?.length) {
    return NextResponse.json({ results: [], total: total ?? 0, hasMore: false });
  }

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('id', productId)
    .single();

  // Match all variants in this chunk concurrently.
  const results = await runConcurrent(
    variants.map(variant => async () => {
      const playerName = ppPlayerMap.get(variant.player_product_id) ?? '';
      const query = [playerName, product?.name, variant.card_number].filter(Boolean).join(' ');

      try {
        const match = await cardMatch(query);
        const status: 'auto' | 'review' | 'no-match' =
          match.confidence >= 0.7 && match.card_id ? 'auto'
          : match.confidence >= 0.5 ? 'review'
          : 'no-match';

        const update = status === 'auto'
          ? { cardhedger_card_id: match.card_id, match_confidence: match.confidence }
          : { match_confidence: match.confidence };

        const { error: updateError } = await supabaseAdmin
          .from('player_product_variants')
          .update(update)
          .eq('id', variant.id);

        if (updateError) {
          console.error('[match-cardhedger] DB update failed for variant', variant.id, updateError.message);
          return { variantId: variant.id, playerName, status: 'no-match' as const, confidence: 0, error: updateError.message };
        }

        return { variantId: variant.id, playerName, status, confidence: match.confidence };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[match-cardhedger] match failed for variant', variant.id, 'query:', query, '—', msg);
        return { variantId: variant.id, playerName, status: 'no-match' as const, confidence: 0, error: msg };
      }
    }),
    CONCURRENCY
  );

  const processed = variants.length;
  const hasMore = offset + processed < (total ?? 0);

  return NextResponse.json({
    results,
    total: total ?? 0,
    offset,
    processed,
    hasMore,
    nextOffset: hasMore ? offset + processed : null,
  });
}
