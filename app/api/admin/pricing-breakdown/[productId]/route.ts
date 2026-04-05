import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export interface PricingBreakdownRow {
  playerProductId: string;
  playerId: string;
  playerName: string;
  playerTeam: string;
  isIcon: boolean;
  isRookie: boolean;
  insertOnly: boolean;
  hobbySets: number;
  bdOnlySets: number;
  buzzScore: number | null;
  breakerzScore: number | null;
  // Variant aggregates (used to approximate hobbyEVPerBox client-side)
  variantCount: number;
  variantOddsCount: number;   // variants with hobby_odds set
  sumInverseOdds: number;     // Σ(1/hobby_odds) across odds-bearing variants
  // Cached EV — null if no valid cache entry exists
  evLow: number | null;
  evMid: number | null;
  evHigh: number | null;
}

type PageProps = { params: Promise<{ productId: string }> };

export async function GET(_req: NextRequest, { params }: PageProps) {
  const { productId } = await params;

  try {
    // 1. Player products with player join
    const { data: playerProducts, error: ppError } = await supabaseAdmin
      .from('player_products')
      .select('id, player_id, hobby_sets, bd_only_sets, insert_only, buzz_score, breakerz_score, player:players(*)')
      .eq('product_id', productId)
      .order('id');

    if (ppError) throw ppError;
    if (!playerProducts?.length) return NextResponse.json({ rows: [] });

    const ppIds = playerProducts.map(pp => pp.id);

    // 2. Pricing cache (non-expired) — join via player_products to avoid .in() URL length limit
    const { data: cache, error: cacheError } = await supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, ev_low, ev_mid, ev_high, player_products!inner(product_id)')
      .eq('player_products.product_id', productId)
      .gt('expires_at', new Date().toISOString());

    if (cacheError) throw cacheError;

    const cacheMap = new Map(
      (cache ?? []).map(c => [c.player_product_id, c])
    );

    // 3. Variants — join via player_products, paginated
    const PAGE = 1000;
    let allVariants: Array<{ player_product_id: string; hobby_odds: number | null }> = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from('player_product_variants')
        .select('player_product_id, hobby_odds, player_products!inner(product_id)')
        .eq('player_products.product_id', productId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data?.length) break;
      allVariants = allVariants.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Aggregate variants per player_product
    const variantAggMap = new Map<string, { count: number; oddsCount: number; sumInverseOdds: number }>();
    for (const v of allVariants) {
      const agg = variantAggMap.get(v.player_product_id) ?? { count: 0, oddsCount: 0, sumInverseOdds: 0 };
      agg.count++;
      if (v.hobby_odds != null && v.hobby_odds > 0) {
        agg.oddsCount++;
        agg.sumInverseOdds += 1 / v.hobby_odds;
      }
      variantAggMap.set(v.player_product_id, agg);
    }

    // 4. Assemble rows
    const rows: PricingBreakdownRow[] = playerProducts.map(pp => {
      const player = pp.player as { id: string; name: string; team: string; is_icon: boolean; is_rookie: boolean } | null;
      const cached = cacheMap.get(pp.id);
      const agg = variantAggMap.get(pp.id) ?? { count: 0, oddsCount: 0, sumInverseOdds: 0 };

      return {
        playerProductId: pp.id,
        playerId: player?.id ?? '',
        playerName: player?.name ?? '',
        playerTeam: player?.team ?? '',
        isIcon: player?.is_icon ?? false,
        isRookie: player?.is_rookie ?? false,
        insertOnly: pp.insert_only,
        hobbySets: pp.hobby_sets,
        bdOnlySets: pp.bd_only_sets,
        buzzScore: pp.buzz_score,
        breakerzScore: pp.breakerz_score,
        variantCount: agg.count,
        variantOddsCount: agg.oddsCount,
        sumInverseOdds: agg.sumInverseOdds,
        evLow: cached?.ev_low ?? null,
        evMid: cached?.ev_mid ?? null,
        evHigh: cached?.ev_high ?? null,
      };
    });

    return NextResponse.json({ rows });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err);
    console.error('[pricing-breakdown] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
