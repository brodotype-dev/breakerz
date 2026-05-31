// Server-side per-player PYP fair value for admin surfaces.
//
// Mirror of lib/team-fair-value.ts, but for player-scope /break-price
// captures (someone asked $X to pre-pick a single player). Runs the same
// computePlayerPyp model the consumer break page uses, at a 1-hobby-case
// reference, so the admin Market Delta panel can show Δ vs model + a
// reasonable-margin band zone for player-scoped asks.
//
// Keyed by player_id (NOT player_product_id) because market_observations
// store scope_id = players.id for player-scope captures.
//
// Approximation, same as the team helper: score adjustments default to 0
// (no live risk/hype/prospect/cascade load), and hobbyEVPerBox falls back
// to evMid. Good enough for delta context; the consumer page is the source
// of truth for the real per-player number.

import { supabaseAdmin } from '@/lib/supabase';
import { computePlayerPyp, type PlayerPypResult } from '@/lib/player-pyp-pricing';
import type { BreakConfig, PlayerWithPricing, ProductLifecycle } from '@/lib/types';

export interface ProductPlayerPypSnapshot {
  productId: string;
  lifecycle: ProductLifecycle;
  oddsCoverageOk: boolean;
  /** player_id → PYP result (pypPure / pypMarket / expectedHits / pZeroHits). */
  players: Map<string, PlayerPypResult>;
}

const EMPTY: ProductPlayerPypSnapshot = {
  productId: '',
  lifecycle: 'live',
  oddsCoverageOk: false,
  players: new Map(),
};

export async function getPlayerPypForProduct(productId: string): Promise<ProductPlayerPypSnapshot> {
  if (!productId) return EMPTY;

  const { data: prod } = await supabaseAdmin
    .from('products')
    .select('id, lifecycle_status, hobby_case_cost, hobby_am_case_cost, hobby_autos_per_case')
    .eq('id', productId)
    .single();
  if (!prod) return EMPTY;

  const { data: pps } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*), buzz_score, breakerz_score, is_high_volatility')
    .eq('product_id', productId)
    .eq('insert_only', false);
  if (!pps?.length) {
    return { productId, lifecycle: prod.lifecycle_status, oddsCoverageOk: false, players: new Map() };
  }

  const ids = pps.map(p => p.id);
  const cached: { player_product_id: string; ev_mid: number }[] = [];
  const IN_CHUNK = 200;
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data } = await supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, ev_mid')
      .in('player_product_id', ids.slice(i, i + IN_CHUNK))
      .gt('expires_at', new Date().toISOString());
    if (data) cached.push(...data);
  }
  const cacheMap = new Map(cached.map(c => [c.player_product_id, c]));

  // Variants for pull rates — inner-join on product_id to skip the 200-UUID
  // .in() cap (gotcha #11).
  const { data: vs } = await supabaseAdmin
    .from('player_product_variants')
    .select('player_product_id, hobby_odds, player_products!inner(product_id)')
    .eq('player_products.product_id', productId);
  const variantsByPp = new Map<string, Array<{ hobby_odds: number | null }>>();
  for (const v of (vs ?? []) as Array<{ player_product_id: string; hobby_odds: number | null }>) {
    const arr = variantsByPp.get(v.player_product_id) ?? [];
    arr.push({ hobby_odds: v.hobby_odds });
    variantsByPp.set(v.player_product_id, arr);
  }

  const players: PlayerWithPricing[] = pps.map(pp => {
    const evMid = cacheMap.get(pp.id)?.ev_mid ?? 0;
    return {
      ...pp,
      evLow: 0, evMid, evHigh: 0,
      hobbyEVPerBox: evMid,
      hobbyWeight: 0, bdWeight: 0, jumboWeight: 0,
      hobbySlotCost: 0, bdSlotCost: 0, jumboSlotCost: 0,
      totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, jumboPerCase: 0,
      maxPay: 0, pricingSource: evMid > 0 ? 'cached' : 'none',
      risk_score_adj: 0, hype_score_adj: 0, prospect_score_adj: 0, cascade_score_adj: 0,
    } as PlayerWithPricing;
  });

  const lifecycle = prod.lifecycle_status as ProductLifecycle;
  const config: BreakConfig = {
    hobbyCases: 1, bdCases: 0, jumboCases: 0,
    hobbyCaseCost: prod.hobby_am_case_cost ?? prod.hobby_case_cost ?? 0,
    bdCaseCost: 0, jumboCaseCost: 0,
  };

  const pyp = computePlayerPyp(players, variantsByPp, config, prod.hobby_autos_per_case ?? null, lifecycle);

  // Re-key from player_product_id → player_id for capture lookups.
  const ppToPlayerId = new Map(pps.map(p => [p.id, (p.player as { id: string } | null)?.id ?? '']));
  const byPlayerId = new Map<string, PlayerPypResult>();
  for (const [ppId, res] of pyp.byPlayerProductId) {
    const playerId = ppToPlayerId.get(ppId);
    if (playerId) byPlayerId.set(playerId, res);
  }

  return { productId, lifecycle, oddsCoverageOk: pyp.oddsCoverageOk, players: byPlayerId };
}

export async function getPlayerPypForProducts(
  productIds: string[],
): Promise<Map<string, ProductPlayerPypSnapshot>> {
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  const snapshots = await Promise.all(unique.map(id => getPlayerPypForProduct(id)));
  const out = new Map<string, ProductPlayerPypSnapshot>();
  for (const s of snapshots) {
    if (s.productId) out.set(s.productId, s);
  }
  return out;
}
