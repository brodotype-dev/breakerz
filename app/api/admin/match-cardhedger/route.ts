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

  // Verify product exists and has player_products.
  const { count: ppCount } = await supabaseAdmin
    .from('player_products')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);

  if (!ppCount) return NextResponse.json({ results: [], total: 0, hasMore: false });

  // Count total unmatched variants via join (avoids large .in() URL limit).
  const { count: total } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, player_products!inner(product_id)', { count: 'exact', head: true })
    .eq('player_products.product_id', productId)
    .is('cardhedger_card_id', null);

  // Fetch this chunk of unmatched variants with player name joined.
  const { data: variants } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, variant_name, card_number, player_product_id, player_products!inner(product_id, player:players(name))')
    .eq('player_products.product_id', productId)
    .is('cardhedger_card_id', null)
    .range(offset, offset + limit - 1);

  // Build player name map from joined data (no separate query needed).
  const ppPlayerMap = new Map(
    (variants ?? []).map((v: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
      v.player_product_id,
      (v.player_products as any)?.player?.name ?? '', // eslint-disable-line @typescript-eslint/no-explicit-any
    ])
  );

  if (!variants?.length) {
    return NextResponse.json({ results: [], total: total ?? 0, hasMore: false });
  }

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('id', productId)
    .single();

  // Strip year prefix and sport suffix from product name for cleaner CardHedger queries.
  // "2025 Bowman Chrome Baseball" → "Bowman Chrome"
  // "2025-26 Topps Chrome Basketball" → "Topps Chrome"
  const shortSetName = (product?.name ?? '')
    .replace(/^\d{4}(?:-\d{2})?\s+/, '')
    .replace(/\s+(baseball|basketball|football|soccer)\s*$/i, '')
    .trim();

  // Match all variants in this chunk concurrently.
  const results = await runConcurrent(
    variants.map(variant => async () => {
      const playerName = ppPlayerMap.get(variant.player_product_id) ?? '';
      const query = [playerName, shortSetName, variant.card_number, variant.variant_name]
        .filter(Boolean)
        .join(' ');

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
