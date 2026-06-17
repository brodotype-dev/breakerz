import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { getCardFmvBatch, getComps } from '@/lib/cardhedger';
import type { VariantWithPrices } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 10-minute cache for the heavy CH work (FMV batch + 3 parallel getComps).
// CardHedger price data updates a few times per day; 10 min is conservative
// for drawer re-opens within a single session while still surfacing fresh
// data on natural expiry. Same pattern as /api/pricing (#152). The
// dominant savings come from the "compare players side by side" flow:
// open A → close → open B → close → re-open A. The first opens pay
// ~1-3s of CH latency; re-opens within the window are ~50ms.
//
// Auth check stays per-request (outside the cache) — we don't want to
// cache 401 responses for unauthed users.
const COMPS_CACHE_TTL_S = 600;

interface PlayerCompsPayload {
  player_id: string | null;
  player_name: string;
  team: string;
  is_rookie: boolean;
  is_icon: boolean;
  prospect_rank: number | null;
  prospect_rank_source: string | null;
  prospect_rank_updated_at: string | null;
  variants: VariantWithPrices[];
  recentComps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }>;
}

// All the expensive work — DB lookup + FMV batch + comps — gated by
// playerProductId. Returns null if the player isn't found so the caller
// can render a 404 without polluting the cache with an error.
async function loadPlayerCompsRaw(playerProductId: string): Promise<PlayerCompsPayload | null> {
  const { data: playerProduct } = await supabaseAdmin
    .from('player_products')
    .select('id, player:players(id, name, team, is_rookie, is_icon, prospect_rank, prospect_rank_source, prospect_rank_updated_at), player_product_variants(id, variant_name, card_number, cardhedger_card_id, hobby_odds, breaker_odds, match_tier)')
    .eq('id', playerProductId)
    .single();

  if (!playerProduct) return null;

  const variants = (playerProduct.player_product_variants ?? []) as Array<{
    id: string;
    variant_name: string;
    card_number: string | null;
    cardhedger_card_id: string | null;
    hobby_odds: number | null;
    breaker_odds: number | null;
    match_tier: string | null;
  }>;

  // Deduplicate card IDs to avoid redundant CH calls
  const uniqueCardIds = [...new Set(
    variants.map(v => v.cardhedger_card_id).filter(Boolean) as string[]
  )].slice(0, 15); // cap at 15 cards: 15 × 4 grades = 60 items, under the 100/req FMV cap

  // Single batched FMV call covering every (card_id × grade) the drawer renders.
  // Replaces N parallel `getAllPrices` calls (one per unique card) that the
  // 2026-05-15 audit flagged as Use Case 9: CH's all-prices-by-card panel
  // often omits PSA 9 / PSA 10 entries for cards with thin graded sales, so
  // the drawer rendered '—' even when a defensible model estimate was
  // available. The 2026-05-20 at-scale experiment confirmed FMV returns a
  // value (with explicit `method` + `confidence`) for 100% of PSA 9 / PSA 10
  // requests; `method !== 'direct'` cells get dimmed in the UI to mark
  // them as model estimates rather than recent-sale aggregates.
  const FMV_GRADES = ['Raw', 'PSA 8', 'PSA 9', 'PSA 10'] as const;
  const fmvItems = uniqueCardIds.flatMap(cardId =>
    FMV_GRADES.map(grade => ({ card_id: cardId, grade })),
  );
  const priceMap = new Map<
    string,
    Array<{
      grade: string;
      price: number;
      method?: string;
      confidence?: number | null;
      // Human-readable narrative from FMV — passed through to the drawer
      // tooltip so admin can see how the model arrived at the price.
      // Added 2026-05-26 alongside River's FMV revamp.
      price_explanation?: string | null;
    }>
  >();
  if (fmvItems.length > 0) {
    try {
      const fmvResults = await getCardFmvBatch(fmvItems);
      for (const row of fmvResults) {
        // Drop no_data / null-price rows: render them as '—' just like the old
        // missing-entry path. Keeps the "we genuinely don't know" honesty when
        // even FMV's correlated fallback ran out of signal.
        if (row.price === null || row.price <= 0) continue;
        const existing = priceMap.get(row.card_id) ?? [];
        existing.push({
          grade: row.grade,
          price: row.price,
          method: row.method,
          confidence: row.confidence,
          price_explanation: row.price_explanation,
        });
        priceMap.set(row.card_id, existing);
      }
    } catch {
      // Leave priceMap empty on full failure; the drawer renders '—' everywhere
      // and the "no match" / no-cardhedger-card-id branches still work.
    }
  }

  // Build variant rows
  const variantRows: VariantWithPrices[] = variants.map(v => ({
    id: v.id,
    variant_name: v.variant_name,
    cardhedger_card_id: v.cardhedger_card_id,
    hobby_odds: v.hobby_odds,
    breaker_odds: v.breaker_odds,
    match_tier: v.match_tier,
    prices: v.cardhedger_card_id ? (priceMap.get(v.cardhedger_card_id) ?? []) : [],
  }));

  // Recent comps: get PSA 8/9/10 comps for the most likely real base card.
  // Same picker as /api/player-profile — score by numeric card_number first
  // (real bases: 1, 143, 221) over alphanumeric (insert subsets: IP-6, GT-11),
  // then shortest variant_name as the tiebreaker. Without the numeric bonus,
  // multiple inserts whose variant_name is also "Base" tied at length 4 and
  // PostgREST returned them in arbitrary order, so the drawer was showing
  // comps for an insert subset instead of the real base.
  const numericNumber = /^\d+$/;
  const baseVariant = variants
    .filter(v => v.cardhedger_card_id)
    .sort((a, b) => {
      const aBonus = a.card_number && numericNumber.test(a.card_number) ? 0 : 1000;
      const bBonus = b.card_number && numericNumber.test(b.card_number) ? 0 : 1000;
      const aLen = a.variant_name?.length ?? 999;
      const bLen = b.variant_name?.length ?? 999;
      return (aBonus + aLen) - (bBonus + bLen);
    })[0];

  let recentComps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> = [];
  if (baseVariant?.cardhedger_card_id) {
    const grades = ['PSA 10', 'PSA 9', 'PSA 8'];
    const compsResults = await Promise.allSettled(
      grades.map(g => getComps(baseVariant.cardhedger_card_id!, 180, g, 5))
    );
    for (const result of compsResults) {
      if (result.status === 'fulfilled') {
        recentComps.push(...(result.value.comps ?? []));
      }
    }
    // Sort by most recent first
    recentComps.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());
    recentComps = recentComps.slice(0, 15);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const player = playerProduct.player as any;

  return {
    player_id: player?.id ?? null,
    player_name: player?.name ?? '',
    team: player?.team ?? '',
    is_rookie: player?.is_rookie ?? false,
    is_icon: player?.is_icon ?? false,
    prospect_rank: player?.prospect_rank ?? null,
    prospect_rank_source: player?.prospect_rank_source ?? null,
    prospect_rank_updated_at: player?.prospect_rank_updated_at ?? null,
    variants: variantRows,
    recentComps,
  };
}

// Cache the whole payload by playerProductId, 10-min TTL. Tag is per-player
// so a future invalidation hook (admin "Refresh CH Catalog" / "Refresh
// Pricing" actions) can bust the cache via `revalidateTag` if we ever wire
// that up. Same shape as the /api/pricing cache wrapper (#152).
async function loadPlayerComps(playerProductId: string) {
  return unstable_cache(
    () => loadPlayerCompsRaw(playerProductId),
    ['player-comps', playerProductId],
    { revalidate: COMPS_CACHE_TTL_S, tags: [`player-comps-${playerProductId}`] },
  )();
}

// GET /api/player-comps?playerProductId=xxx
// Returns all variants for a player+product with CH prices (grades 8/9/10) + recent PSA 10 comps
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const playerProductId = req.nextUrl.searchParams.get('playerProductId');
  if (!playerProductId) {
    return NextResponse.json({ error: 'playerProductId required' }, { status: 400 });
  }

  const result = await loadPlayerComps(playerProductId);
  if (!result) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  return NextResponse.json(result);
}
