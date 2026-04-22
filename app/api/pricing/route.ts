import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { computeLiveEV, searchAndComputeEV, get90DayPrices } from '@/lib/cardhedger';
import type { PlayerWithPricing } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

// GET — load roster with cached pricing only (fast, no CardHedger calls)
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  try {
    const { data: playerProducts, error } = await supabaseAdmin
      .from('player_products')
      .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility, c_score')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('id');

    if (error) throw error;
    if (!playerProducts?.length) return NextResponse.json({ players: [] });

    const ids = playerProducts.map(pp => pp.id);

    // Chunk the .in() list — 278+ UUIDs exceeds PostgREST's ~8KB URL limit.
    // Same bug family as PRs #4, #6, #8, #10.
    const IN_CHUNK = 200;
    const cachedPricing: { player_product_id: string; ev_low: number; ev_mid: number; ev_high: number }[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const slice = ids.slice(i, i + IN_CHUNK);
      const { data, error: cErr } = await supabaseAdmin
        .from('pricing_cache')
        .select('player_product_id, ev_low, ev_mid, ev_high')
        .in('player_product_id', slice)
        .gt('expires_at', new Date().toISOString());
      if (cErr) throw cErr;
      if (data) cachedPricing.push(...data);
    }

    const cacheMap = new Map(cachedPricing.map(c => [c.player_product_id, c]));

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
      .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility, c_score')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('id');

    if (error) throw error;
    if (!playerProducts?.length) return NextResponse.json({ players: [] });

    const ids = playerProducts.map(pp => pp.id);

    // Load variants for all player_products (used for weighted EV).
    // Chunk the .in() list — 278+ UUIDs blows past PostgREST's ~8KB URL limit;
    // paginate within each chunk too since a single chunk can easily exceed
    // the default 1000-row response cap on hydrated products (6k+ variants).
    // Same bug family as PRs #4, #6, #8, #10.
    const IN_CHUNK = 200;
    const PAGE = 1000;
    type VariantRow = {
      id: string;
      player_product_id: string;
      cardhedger_card_id: string | null;
      hobby_sets: number | null;
      bd_only_sets: number | null;
      hobby_odds: number | null;
    };
    const allVariants: VariantRow[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const slice = ids.slice(i, i + IN_CHUNK);
      for (let offset = 0; ; offset += PAGE) {
        const { data, error: vErr } = await supabaseAdmin
          .from('player_product_variants')
          .select('id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, hobby_odds')
          .in('player_product_id', slice)
          .not('cardhedger_card_id', 'is', null)
          .range(offset, offset + PAGE - 1);
        if (vErr) throw vErr;
        if (!data || data.length === 0) break;
        allVariants.push(...(data as VariantRow[]));
        if (data.length < PAGE) break;
      }
    }

    // Group variants by player_product_id
    const variantMap = new Map<string, VariantRow[]>();
    for (const v of allVariants) {
      const list = variantMap.get(v.player_product_id) ?? [];
      list.push(v);
      variantMap.set(v.player_product_id, list);
    }

    // Same chunking applies to the pricing_cache load.
    const existingCache: { player_product_id: string; ev_low: number; ev_mid: number; ev_high: number }[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const slice = ids.slice(i, i + IN_CHUNK);
      const { data, error: cErr } = await supabaseAdmin
        .from('pricing_cache')
        .select('player_product_id, ev_low, ev_mid, ev_high')
        .in('player_product_id', slice)
        .gt('expires_at', new Date().toISOString());
      if (cErr) throw cErr;
      if (data) existingCache.push(...data);
    }

    const cacheMap = new Map(existingCache.map(c => [c.player_product_id, c]));

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    // Throttle outer fan-out. CH-hydrated products can have 278+ player_products
    // and hundreds of variants each — an unbounded Promise.all fires thousands of
    // parallel CH API calls, and rate limits trash most of them (every failure
    // falls into the "estimated" fallback). 8 concurrent outer workers keeps CH
    // happy and still finishes a full refresh in a reasonable window.
    const OUTER_CONCURRENCY = 8;
    async function mapLimit<T, R>(
      items: T[],
      limit: number,
      worker: (item: T, index: number) => Promise<R>,
    ): Promise<R[]> {
      const results: R[] = new Array(items.length);
      let cursor = 0;
      const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      });
      await Promise.all(runners);
      return results;
    }

    const players: PlayerWithPricing[] = await mapLimit(
      playerProducts,
      OUTER_CONCURRENCY,
      async pp => {
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

            // Filter out variants CH has no price data for. Hydrated products
            // create a row per CH card — including /5, /10, /25 parallels that
            // have never traded individually. Including their evMid=0 in the
            // weighted average drags it to zero and trips the "no data" throw,
            // even when base/refractor variants have real prices.
            const pricedVariants = variantEVs.filter(v => v.evMid > 0);
            if (pricedVariants.length === 0) {
              throw new Error('No pricing data returned');
            }
            const totalSets = pricedVariants.reduce((sum, v) => sum + v.sets, 0);
            ev = {
              evLow: pricedVariants.reduce((sum, v) => sum + v.evLow * v.sets, 0) / totalSets,
              evMid: pricedVariants.reduce((sum, v) => sum + v.evMid * v.sets, 0) / totalSets,
              evHigh: pricedVariants.reduce((sum, v) => sum + v.evHigh * v.sets, 0) / totalSets,
            };
            // Odds-weighted EV: Σ(variantEV × 1/hobby_odds) — expected dollars per box
            // Falls back to evMid if no variant has odds data
            const oddsVariants = pricedVariants.filter(v => v.hobby_odds != null && v.hobby_odds > 0);
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
      },
    );

    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
