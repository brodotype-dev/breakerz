// Server-side per-team fair-value rollup for admin surfaces.
//
// Step #3 slice B — Market Delta Watch captures panel computes per-row
// delta vs. our model. Needs to answer "for product P, team T, what would
// our model price a slot at?" without re-running CardHedger.
//
// Strategy: read pricing_cache directly, build PlayerWithPricing-shaped
// rows, run the existing computeSlotPricing + computeTeamSlotPricing
// helpers from lib/engine.ts so the math matches /break/[slug] exactly.
//
// Reference config: 1 case of each format the product publishes. The
// per-team slot cost scales linearly with case count × case cost, so
// 1-case-equivalent is the natural unit for comparing to a per-slot
// observation that doesn't carry case-count metadata.

import { supabaseAdmin } from '@/lib/supabase';
import { computeSlotPricing, computeTeamSlotPricing, type SlotPricingMode } from '@/lib/engine';
import { getMarketMarkup } from '@/lib/market-markup';
import type { BreakConfig, PlayerWithPricing, ProductLifecycle } from '@/lib/types';

export interface TeamFairValue {
  hobby: number;     // pure-model per-team slot @ 1 hobby case
  bd: number;        // pure-model per-team slot @ 1 bd case
  jumbo: number;     // pure-model per-team slot @ 1 jumbo case
  marketHobby: number; // hobby × lifecycle markup (matches consumer-page display)
  marketBd: number;
  marketJumbo: number;
}

export interface ProductFairValueSnapshot {
  productId: string;
  lifecycle: ProductLifecycle;
  marketMarkup: number;
  teams: Map<string, TeamFairValue>;
}

const EMPTY: ProductFairValueSnapshot = {
  productId: '',
  lifecycle: 'live',
  marketMarkup: 1,
  teams: new Map(),
};

