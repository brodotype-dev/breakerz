import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV, searchAndComputeEV, get90DayPrices } from '@/lib/cardhedger';
import type { PlayerWithPricing } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

// GET — load roster with cached pricing only (fast, no CardHedger calls)
export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  try {
    const { data: playerProducts, error } = await supabaseAdmin
      .from('player_products')
      .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('id');

    if (error) throw error;
    if (!playerProducts?.length) return NextResponse.json({ players: [] });

    const ids = playerProducts.map(pp => pp.id);
    const { data: cachedPricing } = await supabaseAdmin
      .from('pricing_cache')
      .select('*')
      .in('player_product_id', ids)
      .gt('expires_at', new Date().toISOString());

    const cacheMap = new Map(cachedPricing?.map(c => [c.player_product_id, c]) ?? []);

    const players: PlayerWithPricing[] = playerProducts.map(pp => {
      const cached = cacheMap.get(pp.id);
      const evMid = cached?.ev_mid ?? 0;
      return {
        ...pp,
        evLow: cached?.ev_low ?? 0,
        evMid,
        evHigh: cached?.ev_high ?? 0,
        // GET path has no per-variant EV — fall back to evMid until a POST refresh runs
        hobbyEVPerBox: evMid,
        hobbyWeight: 0,
        bdWeight: 0,
        hobbySlotCost: 0,
        bdSlotCost: 0,
        totalCost: 0,
        hobbyPerCase: 0,
        bdPerCase: 0,
        maxPay: 0,
        pricingSource: cached ? 'cached' as const : 'none' as const,
      };
    });

    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — fetch live pricing from CardHedger for all unpriced players
export async function POST(req: NextRequest) {
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  try {
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('name, year')
      .eq('id', productId)
      .single();

    const { data: playerProducts, error } = await supabaseAdmin
      .from('player_products')
      .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('id');

    if (error) throw error;
    if (!playerProducts?.length) return NextResponse.json({ players: [] });

    const ids = playerProducts.map(pp => pp.id);

    // Load variants for all player_products (used for weighted EV)
    const { data: allVariants } = await supabaseAdmin
      .from('player_product_variants')
      .select('id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, hobby_odds')
      .in('player_product_id', ids)
      .not('cardhedger_card_id', 'is', null);

    // Group variants by player_product_id
    const variantMap = new Map<string, typeof allVariants>();
    for (const v of allVariants ?? []) {
      const list = variantMap.get(v.player_product_id) ?? [];
      list.push(v);
      variantMap.set(v.player_product_id, list);
    }

    const { data: existingCache } = await supabaseAdmin
      .from('pricing_cache')
      .select('*')
      .in('player_product_id', ids)
      .gt('expires_at', new Date().toISOString());

    const cacheMap = new Map(existingCache?.map(c => [c.player_product_id, c]) ?? []);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    const players: PlayerWithPricing[] = await Promise.all(
      playerProducts.map(async pp => {
        // Already cached — return immediately
        const cached = cacheMap.get(pp.id);
        if (cached) {
          return {
            ...pp,
            evLow: cached.ev_low,
            evMid: cached.ev_mid,
            evHigh: cached.ev_high,
            hobbyEVPerBox: cached.ev_mid, // no per-variant EV available; falls back to evMid
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'cached' as const,
          };
        }

        try {
          let ev: { evLow: number; evMid: number; evHigh: number };
          const variants = variantMap.get(pp.id) ?? [];

          let hobbyEVPerBox: number;
          if (variants.length > 0) {
            // Weighted EV across variants: Σ(variantEV × sets) / Σ(sets)
            const variantEVs = await Promise.all(
              variants.map(async v => {
                const variantEV = await computeLiveEV(v.cardhedger_card_id!);
                const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0);
                return { ...variantEV, sets: Math.max(sets, 1), hobby_odds: v.hobby_odds };
              })
            );
            const totalSets = variantEVs.reduce((sum, v) => sum + v.sets, 0);
            ev = {
              evLow: variantEVs.reduce((sum, v) => sum + v.evLow * v.sets, 0) / totalSets,
              evMid: variantEVs.reduce((sum, v) => sum + v.evMid * v.sets, 0) / totalSets,
              evHigh: variantEVs.reduce((sum, v) => sum + v.evHigh * v.sets, 0) / totalSets,
            };
            // Odds-weighted EV: Σ(variantEV × 1/hobby_odds) — expected dollars per box
            // Falls back to evMid if no variant has odds data
            const oddsVariants = variantEVs.filter(v => v.hobby_odds != null && v.hobby_odds > 0);
            hobbyEVPerBox = oddsVariants.length > 0
              ? oddsVariants.reduce((sum, v) => sum + v.evMid * (1 / v.hobby_odds!), 0)
              : ev.evMid;
          } else {
            const cardId = pp.cardhedger_card_id;
            if (!cardId) {
              // Search + compute EV in one call
              const query = `${pp.player.name} ${product?.year ?? ''} ${product?.name ?? ''}`.trim();
              const result = await searchAndComputeEV(query);
              if (!result) throw new Error('No card found');
              ev = { evLow: result.evLow, evMid: result.evMid, evHigh: result.evHigh };
              // Persist card ID so future refreshes skip the search step
              await supabaseAdmin
                .from('player_products')
                .update({ cardhedger_card_id: result.cardId })
                .eq('id', pp.id);
            } else {
              ev = await computeLiveEV(cardId);
            }
            // No variant data — no odds available, fall back to evMid
            hobbyEVPerBox = ev.evMid;
          }

          // If live pricing returned no data, fall through to fallback chain
          if (ev.evMid === 0) throw new Error('No pricing data returned');

          await supabaseAdmin.from('pricing_cache').upsert({
            player_product_id: pp.id,
            cardhedger_card_id: pp.cardhedger_card_id ?? null,
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
            hobbyEVPerBox,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'live' as const,
          };
        } catch {
          // --- Fallback chain for no/zero pricing ---
          const player = pp.player;

          // Level 2: 90-day search pricing via CardHedger generic search
          try {
            const cardType = player.is_rookie ? 'Auto RC' : 'Base';
            const result = await get90DayPrices(`${player.name} ${cardType}`, 'Raw');
            const raw = result.prices.find(p => p.grade.toLowerCase().includes('raw'));
            if (raw && raw.avg_price > 0) {
              const evMid = Math.round(raw.avg_price);
              const ev = {
                evLow: raw.min_price > 0 ? Math.round(raw.min_price) : Math.round(evMid * 0.35),
                evMid,
                evHigh: raw.max_price > evMid ? Math.round(raw.max_price) : Math.round(evMid * 2.5),
              };
              await supabaseAdmin.from('pricing_cache').upsert({
                player_product_id: pp.id,
                cardhedger_card_id: pp.cardhedger_card_id ?? null,
                ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
                raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
              }, { onConflict: 'player_product_id' });
              return {
                ...pp, ...ev, hobbyEVPerBox: evMid,
                hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
                totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
                pricingSource: 'search-fallback' as const,
              };
            }
          } catch { /* continue */ }

          // Level 3: cross-product pricing cache for the same player
          try {
            const { data: siblings } = await supabaseAdmin
              .from('player_products')
              .select('id')
              .eq('player_id', pp.player_id)
              .neq('id', pp.id);
            if (siblings?.length) {
              const { data: crossCache } = await supabaseAdmin
                .from('pricing_cache')
                .select('ev_mid, ev_low, ev_high')
                .in('player_product_id', siblings.map(s => s.id))
                .gt('ev_mid', 0)
                .order('fetched_at', { ascending: false })
                .limit(1)
                .single();
              if (crossCache && crossCache.ev_mid > 0) {
                return {
                  ...pp,
                  evLow: crossCache.ev_low, evMid: crossCache.ev_mid, evHigh: crossCache.ev_high,
                  hobbyEVPerBox: crossCache.ev_mid,
                  hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
                  totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
                  pricingSource: 'cross-product' as const,
                };
              }
            }
          } catch { /* continue */ }

          // Level 4: position-based defaults
          // Rookies skew toward base auto value; veterans toward base card value
          const evMid = player.is_rookie ? 15 : 8;
          return {
            ...pp,
            evLow: Math.round(evMid * 0.35), evMid, evHigh: Math.round(evMid * 2.5),
            hobbyEVPerBox: evMid,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'default' as const,
          };
        }
      })
    );

    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
