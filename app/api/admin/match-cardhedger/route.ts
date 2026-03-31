import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch } from '@/lib/cardhedger';
import { getManufacturerKnowledge } from '@/lib/card-knowledge';

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
    .select('name, sport:sports(name)')
    .eq('id', productId)
    .single();

  // Extract year and build short set name from product name.
  // "2025 Bowman Chrome Baseball"    → year="2025", shortSetName="Bowman Chrome"
  // "2025-26 Topps Chrome Basketball" → year="2025", shortSetName="Topps Chrome"
  const productName = product?.name ?? '';
  const yearMatch = productName.match(/^(\d{4})(?:-\d{2})?\s+/);
  const productYear = yearMatch?.[1] ?? '';
  const shortSetName = productName
    .replace(/^\d{4}(?:-\d{2})?\s+/, '')
    .replace(/\s+(baseball|basketball|football|soccer)\s*$/i, '')
    .trim();

  // Sport filter for CardHedger search — narrows results and reduces cross-sport false matches
  const sportName = ((product as any)?.sport as { name?: string } | null)?.name?.toLowerCase();

  // Resolve the manufacturer knowledge module for this product.
  // Handles variant cleaning, query reformulation, and Claude context injection.
  const knowledge = getManufacturerKnowledge(productName);

  // Match all variants in this chunk concurrently.
  const results = await runConcurrent(
    variants.map(variant => async () => {
      const playerName = ppPlayerMap.get(variant.player_product_id) ?? '';

      // Clean the variant name and optionally reformulate the full query.
      const { cleanedVariant, isInsertSetName } = knowledge.cleanVariant(variant.variant_name ?? '');
      const reformulation = knowledge.reformulateQuery({
        playerName,
        year: productYear,
        shortSetName,
        cardNumber: variant.card_number,
        cleanedVariant,
        isInsertSetName,
      });

      const query = reformulation.query ??
        [playerName, productYear, shortSetName, variant.card_number, cleanedVariant || undefined]
          .filter(Boolean)
          .join(' ');

      const matchPlayerName = reformulation.effectivePlayerName ?? playerName;
      const matchCardNumber = reformulation.effectiveCardNumber ?? variant.card_number;

      try {
        const match = await cardMatch(query, sportName, matchPlayerName, matchCardNumber, knowledge.claudeContext());
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
          return { variantId: variant.id, playerName, query, status: 'no-match' as const, confidence: 0, topResult: match.topResult, error: updateError.message };
        }

        return { variantId: variant.id, playerName, query, status, confidence: match.confidence, topResult: match.topResult };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[match-cardhedger] match failed for variant', variant.id, 'query:', query, '—', msg);
        return { variantId: variant.id, playerName, query, status: 'no-match' as const, confidence: 0, topResult: null, error: msg };
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
