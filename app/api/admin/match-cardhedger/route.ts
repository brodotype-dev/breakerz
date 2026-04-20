import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cardMatch, searchSets, getCardsBySet } from '@/lib/cardhedger';
import { getManufacturerKnowledge } from '@/lib/card-knowledge';
import { checkRole } from '@/lib/auth';

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
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { productId, offset = 0, limit = DEFAULT_CHUNK, mode } = await req.json();
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
    .select('name, ch_set_name, sport:sports(name)')
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
  console.log(`[match-cardhedger] product="${productName}" module="${knowledge.name}" variants=${variants.length} offset=${offset} mode=${mode ?? 'individual'}`);

  // ── Set-catalog pre-load (mode: 'set-catalog') ──────────────────────────────
  // Fetches the full CH set catalog once, builds a card_number → card_id map,
  // and matches variants locally. ~94 paginated API calls replaces 1000+ individual ones.
  // Falls back to individual Claude matching for any variant not found in the catalog.
  let setCatalogMap: Map<string, string> | null = null;

  if (mode === 'set-catalog') {
    try {
      // Step 1: find canonical CH set name — use stored ch_set_name if available, else search
      const storedSetName = (product as any)?.ch_set_name as string | null;
      const sportCategory = sportName ? sportName.charAt(0).toUpperCase() + sportName.slice(1) : undefined;
      let canonicalSet: string | undefined = storedSetName ?? undefined;
      if (!canonicalSet) {
        const setsResult = await searchSets(shortSetName, sportCategory);
        canonicalSet = setsResult.sets?.[0]?.set_name;
      }

      if (canonicalSet) {
        console.log(`[match-cardhedger] set-catalog mode: canonical set="${canonicalSet}"`);
        // Step 2: paginate through entire set
        const firstPage = await getCardsBySet(canonicalSet, 1, 100);
        const totalPages = firstPage.pages ?? 1;
        const allCards = [...(firstPage.cards ?? [])];

        // Fetch remaining pages concurrently (up to 10 at a time)
        if (totalPages > 1) {
          const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const pageResults = await runConcurrent(
            pageNums.map(p => () => getCardsBySet(canonicalSet, p, 100)),
            10
          );
          for (const r of pageResults) allCards.push(...(r.cards ?? []));
        }

        // Step 3: build number → card_id map (keep first match per number for base variant)
        setCatalogMap = new Map<string, string>();
        for (const card of allCards) {
          if (card.number && !setCatalogMap.has(card.number)) {
            setCatalogMap.set(card.number, card.card_id);
          }
        }
        console.log(`[match-cardhedger] set-catalog loaded ${setCatalogMap.size} unique card numbers from ${allCards.length} cards`);
      } else {
        console.warn(`[match-cardhedger] set-catalog: no canonical set found for "${shortSetName}" — falling back to individual matching`);
      }
    } catch (err) {
      console.error('[match-cardhedger] set-catalog pre-load failed:', err);
      // Fall back to individual matching
    }
  }

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
        // Set-catalog fast path: if we pre-loaded the set, try exact card_number lookup first
        if (setCatalogMap && matchCardNumber && setCatalogMap.has(matchCardNumber)) {
          const cardId = setCatalogMap.get(matchCardNumber)!;
          await supabaseAdmin
            .from('player_product_variants')
            .update({ cardhedger_card_id: cardId, match_confidence: 0.95 })
            .eq('id', variant.id);
          return { variantId: variant.id, playerName, query, status: 'auto' as const, confidence: 0.95, topResult: null, source: 'set-catalog' };
        }

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
