import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { claudeCardMatchFromCandidates } from '@/lib/cardhedger';
import {
  loadCatalogIndex,
  refreshSetCatalog,
  findCanonicalSet,
  type CatalogIndex,
} from '@/lib/cardhedger-catalog';
import {
  getManufacturerDescriptor,
  tryLocalMatch,
  candidatesForClaude,
  type MatchTier,
} from '@/lib/card-knowledge';
import { checkRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONCURRENCY = 8;
const DEFAULT_CHUNK = 40;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Catalog-preload matching pipeline (v2).
 * See docs/catalog-preload-architecture.md for the full architecture.
 *
 * Flow per request:
 *   1. Resolve the product's canonical CH set name (cached on products.ch_set_name, or /set-search)
 *   2. Load the ch_set_cache into an in-memory CatalogIndex (refresh it if empty)
 *   3. For each variant in the chunk:
 *      - Run the local tier ladder (exact-variant → synonym → number-only → card-code)
 *      - On miss, invoke Claude Haiku with IN-SET candidates (no fuzzy fallback contamination)
 *      - Write cardhedger_card_id + match_confidence + match_tier to the variant row
 */
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { productId, offset = 0, limit = DEFAULT_CHUNK } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  // Fetch product early — we need ch_set_name and sport to bootstrap the catalog.
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, ch_set_name, sport:sports(name)')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const productName = product.name ?? '';
  const sportName = ((product as unknown as { sport: { name?: string } | null }).sport)?.name;
  const descriptor = getManufacturerDescriptor(productName);
  console.log(
    `[match-cardhedger] product="${productName}" descriptor="${descriptor.id}" offset=${offset}`,
  );

  // Count total unmatched variants (join-based to avoid URL limits).
  const { count: total } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, player_products!inner(product_id)', { count: 'exact', head: true })
    .eq('player_products.product_id', productId)
    .is('cardhedger_card_id', null);

  // Fetch this chunk.
  const { data: variants } = await supabaseAdmin
    .from('player_product_variants')
    .select(
      'id, variant_name, card_number, player_product_id, player_products!inner(product_id, player:players(name))',
    )
    .eq('player_products.product_id', productId)
    .is('cardhedger_card_id', null)
    .range(offset, offset + limit - 1);

  if (!variants?.length) {
    return NextResponse.json({ results: [], total: total ?? 0, hasMore: false });
  }

  const ppPlayerMap = new Map(
    (variants as unknown as Array<{
      player_product_id: string;
      player_products: { player: { name: string } | null } | null;
    }>).map(v => [v.player_product_id, v.player_products?.player?.name ?? '']),
  );

  // ── Bootstrap the catalog index ──────────────────────────────────────────────
  // Resolve ch_set_name (search if not set), then load cache (refresh if empty).
  let chSetName = product.ch_set_name as string | null;
  if (!chSetName) {
    const yearMatch = productName.match(/^(\d{4})/);
    const year = yearMatch?.[1] ?? '';
    const shortSetName = productName
      .replace(/^\d{4}(?:-\d{2})?\s+/, '')
      .replace(/\s+(baseball|basketball|football|soccer)\s*$/i, '')
      .trim();
    const category = sportName
      ? sportName.charAt(0).toUpperCase() + sportName.slice(1).toLowerCase()
      : undefined;
    try {
      const candidates = await findCanonicalSet(`${year} ${shortSetName}`.trim(), category);
      chSetName = candidates[0]?.set_name ?? null;
      if (chSetName) {
        await supabaseAdmin
          .from('products')
          .update({ ch_set_name: chSetName })
          .eq('id', productId);
        console.log(`[match-cardhedger] auto-resolved ch_set_name="${chSetName}"`);
      }
    } catch (err) {
      console.warn(
        `[match-cardhedger] set-search failed for "${productName}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  let catalog: CatalogIndex | null = null;
  if (chSetName) {
    catalog = await loadCatalogIndex(chSetName);
    if (catalog.cards.length === 0) {
      console.log(`[match-cardhedger] catalog empty for "${chSetName}" — refreshing`);
      try {
        await refreshSetCatalog(chSetName, { productId });
        catalog = await loadCatalogIndex(chSetName);
      } catch (err) {
        console.error(
          `[match-cardhedger] catalog refresh failed for "${chSetName}": ${err instanceof Error ? err.message : err}`,
        );
        catalog = null;
      }
    }
    if (catalog) {
      console.log(
        `[match-cardhedger] loaded catalog "${chSetName}" — ${catalog.cards.length} cards, ${catalog.byNumber.size} unique numbers`,
      );
    }
  } else {
    console.warn(
      `[match-cardhedger] no ch_set_name for product "${productName}" — all matching will use Claude-only fallback (slow)`,
    );
  }

  // ── Per-variant matching (parallel within chunk) ─────────────────────────────
  const results = await runConcurrent(
    variants.map(variant => async () => {
      const playerName = ppPlayerMap.get(variant.player_product_id) ?? '';
      const input = {
        playerName,
        variantName: variant.variant_name ?? '',
        cardNumber: variant.card_number,
      };

      let tier: MatchTier = 'no-match';
      let cardId: string | null = null;
      let confidence = 0;
      let topResult: Record<string, string> | null = null;
      let query = '';

      try {
        // Tier 1–4: local catalog lookup.
        if (catalog) {
          const local = tryLocalMatch(descriptor, catalog, input);
          query = `[local] ${playerName} ${input.cardNumber ?? ''} ${local.cleaned}`.trim();

          if (local.isInsertSetName) {
            // Section-label rows never have a meaningful CH card — skip Claude.
            tier = 'no-match';
          } else if (local.match) {
            tier = local.match.tier;
            cardId = local.match.cardId;
            confidence = local.match.confidence;
            topResult = local.match.topResult;
          } else {
            // Tier 5: Claude fallback with IN-SET candidates — no fuzzy noise.
            const candidates = candidatesForClaude(catalog, input, 10);
            if (candidates.length > 0) {
              const claudeQuery = [
                playerName,
                input.cardNumber ?? '',
                local.cleaned,
              ]
                .filter(Boolean)
                .join(' ');
              query = `[claude] ${claudeQuery}`;
              const match = await claudeCardMatchFromCandidates(
                claudeQuery,
                candidates.map(c => ({
                  card_id: c.card_id,
                  player_name: c.player_name,
                  set_name: catalog!.setName,
                  year: c.year,
                  variant: c.variant,
                  number: c.number,
                  rookie: c.rookie,
                })),
                descriptor.claudeRules,
              );
              if (match && match.card_id) {
                const chosen = candidates.find(c => c.card_id === match.card_id);
                if (chosen) {
                  tier = 'claude';
                  cardId = match.card_id;
                  confidence = match.confidence;
                  topResult = {
                    player_name: chosen.player_name,
                    set_name: catalog!.setName,
                    variant: chosen.variant,
                    year: chosen.year,
                    number: chosen.number,
                  };
                }
              }
            }
          }
        } else {
          // No catalog — no matching possible. Flag and continue.
          tier = 'no-match';
          query = `[no-catalog] ${playerName} ${input.cardNumber ?? ''}`.trim();
        }

        // Persist — write the tier regardless so telemetry captures misses too.
        const status: 'auto' | 'review' | 'no-match' =
          confidence >= 0.7 && cardId ? 'auto' : confidence >= 0.5 ? 'review' : 'no-match';

        const update =
          status === 'auto'
            ? { cardhedger_card_id: cardId, match_confidence: confidence, match_tier: tier }
            : { match_confidence: confidence, match_tier: tier };

        const { error: updateError } = await supabaseAdmin
          .from('player_product_variants')
          .update(update)
          .eq('id', variant.id);

        if (updateError) {
          console.error(
            `[match-cardhedger] DB update failed for variant ${variant.id}: ${updateError.message}`,
          );
        }

        return {
          variantId: variant.id,
          playerName,
          query,
          status,
          confidence,
          tier,
          topResult,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[match-cardhedger] match failed for variant ${variant.id} query="${query}":`,
          msg,
        );
        return {
          variantId: variant.id,
          playerName,
          query,
          status: 'no-match' as const,
          confidence: 0,
          tier: 'no-match' as MatchTier,
          topResult: null,
          error: msg,
        };
      }
    }),
    CONCURRENCY,
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
    catalog: catalog
      ? { setName: catalog.setName, cardCount: catalog.cards.length }
      : null,
  });
}
