import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { computeLiveEV, searchAndComputeEV, get90DayPrices, batchPriceEstimate } from '@/lib/cardhedger';
import type { PlayerWithPricing } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

// Hydrated products have 6,000+ variants. Batch pricing = ~65 sequential
// CH calls @ ~240ms each ≈ 15s just for the pre-fetch. Default Vercel
// function timeout is 10s — the route was silently 504'ing. 60s is plenty.
export const maxDuration = 60;

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

    // POST is the explicit "Refresh" path — always refetch live, never return
    // stale cache rows. (GET still reads from pricing_cache for fast consumer
    // page loads.) Previously we early-returned on any valid cache row, which
    // meant clicking Refresh after a broken run returned the broken values
    // forever, dressed up as `pricingSource: 'cached'`.

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    // Batch-price every variant card up front.
    //
    // Previously: per-variant computeLiveEV fired 25+ parallel CH calls per
    // player_product × 8 outer workers = ~200 concurrent requests → rate limits
    // zeroed out most variants → fallback chain. Refresh was "working" (278/278
    // cache rows) but every price was a Level-2/4 estimate.
    //
    // Now: one batchPriceEstimate call per 500 variants. On a hydrated product
    // with 6,481 variants that's ~13 HTTP calls total, done before any per-pp
    // work starts. EV is driven by CH's "Raw" grade estimate. PSA 9/10
    // breakdown is no longer produced here — deferred to a per-player graded
    // comp drilldown (see backlog).
    const pricesOnly: Map<string, { evLow: number; evMid: number; evHigh: number }> = new Map();
    const allVariantCardIds = Array.from(
      new Set(allVariants.map(v => v.cardhedger_card_id).filter((x): x is string => !!x)),
    );
    // CH's batch-price-estimate endpoint caps at 100 items per request.
    // Any higher and it returns HTTP 400 with "List should have at most 100
    // items after validation" — the whole batch is rejected, pricesOnly stays
    // empty, every variant gets evMid=0, every player lands in the fallback
    // chain. Verified with direct curl against the endpoint.
    const PRICE_CHUNK = 100;
    const PRICE_FETCH_CONCURRENCY = 6;

    // Build the list of chunks first, then run them with bounded concurrency.
    // 65 sequential × 240ms = 15s; at 6 parallel, ~2.7s. Keeps us well inside
    // the 60s maxDuration even on the biggest products.
    const priceChunks: string[][] = [];
    for (let i = 0; i < allVariantCardIds.length; i += PRICE_CHUNK) {
      priceChunks.push(allVariantCardIds.slice(i, i + PRICE_CHUNK));
    }

    let chunkCursor = 0;
    const chunkWorkers = Array.from(
      { length: Math.min(PRICE_FETCH_CONCURRENCY, priceChunks.length) },
      async () => {
        while (true) {
          const idx = chunkCursor++;
          if (idx >= priceChunks.length) return;
          const chunk = priceChunks[idx];
          const items = chunk.map(card_id => ({ card_id, grade: 'Raw' }));
          try {
            const results = await batchPriceEstimate(items);
            for (const r of results) {
              if (r.success && r.price > 0) {
                pricesOnly.set(r.card_id, {
                  evLow: Math.round(r.price_low > 0 ? r.price_low : r.price * 0.35),
                  evMid: Math.round(r.price),
                  evHigh: Math.round(r.price_high > r.price ? r.price_high : r.price * 2.5),
                });
              }
            }
          } catch (e) {
            // Don't let a single batch failure nuke the whole refresh — other
            // chunks still run, and missing cards fall to the per-pp fallback.
            console.error(
              `batchPriceEstimate failed at chunk ${idx} (size ${chunk.length}):`,
              e instanceof Error ? e.message : e,
            );
          }
        }
      },
    );
    await Promise.all(chunkWorkers);
    console.log(`[pricing] batch-fetched ${pricesOnly.size}/${allVariantCardIds.length} variant prices`);

    // Throttle outer fan-out. Even with batch pricing done, the fallback
    // branches below still call CH (searchAndComputeEV, get90DayPrices) for
    // variants the batch had no data on. 8 concurrent workers keeps CH happy.
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

    // Collect pricing_cache rows from the workers and bulk-upsert at the end.
    // Previously each worker did its own upsert inline → 278 sequential round
    // trips through 8 concurrent workers ≈ 5-10s of pure Supabase latency
    // piled on top of CH pricing work. Bulk upsert is one round trip per 500.
    type CacheRow = {
      player_product_id: string;
      cardhedger_card_id: string | null;
      ev_low: number;
      ev_mid: number;
      ev_high: number;
      raw_comps: Record<string, unknown>;
      fetched_at: string;
      expires_at: string;
    };
    const cacheRows: CacheRow[] = [];

    // Lazy-loaded once per refresh. Only needed if any player hits Level 3
    // (cross-product) fallback, so we avoid paying for it in the common case.
    const pps = playerProducts; // narrow for closure
    let siblingPricingPromise: Promise<Map<string, { ev_low: number; ev_mid: number; ev_high: number }>> | null = null;
    async function loadSiblingPricing(): Promise<Map<string, { ev_low: number; ev_mid: number; ev_high: number }>> {
      if (!siblingPricingPromise) {
        siblingPricingPromise = (async () => {
          // Pull latest cache row per player across OTHER products this set's
          // players appear in. Keyed by player_id → pricing.
          const playerIds = Array.from(new Set(pps.map(p => p.player_id)));
          const PID_CHUNK = 200;
          const siblingRows: { player_id: string; ev_low: number; ev_mid: number; ev_high: number; fetched_at: string }[] = [];
          for (let i = 0; i < playerIds.length; i += PID_CHUNK) {
            const slice = playerIds.slice(i, i + PID_CHUNK);
            const { data } = await supabaseAdmin
              .from('player_products')
              .select('id, player_id, pricing_cache!inner(ev_low, ev_mid, ev_high, fetched_at)')
              .in('player_id', slice)
              .neq('product_id', productId)
              .gt('pricing_cache.ev_mid', 0)
              .limit(1000);
            type Joined = { id: string; player_id: string; pricing_cache: Array<{ ev_low: number; ev_mid: number; ev_high: number; fetched_at: string }> };
            for (const row of (data as Joined[] | null) ?? []) {
              for (const pc of row.pricing_cache) {
                siblingRows.push({ player_id: row.player_id, ...pc });
              }
            }
          }
          const byPlayer = new Map<string, { ev_low: number; ev_mid: number; ev_high: number; fetched_at: string }>();
          for (const r of siblingRows) {
            const existing = byPlayer.get(r.player_id);
            if (!existing || r.fetched_at > existing.fetched_at) byPlayer.set(r.player_id, r);
          }
          const result = new Map<string, { ev_low: number; ev_mid: number; ev_high: number }>();
          for (const [k, v] of byPlayer) result.set(k, { ev_low: v.ev_low, ev_mid: v.ev_mid, ev_high: v.ev_high });
          return result;
        })();
      }
      return siblingPricingPromise;
    }

    let livePriced = 0;
    let crossPriced = 0;
    let searchPriced = 0;
    let defaultPriced = 0;

    const players: PlayerWithPricing[] = await mapLimit(
      playerProducts,
      OUTER_CONCURRENCY,
      async pp => {
        const variants = variantMap.get(pp.id) ?? [];

        // --- Path A: variants exist (hydrated product) ---
        // Use the pre-fetched batch prices. If batch returned 0 for every
        // variant, this player has no Raw sales at CH — do NOT fall back to
        // Level 2 search. That would be 278 wasted `get90DayPrices(name)`
        // calls per refresh. Go straight to Level 3 (cross-product) → Level 4.
        if (variants.length > 0) {
          const variantEVs = variants.map(v => {
            const price = pricesOnly.get(v.cardhedger_card_id!);
            const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0);
            return {
              evLow: price?.evLow ?? 0,
              evMid: price?.evMid ?? 0,
              evHigh: price?.evHigh ?? 0,
              sets: Math.max(sets, 1),
              hobby_odds: v.hobby_odds,
            };
          });
          const pricedVariants = variantEVs.filter(v => v.evMid > 0);

          if (pricedVariants.length > 0) {
            const totalSets = pricedVariants.reduce((sum, v) => sum + v.sets, 0);
            const ev = {
              evLow: pricedVariants.reduce((sum, v) => sum + v.evLow * v.sets, 0) / totalSets,
              evMid: pricedVariants.reduce((sum, v) => sum + v.evMid * v.sets, 0) / totalSets,
              evHigh: pricedVariants.reduce((sum, v) => sum + v.evHigh * v.sets, 0) / totalSets,
            };
            const oddsVariants = pricedVariants.filter(v => v.hobby_odds != null && v.hobby_odds > 0);
            const hobbyEVPerBox = oddsVariants.length > 0
              ? oddsVariants.reduce((sum, v) => sum + v.evMid * (1 / v.hobby_odds!), 0)
              : ev.evMid;

            cacheRows.push({
              player_product_id: pp.id,
              cardhedger_card_id: pp.cardhedger_card_id ?? null,
              ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
              raw_comps: {},
              fetched_at: new Date().toISOString(),
              expires_at: expiresAt.toISOString(),
            });
            livePriced++;
            return {
              ...pp,
              evLow: ev.evLow, evMid: ev.evMid, evHigh: ev.evHigh,
              hobbyEVPerBox,
              hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
              totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
              pricingSource: 'live' as const,
            };
          }

          // All variants priced at 0 → skip Level 2, go to Level 3.
          const siblingMap = await loadSiblingPricing();
          const sibling = siblingMap.get(pp.player_id);
          if (sibling && sibling.ev_mid > 0) {
            crossPriced++;
            return {
              ...pp,
              evLow: sibling.ev_low, evMid: sibling.ev_mid, evHigh: sibling.ev_high,
              hobbyEVPerBox: sibling.ev_mid,
              hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
              totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
              pricingSource: 'cross-product' as const,
            };
          }

          // Level 4: position-based default
          const evMid = pp.player.is_rookie ? 15 : 8;
          defaultPriced++;
          return {
            ...pp,
            evLow: Math.round(evMid * 0.35), evMid, evHigh: Math.round(evMid * 2.5),
            hobbyEVPerBox: evMid,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'default' as const,
          };
        }

        // --- Path B: no variants (non-hydrated product, parser-driven or empty) ---
        // This is the legacy single-card-per-player path. Keep the old per-player
        // CH calls + Level 2 fallback here — we don't have a batch to lean on.
        try {
          let ev: { evLow: number; evMid: number; evHigh: number };
          const cardId = pp.cardhedger_card_id;
          if (!cardId) {
            const query = `${pp.player.name} ${product?.year ?? ''} ${product?.name ?? ''}`.trim();
            const result = await searchAndComputeEV(query);
            if (!result) throw new Error('No card found');
            ev = { evLow: result.evLow, evMid: result.evMid, evHigh: result.evHigh };
            await supabaseAdmin
              .from('player_products')
              .update({ cardhedger_card_id: result.cardId })
              .eq('id', pp.id);
          } else {
            ev = await computeLiveEV(cardId);
          }
          if (ev.evMid === 0) throw new Error('No pricing data returned');
          cacheRows.push({
            player_product_id: pp.id,
            cardhedger_card_id: pp.cardhedger_card_id ?? null,
            ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
            raw_comps: {},
            fetched_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
          });
          livePriced++;
          return {
            ...pp,
            evLow: ev.evLow, evMid: ev.evMid, evHigh: ev.evHigh,
            hobbyEVPerBox: ev.evMid,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'live' as const,
          };
        } catch {
          // Level 2: 90-day search (only for non-hydrated products — per above)
          try {
            const player = pp.player;
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
              cacheRows.push({
                player_product_id: pp.id,
                cardhedger_card_id: pp.cardhedger_card_id ?? null,
                ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
                raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
              });
              searchPriced++;
              return {
                ...pp, ...ev, hobbyEVPerBox: evMid,
                hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
                totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
                pricingSource: 'search-fallback' as const,
              };
            }
          } catch { /* continue */ }

          // Level 3 for non-hydrated too
          const siblingMap = await loadSiblingPricing();
          const sibling = siblingMap.get(pp.player_id);
          if (sibling && sibling.ev_mid > 0) {
            crossPriced++;
            return {
              ...pp,
              evLow: sibling.ev_low, evMid: sibling.ev_mid, evHigh: sibling.ev_high,
              hobbyEVPerBox: sibling.ev_mid,
              hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
              totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
              pricingSource: 'cross-product' as const,
            };
          }

          const evMid = pp.player.is_rookie ? 15 : 8;
          defaultPriced++;
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

    // Bulk upsert pricing_cache in one go (chunked). Previously 278 inline
    // round-trips scattered across workers; now one pass at the end.
    if (cacheRows.length > 0) {
      const UPSERT_CHUNK = 500;
      for (let i = 0; i < cacheRows.length; i += UPSERT_CHUNK) {
        const slice = cacheRows.slice(i, i + UPSERT_CHUNK);
        const { error: upErr } = await supabaseAdmin
          .from('pricing_cache')
          .upsert(slice, { onConflict: 'player_product_id' });
        if (upErr) console.error(`pricing_cache bulk upsert failed at offset ${i}:`, upErr.message);
      }
    }

    console.log(
      `[pricing] done · ${players.length} players · live=${livePriced} cross=${crossPriced} search=${searchPriced} default=${defaultPriced} · cache=${cacheRows.length}`,
    );

    return NextResponse.json({ players });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
