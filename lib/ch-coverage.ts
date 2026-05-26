// CardHedger data-health helpers.
//
// One row per product summarizing how much CH actually knows about the
// cards we depend on. Surfaces the same kind of signals the 2026-05-20
// `ch_price_cache` null-overwrite incident and the 2026-05-25 Kong-cap
// + all-null-refetch issues exposed — except now they're a single glance
// instead of a forensic side-experiment.
//
// All counts scoped to the cards in OUR product's player_product_variants
// (matched cardhedger_card_id only), not the full `ch_set_cache`. That
// way the coverage % reflects "how much of what WE care about does CH
// have data for" — independent of catalog rows for cards we don't track.

import { supabaseAdmin } from '@/lib/supabase';
import { getCardsBySet } from '@/lib/cardhedger';

export type CHCoverageRow = {
  productId: string;
  productName: string;
  lifecycleStatus: 'pre_release' | 'live' | 'dormant';

  // Total distinct cardhedger_card_ids referenced by this product's
  // matched variants. Denominator for the per-CH-card stats below.
  distinctCardIds: number;

  // ch_price_cache rows for this product's card_ids, regardless of
  // freshness. Cards never fetched (NEVER in ch_price_cache) = the
  // unknown frontier; subtract from distinctCardIds to size it.
  cachedTotal: number;

  // ch_price_cache rows with at least one non-null grade price. The
  // "CH has SOMETHING for this card" signal — direct sales or
  // model-fallback (we can't distinguish without method column).
  cardsWithPrices: number;

  // ch_price_cache rows where all three grade prices are null. CH was
  // asked but had nothing. Stable over the 24h freshness window; we
  // skip refetching these per PR #136.
  cardsAllNull: number;

  // Cards never fetched = distinctCardIds - cachedTotal. The unknown
  // tail — first refresh fills this.
  cardsNeverFetched: number;

  // Freshness of the rows that ARE cached. Fresh = fetched in the
  // last 24h; stale = older. Stale is the cron's job to fix.
  cachedFresh: number;
  cachedStale: number;

  // Per-product pricing_cache (the consumer-facing slot-price table).
  // Tells us "have we actually delivered prices to consumers", which
  // is a step downstream from ch_price_cache.
  playerProductsTotal: number;     // total auto-eligible player_products
  playerProductsPriced: number;    // pricing_cache rows present
  pricingCacheFresh: number;       // pricing_cache fetched_at < 24h ago
  pricingCacheStale: number;       // pricing_cache fetched_at >= 24h ago

  // Mean of pricing_cache.confidence across this product's player_products.
  // Null when nothing's priced yet. Sales-weighted by CH inside batch-
  // price-estimate; we just average across the players.
  avgConfidence: number | null;

  // Most recent pricing_cache.fetched_at — "when did consumers last
  // see a fresh slot price for this product."
  lastPriced: string | null;
};

const STALE_HOURS = 24;

export async function getCHCoverageForActiveProducts(): Promise<CHCoverageRow[]> {
  // Scope to active products only. Pre-release products are included
  // because the dashboard is useful for spotting "we set ch_set_name
  // but CH has no catalog yet" gaps before launch.
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id, name, lifecycle_status')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  if (!products?.length) return [];

  const rows = await Promise.all(
    products.map(p =>
      buildOneRow(p.id, p.name, (p.lifecycle_status ?? 'live') as CHCoverageRow['lifecycleStatus']),
    ),
  );
  return rows;
}

