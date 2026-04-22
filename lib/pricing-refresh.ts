/**
 * Product pricing refresh — the heavy live-fetch pipeline.
 *
 * Originally this lived inside `POST /api/pricing` but got extracted when we
 * stopped letting the consumer break page drive live CH fetches. Now:
 *   - `POST /api/pricing`  → cache-read only, fast, never 504s
 *   - `POST /api/admin/refresh-product-pricing` → admin-only, calls this
 *   - `/api/cron/refresh-pricing` → nightly, fans out to the admin endpoint
 *
 * Known limits (tracked in BACKLOG items C/D):
 *   - Vercel Hobby caps at 60s per invocation. Products with 6,000+ variants
 *     (Bowman Chrome, Topps Finest) may exceed this and leave partial data.
 *   - Per-variant price cache (D) would let us do incremental refreshes and
 *     dodge this entirely; until then, partial completion is acceptable.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV, searchAndComputeEV, get90DayPrices, batchPriceEstimate } from '@/lib/cardhedger';

const CACHE_TTL_HOURS = 24;

// Vercel Pro kills the function at 300s. Stop the batch phase early so we
// have time to run per-pp fallbacks + upsert cache rows. Jumbo products
// (Bowman Chrome 6,481 variants) typically finish batch in ~160s. These
// deadlines are the safety net for unusually slow CH responses.
const BATCH_DEADLINE_MS = 270_000; // stop enqueueing new chunks after 4:30
const HARD_DEADLINE_MS = 290_000;  // last moment to bail from per-pp phase

export interface RefreshSummary {
  productId: string;
  productName: string | null;
  totalPlayers: number;
  livePriced: number;
  crossPriced: number;
  searchPriced: number;
  defaultPriced: number;
  variantsFetched: number;
  variantsTotal: number;
  batchChunkCount: number;
  batchChunksCompleted: number;
  batchDurationMs: number;
  totalDurationMs: number;
  partial: boolean;
}

export async function refreshProductPricing(productId: string): Promise<RefreshSummary> {
  const started = Date.now();

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, year')
    .eq('id', productId)
    .single();

  const { data: playerProducts, error } = await supabaseAdmin
    .from('player_products')
    .select('id, player_id, cardhedger_card_id, player:players(id, name, is_rookie)')
    .eq('product_id', productId)
    .eq('insert_only', false)
    .order('id');

  if (error) throw error;
  if (!playerProducts?.length) {
    return {
      productId,
      productName: product?.name ?? null,
      totalPlayers: 0,
      livePriced: 0, crossPriced: 0, searchPriced: 0, defaultPriced: 0,
      variantsFetched: 0, variantsTotal: 0,
      batchChunkCount: 0, batchChunksCompleted: 0, batchDurationMs: 0,
      totalDurationMs: Date.now() - started,
      partial: false,
    };
  }

  // --- Load variants (chunked + paginated; hydrated products have 6k+) ---
  const ids = playerProducts.map(pp => pp.id);
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

  const variantMap = new Map<string, VariantRow[]>();
  for (const v of allVariants) {
    const list = variantMap.get(v.player_product_id) ?? [];
    list.push(v);
    variantMap.set(v.player_product_id, list);
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

  // --- Batch-price every unique variant card ---
  const pricesOnly = new Map<string, { evLow: number; evMid: number; evHigh: number }>();
  const allVariantCardIds = Array.from(
    new Set(allVariants.map(v => v.cardhedger_card_id).filter((x): x is string => !!x)),
  );

  const PRICE_CHUNK = 100; // CH endpoint hard cap
  const PRICE_FETCH_CONCURRENCY = 6;
  const priceChunks: string[][] = [];
  for (let i = 0; i < allVariantCardIds.length; i += PRICE_CHUNK) {
    priceChunks.push(allVariantCardIds.slice(i, i + PRICE_CHUNK));
  }

  async function runChunk(idx: number, chunk: string[], attempt = 0): Promise<void> {
    const items = chunk.map(card_id => ({ card_id, grade: 'Raw' }));
    const start = Date.now();
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
      const ms = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 0) {
        console.warn(`[pricing-refresh] chunk ${idx} failed after ${ms}ms (retrying): ${msg}`);
        await runChunk(idx, chunk, 1);
        return;
      }
      console.error(`[pricing-refresh] chunk ${idx} failed after retry (${ms}ms): ${msg}`);
    }
  }

  let chunkCursor = 0;
  let chunksCompleted = 0;
  const batchStart = Date.now();
  const chunkWorkers = Array.from(
    { length: Math.min(PRICE_FETCH_CONCURRENCY, priceChunks.length) },
    async () => {
      while (true) {
        // Stop enqueueing new chunks past the deadline — leaves runway for
        // the per-pp phase + cache upsert before Vercel kills us at 60s.
        if (Date.now() - started > BATCH_DEADLINE_MS) return;
        const idx = chunkCursor++;
        if (idx >= priceChunks.length) return;
        await runChunk(idx, priceChunks[idx]);
        chunksCompleted++;
      }
    },
  );
  await Promise.all(chunkWorkers);
  const batchDurationMs = Date.now() - batchStart;
  const batchTimedOut = chunksCompleted < priceChunks.length;
  if (batchTimedOut) {
    console.warn(
      `[pricing-refresh] batch phase hit deadline: ${chunksCompleted}/${priceChunks.length} chunks ` +
      `in ${batchDurationMs}ms (${pricesOnly.size} variants priced) — proceeding with partial data`,
    );
  }

  // --- Build cache rows via per-player workers (same fallback ladder as before) ---
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

  // Lazy-load sibling pricing once on first fallback demand.
  const pps = playerProducts;
  let siblingPricingPromise: Promise<Map<string, { ev_low: number; ev_mid: number; ev_high: number }>> | null = null;
  async function loadSiblingPricing() {
    if (!siblingPricingPromise) {
      siblingPricingPromise = (async () => {
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
          // Supabase returns pricing_cache as an object on 1:1 FK shapes and
          // an array on 1:N — we've hit both shapes in practice. Normalize.
          type PC = { ev_low: number; ev_mid: number; ev_high: number; fetched_at: string };
          type Joined = { id: string; player_id: string; pricing_cache: PC | PC[] | null };
          for (const row of (data as Joined[] | null) ?? []) {
            const pcList = Array.isArray(row.pricing_cache)
              ? row.pricing_cache
              : row.pricing_cache
                ? [row.pricing_cache]
                : [];
            for (const pc of pcList) siblingRows.push({ player_id: row.player_id, ...pc });
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

  let livePriced = 0, crossPriced = 0, searchPriced = 0, defaultPriced = 0;
  let hardDeadlineHit = false;

  // Narrowed shape of the Supabase join — `player` comes back as an object,
  // not an array, when the FK is unique.
  type PP = {
    id: string;
    player_id: string;
    cardhedger_card_id: string | null;
    player: { id: string; name: string; is_rookie: boolean } | null;
  };

  await mapLimit(playerProducts as unknown as PP[], OUTER_CONCURRENCY, async pp => {
    // Hard deadline: bail out and at least preserve what we've collected.
    if (Date.now() - started > HARD_DEADLINE_MS) {
      hardDeadlineHit = true;
      return;
    }
    const variants = variantMap.get(pp.id) ?? [];
    const playerIsRookie = pp.player?.is_rookie ?? false;
    const playerName = pp.player?.name ?? '';

    // Hydrated product path
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
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        livePriced++;
        return;
      }

      // All variant prices came back 0 → Level 3 → Level 4 (skip Level 2 search)
      const siblingMap = await loadSiblingPricing();
      const sibling = siblingMap.get(pp.player_id);
      if (sibling && sibling.ev_mid > 0) {
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ev_low: sibling.ev_low, ev_mid: sibling.ev_mid, ev_high: sibling.ev_high,
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        crossPriced++;
        return;
      }

      const evMid = playerIsRookie ? 15 : 8;
      cacheRows.push({
        player_product_id: pp.id,
        cardhedger_card_id: pp.cardhedger_card_id ?? null,
        ev_low: Math.round(evMid * 0.35), ev_mid: evMid, ev_high: Math.round(evMid * 2.5),
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      defaultPriced++;
      return;
    }

    // Non-hydrated: per-player CH calls + Level 2 search
    try {
      let ev: { evLow: number; evMid: number; evHigh: number };
      const cardId = pp.cardhedger_card_id;
      if (!cardId) {
        const query = `${playerName} ${product?.year ?? ''} ${product?.name ?? ''}`.trim();
        const result = await searchAndComputeEV(query);
        if (!result) throw new Error('No card found');
        ev = { evLow: result.evLow, evMid: result.evMid, evHigh: result.evHigh };
        await supabaseAdmin.from('player_products').update({ cardhedger_card_id: result.cardId }).eq('id', pp.id);
      } else {
        ev = await computeLiveEV(cardId);
      }
      if (ev.evMid === 0) throw new Error('No pricing data returned');
      cacheRows.push({
        player_product_id: pp.id,
        cardhedger_card_id: pp.cardhedger_card_id ?? null,
        ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      livePriced++;
      return;
    } catch { /* fall through */ }

    try {
      const cardType = playerIsRookie ? 'Auto RC' : 'Base';
      const result = await get90DayPrices(`${playerName} ${cardType}`, 'Raw');
      const raw = result.prices.find(p => p.grade.toLowerCase().includes('raw'));
      if (raw && raw.avg_price > 0) {
        const evMid = Math.round(raw.avg_price);
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ev_low: raw.min_price > 0 ? Math.round(raw.min_price) : Math.round(evMid * 0.35),
          ev_mid: evMid,
          ev_high: raw.max_price > evMid ? Math.round(raw.max_price) : Math.round(evMid * 2.5),
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        searchPriced++;
        return;
      }
    } catch { /* continue */ }

    const siblingMap = await loadSiblingPricing();
    const sibling = siblingMap.get(pp.player_id);
    if (sibling && sibling.ev_mid > 0) {
      cacheRows.push({
        player_product_id: pp.id,
        cardhedger_card_id: pp.cardhedger_card_id ?? null,
        ev_low: sibling.ev_low, ev_mid: sibling.ev_mid, ev_high: sibling.ev_high,
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      crossPriced++;
      return;
    }

    const evMid = playerIsRookie ? 15 : 8;
    cacheRows.push({
      player_product_id: pp.id,
      cardhedger_card_id: pp.cardhedger_card_id ?? null,
      ev_low: Math.round(evMid * 0.35), ev_mid: evMid, ev_high: Math.round(evMid * 2.5),
      raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
    });
    defaultPriced++;
  });

  // Bulk upsert pricing_cache
  if (cacheRows.length > 0) {
    const UPSERT_CHUNK = 500;
    for (let i = 0; i < cacheRows.length; i += UPSERT_CHUNK) {
      const slice = cacheRows.slice(i, i + UPSERT_CHUNK);
      const { error: upErr } = await supabaseAdmin
        .from('pricing_cache')
        .upsert(slice, { onConflict: 'player_product_id' });
      if (upErr) console.error(`[pricing-refresh] bulk upsert failed at offset ${i}: ${upErr.message}`);
    }
  }

  const totalDurationMs = Date.now() - started;
  const partial = batchTimedOut || hardDeadlineHit;
  console.log(
    `[pricing-refresh] product=${product?.name ?? productId} players=${playerProducts.length} ` +
    `live=${livePriced} cross=${crossPriced} search=${searchPriced} default=${defaultPriced} ` +
    `variants=${pricesOnly.size}/${allVariantCardIds.length} ` +
    `chunks=${chunksCompleted}/${priceChunks.length} batch=${batchDurationMs}ms ` +
    `total=${totalDurationMs}ms${partial ? ' PARTIAL' : ''}`,
  );

  return {
    productId,
    productName: product?.name ?? null,
    totalPlayers: playerProducts.length,
    livePriced, crossPriced, searchPriced, defaultPriced,
    variantsFetched: pricesOnly.size,
    variantsTotal: allVariantCardIds.length,
    batchChunkCount: priceChunks.length,
    batchChunksCompleted: chunksCompleted,
    batchDurationMs,
    totalDurationMs,
    partial,
  };
}