export async function getTeamFairValuesForProduct(
  productId: string,
  mode: SlotPricingMode = 'case_cost_share',
): Promise<ProductFairValueSnapshot> {
  if (!productId) return EMPTY;

  const { data: prod } = await supabaseAdmin
    .from('products')
    .select('id, lifecycle_status, hobby_case_cost, bd_case_cost, jumbo_case_cost, hobby_am_case_cost, bd_am_case_cost, jumbo_am_case_cost, hobby_autos_per_case')
    .eq('id', productId)
    .single();
  if (!prod) return EMPTY;

  // Match /break/[slug]: prefer AM (after-market) price when admin has
  // overridden, else fall back to MSRP. Mirrors `page.tsx` lines 134-138.
  const hobbyCaseCost = prod.hobby_am_case_cost ?? prod.hobby_case_cost ?? 0;
  const bdCaseCost    = prod.bd_am_case_cost    ?? prod.bd_case_cost    ?? 0;
  const jumboCaseCost = prod.jumbo_am_case_cost ?? prod.jumbo_case_cost ?? 0;

  const { data: pps } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility, c_score')
    .eq('product_id', productId)
    .eq('insert_only', false);
  if (!pps?.length) return { productId, lifecycle: prod.lifecycle_status, marketMarkup: 1, teams: new Map() };

  const ids = pps.map(p => p.id);
  const cached: { player_product_id: string; ev_low: number; ev_mid: number; ev_high: number; confidence: number | null }[] = [];
  const IN_CHUNK = 200;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data } = await supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, ev_low, ev_mid, ev_high, confidence')
      .in('player_product_id', slice)
      .gt('expires_at', new Date().toISOString());
    if (data) cached.push(...data);
  }
  const cacheMap = new Map(cached.map(c => [c.player_product_id, c]));

  // Build the minimal PlayerWithPricing shape the engine needs. Score
  // adjustments (risk/hype/prospect/cascade) default to zero for the admin
  // snapshot — we're approximating the consumer page's "fresh load with
  // no live-fetched observations" state. Acceptable for delta context;
  // not a replacement for the consumer page itself.
  const players: PlayerWithPricing[] = pps.map(pp => {
    const c = cacheMap.get(pp.id);
    const evMid = c?.ev_mid ?? 0;
    return {
      ...pp,
      evLow: c?.ev_low ?? 0,
      evMid,
      evHigh: c?.ev_high ?? 0,
      hobbyEVPerBox: evMid,
      hobbyWeight: 0, bdWeight: 0, jumboWeight: 0,
      hobbySlotCost: 0, bdSlotCost: 0, jumboSlotCost: 0,
      totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, jumboPerCase: 0,
      maxPay: 0,
      pricingSource: c ? 'cached' : 'none',
      confidence: c?.confidence ?? null,
      risk_score_adj: 0,
      hype_score_adj: 0,
      prospect_score_adj: 0,
      cascade_score_adj: 0,
    } as PlayerWithPricing;
  });

  // 1-case-of-each reference config. The per-team slot scales linearly
  // with `cases × caseCost`, so 1 case is the cleanest unit. Multiply at
  // the call site if a different case count is desired.
  const config: BreakConfig = {
    hobbyCases: hobbyCaseCost > 0 ? 1 : 0,
    bdCases:    bdCaseCost    > 0 ? 1 : 0,
    jumboCases: jumboCaseCost > 0 ? 1 : 0,
    hobbyCaseCost,
    bdCaseCost,
    jumboCaseCost,
  };

  // Load per-variant hobby_odds for fair_value_ev mode. Sidesteps Kong's
  // 200-UUID .in() cap by inner-joining on product_id (gotcha #11). When
  // mode === 'case_cost_share' we skip the fetch entirely — pure-EV math
  // doesn't need it.
  let variantsForPyt: Map<string, Array<{ hobby_odds: number | null }>> | undefined;
  if (mode === 'fair_value_ev') {
    const { data: vs } = await supabaseAdmin
      .from('player_product_variants')
      .select('player_product_id, hobby_odds, player_products!inner(product_id)')
      .eq('player_products.product_id', productId);
    variantsForPyt = new Map();
    for (const v of (vs ?? []) as Array<{ player_product_id: string; hobby_odds: number | null }>) {
      const arr = variantsForPyt.get(v.player_product_id) ?? [];
      arr.push({ hobby_odds: v.hobby_odds });
      variantsForPyt.set(v.player_product_id, arr);
    }
  }

  const priced = computeSlotPricing(
    players,
    config,
    mode,
    variantsForPyt,
    mode === 'fair_value_ev' ? (prod.hobby_autos_per_case ?? null) : null,
  );
  const teamSlots = computeTeamSlotPricing(priced, config);
  const lifecycle = prod.lifecycle_status as ProductLifecycle;
  const marketMarkup = getMarketMarkup(lifecycle);

  const teams = new Map<string, TeamFairValue>();
  for (const t of teamSlots) {
    teams.set(t.team, {
      hobby: t.hobbySlotCost,
      bd: t.bdSlotCost,
      jumbo: t.jumboSlotCost,
      marketHobby: t.hobbySlotCost * marketMarkup,
      marketBd: t.bdSlotCost * marketMarkup,
      marketJumbo: t.jumboSlotCost * marketMarkup,
    });
  }

  return { productId, lifecycle, marketMarkup, teams };
}

/**
 * Batched lookup — fetches per-team fair values for a list of distinct
 * product IDs in parallel. Used by the Market Delta Watch captures panel
 * to avoid one query per row when many captures hit the same product.
 */
export async function getTeamFairValuesForProducts(
  productIds: string[],
  mode: SlotPricingMode = 'case_cost_share',
): Promise<Map<string, ProductFairValueSnapshot>> {
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  const snapshots = await Promise.all(unique.map(id => getTeamFairValuesForProduct(id, mode)));
  const out = new Map<string, ProductFairValueSnapshot>();
  for (const s of snapshots) {
    if (s.productId) out.set(s.productId, s);
  }
  return out;
}
