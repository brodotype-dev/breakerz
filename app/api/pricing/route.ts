import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV } from '@/lib/cardhedger';
import type { PlayerWithPricing } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  try {
    // Load all player_products for this product, with player info
    const { data: playerProducts, error } = await supabaseAdmin
      .from('player_products')
      .select(`
        *,
        player:players(*)
      `)
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('id');

    if (error) throw error;
    if (!playerProducts || playerProducts.length === 0) {
      return NextResponse.json({ players: [] });
    }

    // Load all cached pricing in one query
    const playerProductIds = playerProducts.map(pp => pp.id);
    const { data: cachedPricing } = await supabaseAdmin
      .from('pricing_cache')
      .select('*')
      .in('player_product_id', playerProductIds)
      .gt('expires_at', new Date().toISOString());

    const cacheMap = new Map(cachedPricing?.map(c => [c.player_product_id, c]) ?? []);

    // For each player, use cached pricing or fetch live
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    const players: PlayerWithPricing[] = await Promise.all(
      playerProducts.map(async pp => {
        const cached = cacheMap.get(pp.id);

        if (cached) {
          return {
            ...pp,
            evLow: cached.ev_low,
            evMid: cached.ev_mid,
            evHigh: cached.ev_high,
            hobbyWeight: 0,
            bdWeight: 0,
            hobbySlotCost: 0,
            bdSlotCost: 0,
            totalCost: 0,
            hobbyPerCase: 0,
            bdPerCase: 0,
            maxPay: 0,
            pricingSource: 'cached' as const,
          };
        }

        // No cache — try live pricing
        if (pp.cardhedger_card_id) {
          try {
            const ev = await computeLiveEV(pp.cardhedger_card_id);

            // Store in cache
            await supabaseAdmin.from('pricing_cache').upsert({
              player_product_id: pp.id,
              cardhedger_card_id: pp.cardhedger_card_id,
              ev_low: ev.evLow,
              ev_mid: ev.evMid,
              ev_high: ev.evHigh,
              raw_comps: {},
              fetched_at: new Date().toISOString(),
              expires_at: expiresAt.toISOString(),
            }, { onConflict: 'player_product_id' });

            return {
              ...pp,
              evLow: ev.evLow,
              evMid: ev.evMid,
              evHigh: ev.evHigh,
              hobbyWeight: 0,
              bdWeight: 0,
              hobbySlotCost: 0,
              bdSlotCost: 0,
              totalCost: 0,
              hobbyPerCase: 0,
              bdPerCase: 0,
              maxPay: 0,
              pricingSource: 'live' as const,
            };
          } catch {
            // CardHedger failed — return zeroed pricing
          }
        }

        return {
          ...pp,
          evLow: 0,
          evMid: 0,
          evHigh: 0,
          hobbyWeight: 0,
          bdWeight: 0,
          hobbySlotCost: 0,
          bdSlotCost: 0,
          totalCost: 0,
          hobbyPerCase: 0,
          bdPerCase: 0,
          maxPay: 0,
          pricingSource: 'none' as const,
        };
      })
    );

    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
