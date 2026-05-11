/**
 * Product pricing refresh — the heavy live-fetch pipeline.
 *
 * Originally this lived inside `POST /api/pricing` but got extracted when we
 * stopped letting the consumer break page drive live CH fetches. Now:
 *   - `POST /api/pricing`  → cache-read only, fast, never 504s
 *   - `POST /api/admin/refresh-product-pricing` → admin-only, calls this
 *   - `/api/cron/refresh-pricing` → nightly, fans out to the admin endpoint
 *
 * Timeout-safety architecture (post-2026-05-09):
 *   - Per-CH-card prices are cached in `ch_price_cache`, written DURING each
 *     batch chunk (not at the end). A timed-out function still persists the
 *     work it completed; the next firing skips fresh cards and continues.
 *   - Per-player_product cache rows are flushed to `pricing_cache` every
 *     ~100 PPs during the per-pp phase, not at the end. Same rationale.
 *   - Stale-first ordering in the cron means the most-overdue products keep
 *     getting picked up until they finish, while small/healthy products
 *     refresh in single firings.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV, searchAndComputeEV, get90DayPrices, batchPriceEstimate } from '@/lib/cardhedger';
import { aggregatePlayerEV, type AnchorStrategy } from '@/lib/pricing-anchors';
import { lifecycleEvMultiplier } from '@/lib/market-markup';
import type { ProductLifecycle } from '@/lib/types';

const CACHE_TTL_HOURS = 24;
// `ch_price_cache` freshness window. Matches CACHE_TTL_HOURS so a refresh
// run that completes both phases produces consistent results — the per-card
// cache and the per-pp pricing_cache age out together.
const CH_PRICE_CACHE_TTL_HOURS = 24;

// Vercel Pro kills the function at 300s. Stop the batch phase early so we
// have time to run per-pp fallbacks + upsert cache rows. Bowman Chrome
// (~6,481 variants) historically finished Raw-only batch in ~160s; with
// PSA 9 + PSA 10 added in parallel per chunk that climbs to ~240s under
// concurrency=12, so the deadlines were bumped accordingly. The next cron
// firing's stale-first selection picks up anything that goes partial.
const BATCH_DEADLINE_MS = 280_000; // stop enqueueing new chunks after 4:40
const HARD_DEADLINE_MS = 295_000;  // last moment to bail from per-pp phase

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
  variantsFromCache: number;     // pulled from ch_price_cache (fresh, no CH call)
  variantsNewlyFetched: number;  // freshly fetched from CH this run
  chunksWithCacheWrite: number;  // chunks whose ch_price_cache upsert ran successfully
  chunksAllGradesFailed: number; // chunks where every CH call (Raw/PSA 9/PSA 10) rejected
  batchChunkCount: number;
  batchChunksCompleted: number;
  batchDurationMs: number;
  totalDurationMs: number;
  cacheRowsWritten: number;
  partial: boolean;
  /** Configured anchor strategy at refresh time. */
  anchorStrategy: AnchorStrategy;
  /** Number of player_products that fell back to sets_weighted_all because curated patterns matched 0 variants. */
  anchorFellBackCount: number;
  /** Average matched-variant count across hydrated player_products. Useful sanity check for curated configs. */
  anchorMatchedVariantsAvg: number;
  /** Plan C: lifecycle state used for the math-layer multiplier. */
  lifecycleStatus: ProductLifecycle;
  /** Plan C: actual multiplier applied to ev_low/mid/high before pricing_cache upsert. 1.0 = no change. */
  lifecycleMultiplier: number;
}

