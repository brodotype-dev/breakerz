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

  // Resilient: a single product's rollup failing shouldn't 500 the whole
  // dashboard (it did when the per-product fan-out timed out — 57014). Drop
  // failures and keep the rest.
  const settled = await Promise.allSettled(
    products.map(p =>
      buildOneRow(p.id, p.name, (p.lifecycle_status ?? 'live') as CHCoverageRow['lifecycleStatus']),
    ),
  );
  const rows: CHCoverageRow[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') rows.push(s.value);
    else console.error('[ch-coverage] buildOneRow failed:', s.reason);
  }
  return rows;
}

async function buildOneRow(
  productId: string,
  productName: string,
  lifecycleStatus: CHCoverageRow['lifecycleStatus'],
): Promise<CHCoverageRow> {
  // Single SQL aggregate via get_ch_coverage(). Replaces the old per-product
  // fan-out (distinct-card scan + chunked ch_price_cache loop + pricing_cache
  // fetch) that timed out (57014) once re-matching grew the card sets. See
  // migration 20260604140000_ch_coverage_rpc.sql.
  const freshCutoff = new Date(Date.now() - STALE_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabaseAdmin.rpc('get_ch_coverage', {
    p_product_id: productId,
    p_cutoff: freshCutoff,
  });
  if (error) throw error;

  const r = (Array.isArray(data) ? data[0] : data) as {
    distinct_card_ids: number; cached_total: number; cards_with_prices: number;
    cards_all_null: number; cached_fresh: number; cached_stale: number;
    pp_total: number; pp_priced: number; pc_fresh: number; pc_stale: number;
    conf_sum: number; conf_count: number; last_priced: string | null;
  } | undefined;

  const num = (v: unknown) => Number(v ?? 0);
  const distinctCardIds = num(r?.distinct_card_ids);
  const cachedTotal = num(r?.cached_total);
  const confCount = num(r?.conf_count);

  return {
    productId,
    productName,
    lifecycleStatus,
    distinctCardIds,
    cachedTotal,
    cardsWithPrices: num(r?.cards_with_prices),
    cardsAllNull: num(r?.cards_all_null),
    cardsNeverFetched: distinctCardIds - cachedTotal,
    cachedFresh: num(r?.cached_fresh),
    cachedStale: num(r?.cached_stale),
    playerProductsTotal: num(r?.pp_total),
    playerProductsPriced: num(r?.pp_priced),
    pricingCacheFresh: num(r?.pc_fresh),
    pricingCacheStale: num(r?.pc_stale),
    avgConfidence: confCount > 0 ? num(r?.conf_sum) / confCount : null,
    lastPriced: r?.last_priced ?? null,
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

// ── CardHedger additions feed (River's release-calendar proxy) ──────────────
// Reads the `ch_additions` snapshot (nightly cron) and flags additions to sets
// we already track — i.e. "CH added cards to a set you depend on → re-match it."
export type CHAdditionView = {
  added_date: string;
  category: string;
  set_name: string;
  subset: string;
  variants: string;
  card_count: number;
  tracked: boolean;
};

export type CHAdditionsSummary = {
  rows: CHAdditionView[];
  totalCards: number;
  trackedCards: number;
  trackedSets: string[];
  lastFetchedAt: string | null;
  daysCovered: number;
};

export async function getRecentCHAdditions(days = 14): Promise<CHAdditionsSummary> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString().slice(0, 10);

  const [addRes, prodRes] = await Promise.all([
    supabaseAdmin
      .from('ch_additions')
      .select('added_date, category, set_name, subset, variants, card_count, fetched_at')
      .gte('added_date', sinceIso)
      .order('added_date', { ascending: false })
      .order('card_count', { ascending: false }),
    supabaseAdmin
      .from('products')
      .select('ch_set_name')
      .eq('is_active', true)
      .not('ch_set_name', 'is', null),
  ]);

  const trackedSetNames = new Set(
    (prodRes.data ?? [])
      .map(p => (p.ch_set_name as string | null)?.toLowerCase().trim())
      .filter((s): s is string => !!s),
  );

  const raw = (addRes.data ?? []) as Array<{
    added_date: string; category: string; set_name: string; subset: string;
    variants: string; card_count: number; fetched_at: string;
  }>;

  const rows: CHAdditionView[] = raw.map(r => ({
    added_date: r.added_date,
    category: r.category,
    set_name: r.set_name,
    subset: r.subset,
    variants: r.variants,
    card_count: r.card_count,
    tracked: trackedSetNames.has((r.set_name ?? '').toLowerCase().trim()),
  }));

  const trackedRows = rows.filter(r => r.tracked);
  return {
    rows,
    totalCards: rows.reduce((s, r) => s + r.card_count, 0),
    trackedCards: trackedRows.reduce((s, r) => s + r.card_count, 0),
    trackedSets: [...new Set(trackedRows.map(r => r.set_name))],
    lastFetchedAt: raw[0]?.fetched_at ?? null,
    daysCovered: days,
  };
}