async function buildOneRow(
  productId: string,
  productName: string,
  lifecycleStatus: CHCoverageRow['lifecycleStatus'],
): Promise<CHCoverageRow> {
  // 1. Pull the distinct cardhedger_card_ids this product cares about.
  //    Pagination via supabase's range — over-1000 products exist
  //    (Topps Chrome BB has ~30K distinct card_ids).
  const cardIds = await listDistinctMatchedCardIds(productId);
  const distinctCardIds = cardIds.length;

  // 2. ch_price_cache rollup for those card_ids. Chunk the .in() by
  //    200 UUIDs — Kong URL cap (CLAUDE.md gotcha #11). For huge
  //    products we issue ~150 queries; each is a small count, runs
  //    serially to keep memory low.
  let cachedTotal = 0;
  let cardsWithPrices = 0;
  let cardsAllNull = 0;
  let cachedFresh = 0;
  let cachedStale = 0;
  const freshCutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();

  const IN_CHUNK = 200;
  for (let i = 0; i < cardIds.length; i += IN_CHUNK) {
    const slice = cardIds.slice(i, i + IN_CHUNK);
    const { data, error: chErr } = await supabaseAdmin
      .from('ch_price_cache')
      .select('raw_price, psa9_price, psa10_price, fetched_at')
      .in('cardhedger_card_id', slice);
    if (chErr) throw chErr;
    for (const r of (data ?? []) as Array<{
      raw_price: number | null;
      psa9_price: number | null;
      psa10_price: number | null;
      fetched_at: string;
    }>) {
      cachedTotal++;
      const hasPrice = r.raw_price != null || r.psa9_price != null || r.psa10_price != null;
      if (hasPrice) cardsWithPrices++;
      else cardsAllNull++;
      if (r.fetched_at >= freshCutoff) cachedFresh++;
      else cachedStale++;
    }
  }
  const cardsNeverFetched = distinctCardIds - cachedTotal;

  // 3. pricing_cache rollup: how many of this product's player_products
  //    are priced, freshness split, avg confidence, last fetched_at.
  const { count: ppTotalCount } = await supabaseAdmin
    .from('player_products')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('insert_only', false);
  const playerProductsTotal = ppTotalCount ?? 0;

  // pricing_cache joined to player_products by product_id. Pull
  // confidence + fetched_at for in-process aggregation — count helpers
  // can't give us the freshness split + avg in one query.
  const { data: pcRows, error: pcErr } = await supabaseAdmin
    .from('pricing_cache')
    .select('confidence, fetched_at, player_products!inner(product_id)')
    .eq('player_products.product_id', productId);
  if (pcErr) throw pcErr;

  let playerProductsPriced = 0;
  let pricingCacheFresh = 0;
  let pricingCacheStale = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let lastPriced: string | null = null;
  for (const r of (pcRows ?? []) as Array<{ confidence: number | null; fetched_at: string }>) {
    playerProductsPriced++;
    if (r.fetched_at >= freshCutoff) pricingCacheFresh++;
    else pricingCacheStale++;
    if (r.confidence != null) {
      confidenceSum += r.confidence;
      confidenceCount++;
    }
    if (!lastPriced || r.fetched_at > lastPriced) lastPriced = r.fetched_at;
  }
  const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;

  return {
    productId,
    productName,
    lifecycleStatus,
    distinctCardIds,
    cachedTotal,
    cardsWithPrices,
    cardsAllNull,
    cardsNeverFetched,
    cachedFresh,
    cachedStale,
    playerProductsTotal,
    playerProductsPriced,
    pricingCacheFresh,
    pricingCacheStale,
    avgConfidence,
    lastPriced,
  };
}

// One-shot live-CH probe for a single product. Hits CH's card-search
// endpoint with `set=<ch_set_name>` page_size=1 — the response includes
// a `count` field with the total number of cards CH knows about in
// that set, which we compare to our `ch_set_cache` row count.
//
// Cheap (1 small CH call), but live — so this is a button-triggered
// action, not a per-page-load query. Answers "what does CH actually
// see for this product right now," independent of our cache state.
//
// Detects:
//   - CH added new cards we haven't ingested yet (cardsDelta > 0)
//   - CH renamed or restructured the set (chCount === 0 && ourCount > 0)
//   - Our ch_set_name is wrong / typo / stale (chCount === 0 across the
//     board, or chCount matches a different magnitude than our catalog)
//   - CH is unreachable (throws, caller renders error)
export type CHProbeResult = {
  productId: string;
  productName: string;
  chSetName: string | null;
  chCount: number;         // CH's view (response.count)
  ourCount: number;        // ch_set_cache rows for this set name
  cardsDelta: number;      // chCount - ourCount (positive = CH grew)
  probedAt: string;        // ISO timestamp
};

export async function probeCHForProduct(productId: string): Promise<CHProbeResult> {
  const { data: product, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('id, name, ch_set_name')
    .eq('id', productId)
    .maybeSingle();
  if (prodErr) throw prodErr;
  if (!product) throw new Error('Product not found');
  if (!product.ch_set_name) {
    throw new Error('Product has no ch_set_name — set one via Find on CH before probing.');
  }

  // CH's count is the authoritative ground truth. page_size=1 keeps the
  // response payload tiny (we only care about the `count` field).
  const chResponse = await getCardsBySet(product.ch_set_name, 1, 1, { timeoutMs: 15_000 });
  const chCount = (chResponse as { count?: number }).count ?? 0;

  // Our mirror — count rows in ch_set_cache matching this set name.
  const { count: ourCount, error: cacheErr } = await supabaseAdmin
    .from('ch_set_cache')
    .select('cardhedger_card_id', { count: 'exact', head: true })
    .eq('ch_set_name', product.ch_set_name);
  if (cacheErr) throw cacheErr;

  return {
    productId,
    productName: product.name,
    chSetName: product.ch_set_name,
    chCount,
    ourCount: ourCount ?? 0,
    cardsDelta: chCount - (ourCount ?? 0),
    probedAt: new Date().toISOString(),
  };
}

// Paginate distinct cardhedger_card_ids for a product. PostgREST caps
// any single response at 1000 rows; for big products we page until done
// and dedupe in-process.
async function listDistinctMatchedCardIds(productId: string): Promise<string[]> {
  const PAGE = 1000;
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('player_product_variants')
      .select('cardhedger_card_id, player_products!inner(product_id)')
      .eq('player_products.product_id', productId)
      .not('cardhedger_card_id', 'is', null)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ cardhedger_card_id: string | null }>) {
      if (r.cardhedger_card_id) seen.add(r.cardhedger_card_id);
    }
    if (data.length < PAGE) break;
  }
  return Array.from(seen);
}
