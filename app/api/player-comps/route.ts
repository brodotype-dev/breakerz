import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { getAllPrices, getComps } from '@/lib/cardhedger';
import type { VariantWithPrices } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

  // Fetch player info + variants
  const { data: playerProduct } = await supabaseAdmin
    .from('player_products')
    .select('id, player:players(id, name, team, is_rookie, is_icon), player_product_variants(id, variant_name, card_number, cardhedger_card_id, hobby_odds, breaker_odds, match_tier)')
    .eq('id', playerProductId)
    .single();

  if (!playerProduct) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }

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
  )].slice(0, 15); // cap at 15 cards to avoid timeout

  // Fetch all prices for each unique card in parallel
  const priceMap = new Map<string, Array<{ grade: string; price: number }>>();
  await Promise.all(
    uniqueCardIds.map(async cardId => {
      try {
        const result = await getAllPrices(cardId);
        // Filter to Raw, PSA 8/9/10 grades
        const gradeWhitelist = new Set(['8', '9', '10', 'PSA 8', 'PSA 9', 'PSA 10', 'Raw', 'Ungraded']);
        const filtered = (result.prices ?? [])
          .filter(p => gradeWhitelist.has(p.grade))
          .map(p => ({
            grade: p.grade === '8' ? 'PSA 8' : p.grade === '9' ? 'PSA 9' : p.grade === '10' ? 'PSA 10' : p.grade,
            price: parseFloat(p.price) || 0,
          }));
        priceMap.set(cardId, filtered);
      } catch {
        priceMap.set(cardId, []);
      }
    })
  );

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

  return NextResponse.json({
    player_id: player?.id ?? null,
    player_name: player?.name ?? '',
    team: player?.team ?? '',
    is_rookie: player?.is_rookie ?? false,
    is_icon: player?.is_icon ?? false,
    variants: variantRows,
    recentComps,
  });
}