export async function refreshProductPricing(productId: string): Promise<RefreshSummary> {
  const started = Date.now();

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('name, year, anchor_strategy, anchor_variant_patterns, lifecycle_status, live_since')
    .eq('id', productId)
    .single();

  // Anchor configuration: defaults preserve pre-2026-05-11 sets-weighted behavior.
  // Validate the strategy string to a narrow union — fall back if a future column value
  // doesn't match (defense against schema drift, not against current values).
  const rawStrategy = (product?.anchor_strategy ?? 'sets_weighted_all') as string;
  const anchorStrategy: AnchorStrategy =
    rawStrategy === 'curated_variants' || rawStrategy === 'curated_with_tail' || rawStrategy === 'sets_weighted_all'
      ? rawStrategy
      : 'sets_weighted_all';
  const anchorPatterns: string[] = Array.isArray(product?.anchor_variant_patterns)
    ? (product!.anchor_variant_patterns as string[])
    : [];

  // Plan C: lifecycle-aware math-layer multiplier. Applied to every EV
  // before it lands in pricing_cache, so cached values reflect expected
  // sale prices in the current lifecycle window. Plan B's display markup
  // compounds on top at render time. Computed once per refresh — live_since
  // doesn't change mid-run.
  const lifecycleStatus = (product?.lifecycle_status ?? 'live') as ProductLifecycle;
  const liveSince = (product as { live_since?: string | null } | null)?.live_since ?? null;
  const lifecycleMultiplier = lifecycleEvMultiplier(lifecycleStatus, liveSince);
  const applyMultiplier = (lo: number, mid: number, hi: number) => ({
    ev_low:  Math.round(lo  * lifecycleMultiplier),
    ev_mid:  Math.round(mid * lifecycleMultiplier),
    ev_high: Math.round(hi  * lifecycleMultiplier),
  });

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
      variantsFromCache: 0, variantsNewlyFetched: 0,
      chunksWithCacheWrite: 0, chunksAllGradesFailed: 0,
      batchChunkCount: 0, batchChunksCompleted: 0, batchDurationMs: 0,
      totalDurationMs: Date.now() - started,
      cacheRowsWritten: 0,
      partial: false,
      anchorStrategy,
      anchorFellBackCount: 0,
      anchorMatchedVariantsAvg: 0,
      lifecycleStatus,
      lifecycleMultiplier,
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
    variant_name: string | null;
    hobby_sets: number | null;
    bd_only_sets: number | null;
    jumbo_sets: number | null;
    hobby_odds: number | null;
    print_run: number | null;
  };
  const allVariants: VariantRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    for (let offset = 0; ; offset += PAGE) {
      const { data, error: vErr } = await supabaseAdmin
        .from('player_product_variants')
        .select('id, player_product_id, cardhedger_card_id, variant_name, hobby_sets, bd_only_sets, jumbo_sets, hobby_odds, print_run')
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
  // confidence is what CH's batch-price-estimate returns per card (0..1);
  // we aggregate it sales-weighted alongside EV so consumers can see when
  // a row's price is built on thin comps.
  const pricesOnly = new Map<string, { evLow: number; evMid: number; evHigh: number; confidence: number }>();
  const allVariantCardIds = Array.from(
    new Set(allVariants.map(v => v.cardhedger_card_id).filter((x): x is string => !!x)),
  );

  // Load fresh per-card prices from ch_price_cache. Anything fresher than
  // CH_PRICE_CACHE_TTL_HOURS goes directly into pricesOnly without a CH call.
  // This is the timeout-safety win: a previous run that died mid-batch still
  // persisted its completed chunks here, so subsequent runs only fetch the
  // remaining stale cards.
  const cacheCutoff = new Date(Date.now() - CH_PRICE_CACHE_TTL_HOURS * 3_600_000).toISOString();
  let variantsFromCache = 0;
  if (allVariantCardIds.length > 0) {
    const CACHE_LOOKUP_CHUNK = 1000; // supabase .in() works fine well past this; 1k is comfy
    for (let i = 0; i < allVariantCardIds.length; i += CACHE_LOOKUP_CHUNK) {
      const slice = allVariantCardIds.slice(i, i + CACHE_LOOKUP_CHUNK);
      const { data: cachedRows, error: cacheReadErr } = await supabaseAdmin
        .from('ch_price_cache')
        .select('cardhedger_card_id, raw_price, psa9_price, psa10_price, confidence')
        .in('cardhedger_card_id', slice)
        .gte('fetched_at', cacheCutoff);
      if (cacheReadErr) {
        // Don't fail the whole refresh — degrade to "treat everything as stale"
        console.warn(`[pricing-refresh] ch_price_cache read failed (degrading to live fetch): ${cacheReadErr.message}`);
        continue;
      }
      type CR = { cardhedger_card_id: string; raw_price: number | null; psa9_price: number | null; psa10_price: number | null; confidence: number | null };
      for (const r of (cachedRows as CR[] | null) ?? []) {
        // Same evMid/evLow/evHigh derivation as runChunk — keep both paths
        // in sync so cache hits and live fetches produce identical EV math.
        const rawPrice  = r.raw_price   != null && r.raw_price   > 0 ? r.raw_price   : null;
        const midPrice  = r.psa9_price  != null && r.psa9_price  > 0 ? r.psa9_price  : rawPrice;
        const highPrice = r.psa10_price != null && r.psa10_price > 0 ? r.psa10_price : null;
        if (!rawPrice && !midPrice && !highPrice) continue;
        const evMid  = midPrice ?? 0;
        const evLow  = rawPrice ?? Math.round(evMid * 0.35);
        const evHigh = highPrice ?? Math.round(evMid * 2.5);
        pricesOnly.set(r.cardhedger_card_id, {
          evLow: Math.round(evLow),
          evMid: Math.round(evMid),
          evHigh: Math.round(evHigh),
          confidence: r.confidence ?? 0,
        });
        variantsFromCache++;
      }
    }
  }

  // Build chunks from card_ids that DIDN'T hit the cache (i.e., stale or never-fetched).
  const staleCardIds = allVariantCardIds.filter(id => !pricesOnly.has(id));

  const PRICE_CHUNK = 100; // CH endpoint hard cap
  // 2026-05-11: dropped from 12 → 4 after a week of refresh failures on
  // large products. At 12 chunks × 3 grades = 36 concurrent CH requests,
  // CH was timing out or returning unusable data for every chunk on
  // products with >5k unique cards (Donruss Optic, Pristine, Topps Finest
  // all reported variantsNewlyFetched=0 across 49+ "completed" chunks).
  // 4 × 3 = 12 in-flight gives each call enough bandwidth to complete.
  // The per-CH-card cache means even small per-firing yields compound —
  // we don't need to drain the queue in one shot.
  const PRICE_FETCH_CONCURRENCY = 4;
  const priceChunks: string[][] = [];
  for (let i = 0; i < staleCardIds.length; i += PRICE_CHUNK) {
    priceChunks.push(staleCardIds.slice(i, i + PRICE_CHUNK));
  }

  // Per-grade fan-out. Three parallel batchPriceEstimate calls per chunk
  // (Raw, PSA 9, PSA 10) keeps grade context implicit per call so we don't
  // depend on CH echoing `grade` in the batch response. EV mapping mirrors
  // evFromPrices in lib/cardhedger.ts: PSA 9 drives evMid (preferred),
  // Raw drives evLow, PSA 10 drives evHigh. Heuristic 0.35× / 2.5× multipliers
  // remain only as last-resort fallbacks when a grade is missing.
  let variantsNewlyFetched = 0;
  let chunksWithCacheWrite = 0;  // chunks whose ch_price_cache upsert ran
  let chunksAllGradesFailed = 0; // chunks where every CH call rejected
  async function runChunk(idx: number, chunk: string[]): Promise<void> {
    const start = Date.now();
    // Promise.allSettled instead of Promise.all: one timing-out CH call
    // (PSA 9 takes 35s, say) no longer wipes out the other two grades' results
    // OR the cache writeback. Previously Promise.all rejected on the first
    // failure → jumped to catch → recursive retry → retry also slow → log and
    // continue WITHOUT writing anything. That left ch_price_cache empty after
    // 50 "completed" chunks for Donruss Optic.
    const settled = await Promise.allSettled([
      batchPriceEstimate(chunk.map(card_id => ({ card_id, grade: 'Raw' }))),
      batchPriceEstimate(chunk.map(card_id => ({ card_id, grade: 'PSA 9' }))),
      batchPriceEstimate(chunk.map(card_id => ({ card_id, grade: 'PSA 10' }))),
    ]);
    const rawResults   = settled[0].status === 'fulfilled' ? settled[0].value : null;
    const psa9Results  = settled[1].status === 'fulfilled' ? settled[1].value : null;
    const psa10Results = settled[2].status === 'fulfilled' ? settled[2].value : null;

    if (!rawResults && !psa9Results && !psa10Results) {
      chunksAllGradesFailed++;
      const ms = Date.now() - start;
      const rejections = settled
        .map(s => s.status === 'rejected' ? (s.reason instanceof Error ? s.reason.message : String(s.reason)) : null)
        .filter(Boolean);
      console.error(`[pricing-refresh] chunk ${idx} all grades failed (${ms}ms): ${rejections.join(' | ')}`);
      // Still write null-price cache rows so we don't re-fetch this chunk on
      // the next firing's first attempt. The 24h TTL means we'll come back.
      // Without this, a transient CH outage means we re-attempt forever.
    }

    const rawMap   = new Map(rawResults?.map(r => [r.card_id, r])   ?? []);
    const psa9Map  = new Map(psa9Results?.map(r => [r.card_id, r])  ?? []);
    const psa10Map = new Map(psa10Results?.map(r => [r.card_id, r]) ?? []);

    // Persist EVERY card we asked CH about, even ones with no price.
    // The cache row's purpose is "we've asked CH within the TTL window" —
    // setting fetched_at on null-price rows prevents a re-fetch storm
    // for cards CH simply doesn't have data for. Worst case: a freshly-listed
    // card waits up to 24h before we re-check.
    const fetchedAt = new Date().toISOString();
    const cachePersistRows = chunk.map(cardId => {
      const r   = rawMap.get(cardId);
      const p9  = psa9Map.get(cardId);
      const p10 = psa10Map.get(cardId);
      const validRaw   = r?.success   && r.price   > 0 ? r   : null;
      const validPsa9  = p9?.success  && p9.price  > 0 ? p9  : null;
      const validPsa10 = p10?.success && p10.price > 0 ? p10 : null;
      const contribs = [validRaw, validPsa9, validPsa10].filter((x): x is NonNullable<typeof x> => !!x);
      const confidence = contribs.length > 0
        ? contribs.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / contribs.length
        : null;
      return {
        cardhedger_card_id: cardId,
        raw_price:   validRaw?.price   ?? null,
        psa9_price:  validPsa9?.price  ?? null,
        psa10_price: validPsa10?.price ?? null,
        confidence,
        fetched_at: fetchedAt,
      };
    });
    const { error: cacheWriteErr } = await supabaseAdmin
      .from('ch_price_cache')
      .upsert(cachePersistRows, { onConflict: 'cardhedger_card_id' });
    if (cacheWriteErr) {
      console.warn(`[pricing-refresh] ch_price_cache upsert chunk ${idx} failed: ${cacheWriteErr.message}`);
    } else {
      chunksWithCacheWrite++;
    }

    for (const cardId of chunk) {
      const raw   = rawMap.get(cardId);
      const psa9  = psa9Map.get(cardId);
      const psa10 = psa10Map.get(cardId);
      const validRaw   = raw?.success   && raw.price   > 0 ? raw   : null;
      const validPsa9  = psa9?.success  && psa9.price  > 0 ? psa9  : null;
      const validPsa10 = psa10?.success && psa10.price > 0 ? psa10 : null;
      if (!validRaw && !validPsa9 && !validPsa10) continue;

      const rawPrice  = validRaw?.price  ?? null;
      const midPrice  = validPsa9?.price ?? rawPrice ?? null;
      const highPrice = validPsa10?.price ?? null;
      const evMid  = midPrice ?? 0;
      const evLow  = rawPrice ?? Math.round(evMid * 0.35);
      const evHigh = highPrice ?? Math.round(evMid * 2.5);

      // Confidence: average across the grades that contributed real prices.
      // Falls to 0 only when all three were synthesized — but the early
      // continue above guarantees at least one is real.
      const contribs = [validRaw, validPsa9, validPsa10].filter((x): x is NonNullable<typeof x> => !!x);
      const confidence = contribs.length > 0
        ? contribs.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / contribs.length
        : 0;

      pricesOnly.set(cardId, {
        evLow: Math.round(evLow),
        evMid: Math.round(evMid),
        evHigh: Math.round(evHigh),
        confidence,
      });
      variantsNewlyFetched++;
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
    confidence: number | null;
    raw_comps: Record<string, unknown>;
    fetched_at: string;
    expires_at: string;
  };
  const cacheRows: CacheRow[] = [];

  // Incremental flush: every ~100 PPs we push the new tail of cacheRows to
  // pricing_cache. If the function dies, the rows we already pushed are safe.
  // The sync block (slice + cursor advance) runs to completion before any
  // await, so concurrent worker calls can't double-flush the same rows.
  const FLUSH_BATCH = 100;
  let flushedCount = 0;
  let cacheRowsWritten = 0;
  const UPSERT_CHUNK = 500;
  async function flushCacheRows(slice: CacheRow[]): Promise<void> {
    if (slice.length === 0) return;
    for (let i = 0; i < slice.length; i += UPSERT_CHUNK) {
      const sub = slice.slice(i, i + UPSERT_CHUNK);
      const { error: upErr } = await supabaseAdmin
        .from('pricing_cache')
        .upsert(sub, { onConflict: 'player_product_id' });
      if (upErr) {
        throw new Error(
          `[pricing-refresh] pricing_cache upsert failed at offset ${i}/${slice.length}: ` +
          `${upErr.message} (code=${upErr.code ?? 'unknown'})`,
        );
      }
      cacheRowsWritten += sub.length;
    }
  }
  async function maybeFlush(): Promise<void> {
    if (cacheRows.length - flushedCount < FLUSH_BATCH) return;
    const sliceStart = flushedCount;
    const sliceEnd = cacheRows.length;
    flushedCount = sliceEnd;  // synchronous advance — guards against double-flush
    await flushCacheRows(cacheRows.slice(sliceStart, sliceEnd));
  }

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
  let anchorFellBackCount = 0;
  let anchorMatchedSum = 0;
  let anchorAggregatedCount = 0;

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
      // Exclude 1/1s from per-player aggregation. A single 1/1 sale (e.g. a $2,200
      // SuperFractor) skews the slot-pricing average wildly because the variant has
      // no replacement in the pull pool. They still get priced and displayed at the
      // variant level via /api/pricing/comps; they just don't pollute slot math.
      const aggregatableVariants = variants.filter(v => v.print_run == null || v.print_run > 1);
      const variantEVs = aggregatableVariants.map(v => {
        const price = pricesOnly.get(v.cardhedger_card_id!);
        const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0) + (v.jumbo_sets ?? 0);
        return {
          variantId: v.id,
          variantName: v.variant_name,
          evLow: price?.evLow ?? 0,
          evMid: price?.evMid ?? 0,
          evHigh: price?.evHigh ?? 0,
          confidence: price?.confidence ?? 0,
          sets: Math.max(sets, 1),
          hobbyOdds: v.hobby_odds,
          printRun: v.print_run,
        };
      });

      const aggregated = aggregatePlayerEV(variantEVs, anchorStrategy, anchorPatterns);
      if (aggregated.evMid > 0) {
        if (aggregated.fellBack) anchorFellBackCount++;
        anchorMatchedSum += aggregated.matchedVariants;
        anchorAggregatedCount++;
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ...applyMultiplier(aggregated.evLow, aggregated.evMid, aggregated.evHigh),
          confidence: aggregated.confidence,
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        livePriced++;
        await maybeFlush();
        return;
      }

      // All variant prices came back 0 → Level 3 → Level 4 (skip Level 2 search)
      const siblingMap = await loadSiblingPricing();
      const sibling = siblingMap.get(pp.player_id);
      if (sibling && sibling.ev_mid > 0) {
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ...applyMultiplier(sibling.ev_low, sibling.ev_mid, sibling.ev_high),
          confidence: null,
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        crossPriced++;
        await maybeFlush();
        return;
      }

      const evMid = playerIsRookie ? 15 : 8;
      cacheRows.push({
        player_product_id: pp.id,
        cardhedger_card_id: pp.cardhedger_card_id ?? null,
        ...applyMultiplier(evMid * 0.35, evMid, evMid * 2.5),
        confidence: null,
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      defaultPriced++;
      await maybeFlush();
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
        ...applyMultiplier(ev.evLow, ev.evMid, ev.evHigh),
        confidence: null,
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      livePriced++;
      await maybeFlush();
      return;
    } catch { /* fall through */ }

    try {
      const cardType = playerIsRookie ? 'Auto RC' : 'Base';
      const raw = await get90DayPrices(`${playerName} ${cardType}`, 'Raw');
      if (raw && raw.avg_price > 0) {
        const evMid = Math.round(raw.avg_price);
        const evLow  = raw.min_price > 0 ? raw.min_price : evMid * 0.35;
        const evHigh = raw.max_price > evMid ? raw.max_price : evMid * 2.5;
        cacheRows.push({
          player_product_id: pp.id,
          cardhedger_card_id: pp.cardhedger_card_id ?? null,
          ...applyMultiplier(evLow, evMid, evHigh),
          confidence: null,
          raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
        });
        searchPriced++;
        await maybeFlush();
        return;
      }
    } catch { /* continue */ }

    const siblingMap = await loadSiblingPricing();
    const sibling = siblingMap.get(pp.player_id);
    if (sibling && sibling.ev_mid > 0) {
      cacheRows.push({
        player_product_id: pp.id,
        cardhedger_card_id: pp.cardhedger_card_id ?? null,
        ...applyMultiplier(sibling.ev_low, sibling.ev_mid, sibling.ev_high),
        confidence: null,
        raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
      });
      crossPriced++;
      await maybeFlush();
      return;
    }

    const evMid = playerIsRookie ? 15 : 8;
    cacheRows.push({
      player_product_id: pp.id,
      cardhedger_card_id: pp.cardhedger_card_id ?? null,
      ...applyMultiplier(evMid * 0.35, evMid, evMid * 2.5),
      confidence: null,
      raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
    });
    defaultPriced++;
    await maybeFlush();
  });

  // Final tail flush — anything pushed after the last maybeFlush() trigger.
  // flushCacheRows throws on upsert errors so silent NOT NULL violations
  // (which once hid 0-rows-written under "278 priced" for 48h) still surface.
  if (cacheRows.length > flushedCount) {
    await flushCacheRows(cacheRows.slice(flushedCount));
    flushedCount = cacheRows.length;
  }

  const totalDurationMs = Date.now() - started;
  const partial = batchTimedOut || hardDeadlineHit;
  const anchorMatchedAvg = anchorAggregatedCount > 0 ? anchorMatchedSum / anchorAggregatedCount : 0;
  console.log(
    `[pricing-refresh] product=${product?.name ?? productId} players=${playerProducts.length} ` +
    `live=${livePriced} cross=${crossPriced} search=${searchPriced} default=${defaultPriced} ` +
    `cache_written=${cacheRowsWritten} ` +
    `variants=${pricesOnly.size}/${allVariantCardIds.length} ` +
    `(cache=${variantsFromCache} new=${variantsNewlyFetched}) ` +
    `chunks=${chunksCompleted}/${priceChunks.length} batch=${batchDurationMs}ms ` +
    `anchor=${anchorStrategy}${anchorFellBackCount > 0 ? ` fellBack=${anchorFellBackCount}` : ''}` +
    ` matchedAvg=${anchorMatchedAvg.toFixed(1)} ` +
    `lifecycle=${lifecycleStatus} mult=${lifecycleMultiplier.toFixed(3)} ` +
    `total=${totalDurationMs}ms${partial ? ' PARTIAL' : ''}`,
  );

  return {
    productId,
    productName: product?.name ?? null,
    totalPlayers: playerProducts.length,
    livePriced, crossPriced, searchPriced, defaultPriced,
    variantsFetched: pricesOnly.size,
    variantsTotal: allVariantCardIds.length,
    variantsFromCache,
    variantsNewlyFetched,
    chunksWithCacheWrite,
    chunksAllGradesFailed,
    batchChunkCount: priceChunks.length,
    batchChunksCompleted: chunksCompleted,
    batchDurationMs,
    totalDurationMs,
    cacheRowsWritten,
    partial,
    anchorStrategy,
    anchorFellBackCount,
    anchorMatchedVariantsAvg: anchorMatchedAvg,
    lifecycleStatus,
    lifecycleMultiplier,
  };
}
