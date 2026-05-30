/**
 * lib/break-page-data.ts — server-side data fetcher for the break page.
 *
 * Consolidates everything `app/(consumer)/break/[slug]/page.tsx` previously
 * fetched in a client-side useEffect:
 *   - Product (by slug) + sport join
 *   - Pricing (via `lib/pricing-read.ts` shared cache)
 *   - Chase cards (with player_product + player nested)
 *   - Active risk flags (player_risk_flags WHERE cleared_at IS NULL)
 *   - Active hype_tag market_observations (product-scope + team + player + variant)
 *   - Active cascade observations (team_sentiment / product_sentiment /
 *     team_product_sentiment) — TWO queries because PostgREST can't OR a
 *     null-check across an enum filter cleanly
 *   - Active asking_price observations (product-scope)
 *
 * Then runs the augmentation logic that was previously inline in the page's
 * useEffect (risk-flag bucketing, hype/cascade observation collection,
 * per-player score adjustments). Returns one typed BreakPageData shape so
 * the server component can pass a single promise down to BreakPageClient
 * (via React 19's `use()` hook + Suspense).
 *
 * All reads use `supabaseAdmin` (service role) — bypasses RLS, faster than
 * anon-key reads. No user-scoped data here; product/pricing/observations
 * are public-within-the-app per the consumer flow.
 *
 * Cached via `unstable_cache` per productId with a 60s TTL and a per-product
 * tag — admin pricing-refresh / Discord apply actions can bust the cache
 * via `revalidateTag(`break-page-${productId}`)` if we wire that up later.
 */

import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from './supabase';
import { loadCached } from './pricing-read';
import { computeRiskAdjustment, computeHypeAdjustment, type HypeObservation } from './score-modulation';
import { computeProspectAdjustment } from './prospect-score';
import {
  computeCascadeAdjustment,
  filterObservationsForPlayer,
  type CascadeObservation,
} from './cascading-sentiment';
import type {
  AskingPriceObsRow,
  ChaseCard,
  HypeObsRow,
  PlayerRiskFlag,
  PlayerWithPricing,
  Product,
  Sport,
} from './types';

export type ProductWithSport = Product & { sport: Sport };

export interface BreakPageData {
  /** Augmented player roster with risk/hype/prospect/cascade adjustments
   *  precomputed. Engine math (computeSlotPricing) on the client just
   *  reads these values; no re-aggregation needed there. */
  rawPlayers: PlayerWithPricing[];
  /** Chase cards already populated with player_product + player nested. */
  chaseCards: ChaseCard[];
  /** player_product_id → array of active risk flags (flagType + note).
   *  Plain object so it serializes to the client; client wraps in Map. */
  riskFlagRecord: Record<string, Array<{ flagType: string; note: string }>>;
  /** Raw market_observations rows for chip rendering on the pre-release
   *  layout. The live-page engine already consumed these via the
   *  per-player adjustments above; these are passed through for UI use. */
  hypeObsRows: HypeObsRow[];
  askingPriceObsRows: AskingPriceObsRow[];
  /**
   * Per-variant hobby_odds bucketed by player_product_id. Used by the
   * PYP (Pick Your Player) prediction on the client — fed into
   * lib/player-pyp-pricing.ts alongside the user's break config. Loaded
   * here so the client doesn't have to make a second round trip; only
   * `hobby_odds` is selected since that's all the math needs. Stored as
   * a plain object so it serializes cleanly to the client (wraps in Map
   * on the other side).
   */
  variantsByPlayerProductId: Record<string, Array<{ hobby_odds: number | null }>>;
}

/**
 * Load the product matching `slug` (or null if not found). Separate from
 * loadBreakPageData so the server component can await this fast read first
 * (needed for hero header / banners) and pass the rest down as a promise.
 */
export async function loadProductBySlug(slug: string): Promise<ProductWithSport | null> {
  const { data } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('slug', slug)
    .maybeSingle();
  return (data as ProductWithSport | null) ?? null;
}

async function loadBreakPageDataRaw(product: ProductWithSport): Promise<BreakPageData> {
  const productId = product.id;
  const nowIso = new Date().toISOString();
  const sportSlug = (product.sport?.slug ?? '').toLowerCase();

  // Phase 1 — pricing + chase cards in parallel. Pricing comes from the
  // shared 30s cache; chase cards are a direct DB read.
  const [players, chaseRes] = await Promise.all([
    loadCached(productId),
    supabaseAdmin
      .from('product_chase_cards')
      .select('*, player_product:player_products(*, player:players(*))')
      .eq('product_id', productId)
      .order('display_order', { ascending: true }),
  ]);

  const chaseCards = (chaseRes.data ?? []) as ChaseCard[];

  // If there are no priced players, skip observation fetches — nothing to
  // attach them to. Render with empty maps.
  if (players.length === 0) {
    return {
      rawPlayers: players,
      chaseCards,
      riskFlagRecord: {},
      hypeObsRows: [],
      askingPriceObsRows: [],
      variantsByPlayerProductId: {},
    };
  }

  const ppIds = players.map(p => p.id);

  // Phase 2 — 6 parallel observation/variant fetches. Same five queries that
  // the page's useEffect was firing client-side, plus the variants fetch for
  // PYP. The variants query uses a product_id inner-join (not .in('pp', N))
  // so it sidesteps gotcha #11 (Kong's 200-UUID limit on .in() filters).
  const [flagsRes, hypeRes, cascadeProductRes, cascadeGlobalRes, askRes, variantsRes] = await Promise.all([
    supabaseAdmin
      .from('player_risk_flags')
      .select('player_product_id, flag_type, note')
      .in('player_product_id', ppIds)
      .is('cleared_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('scope_type, scope_id, scope_team, payload, observed_at, source_narrative')
      .eq('product_id', productId)
      .eq('observation_type', 'hype_tag')
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('observation_type, scope_team, product_id, payload, observed_at')
      .eq('product_id', productId)
      .in('observation_type', ['team_sentiment', 'product_sentiment', 'team_product_sentiment'])
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('observation_type, scope_team, product_id, payload, observed_at')
      .is('product_id', null)
      .eq('observation_type', 'team_sentiment')
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('scope_type, scope_id, scope_team, payload, observed_at, source_narrative')
      .eq('product_id', productId)
      .eq('observation_type', 'asking_price')
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    // Variant odds for PYP — only hobby_odds is needed (v1 PYP is hobby-only).
    // Inner-join filter avoids the 200-UUID Kong cap on .in() filters.
    supabaseAdmin
      .from('player_product_variants')
      .select('player_product_id, hobby_odds, player_products!inner(product_id)')
      .eq('player_products.product_id', productId),
  ]);

  // ─── Risk flags: bucket by player_product_id + compute per-pp adjustment ─
  const riskFlagRecord: Record<string, Array<{ flagType: string; note: string }>> = {};
  const riskAdjMap = new Map<string, number>();
  const flagsByPp = new Map<string, PlayerRiskFlag['flag_type'][]>();
  for (const f of (flagsRes.data ?? []) as Array<{ player_product_id: string; flag_type: string; note: string }>) {
    const arr = riskFlagRecord[f.player_product_id] ?? [];
    arr.push({ flagType: f.flag_type, note: f.note });
    riskFlagRecord[f.player_product_id] = arr;
    const types = flagsByPp.get(f.player_product_id) ?? [];
    types.push(f.flag_type as PlayerRiskFlag['flag_type']);
    flagsByPp.set(f.player_product_id, types);
  }
  for (const [ppId, types] of flagsByPp) {
    riskAdjMap.set(ppId, computeRiskAdjustment(types.map(t => ({ flag_type: t }))));
  }

  // ─── Hype observations: bucket by scope ─────────────────────────────────
  // scope_id is players.id (NOT player_product_id) when scope_type='player'.
  // scope_team is a string. scope_type='product' applies to every player
  // in the roster.
  const hypeObsRows = (hypeRes.data ?? []) as HypeObsRow[];
  const productScope: HypeObservation[] = [];
  const teamScope = new Map<string, HypeObservation[]>();
  const playerScope = new Map<string, HypeObservation[]>();
  for (const o of hypeObsRows) {
    const obs: HypeObservation = {
      tag: o.payload.tag,
      strength: o.payload.strength,
      decay_days: o.payload.decay_days,
      observed_at: o.observed_at,
    };
    if (o.scope_type === 'product') productScope.push(obs);
    else if (o.scope_type === 'team' && o.scope_team) {
      const arr = teamScope.get(o.scope_team) ?? [];
      arr.push(obs);
      teamScope.set(o.scope_team, arr);
    } else if (o.scope_type === 'player' && o.scope_id) {
      const arr = playerScope.get(o.scope_id) ?? [];
      arr.push(obs);
      playerScope.set(o.scope_id, arr);
    }
  }

  // ─── Cascade observations: union product-scope + global team_sentiment ──
  const cascadeAll: CascadeObservation[] = [
    ...((cascadeProductRes.data ?? []) as CascadeObservation[]),
    ...((cascadeGlobalRes.data ?? []) as CascadeObservation[]),
  ];

  // ─── Augment each player with the per-player score adjustments ─────────
  const rawPlayers: PlayerWithPricing[] = players.map(p => {
    const teamObs = teamScope.get(p.player?.team ?? '') ?? [];
    const playerObs = playerScope.get(p.player_id) ?? [];
    const all = [...productScope, ...teamObs, ...playerObs];
    const cascadeForPlayer = filterObservationsForPlayer(cascadeAll, p.player?.team);
    const cascade = computeCascadeAdjustment({
      observations: cascadeForPlayer,
      sportSlug,
    });
    return {
      ...p,
      risk_score_adj: riskAdjMap.get(p.id) ?? 0,
      hype_score_adj: computeHypeAdjustment(all),
      prospect_score_adj: computeProspectAdjustment({
        prospect_rank: p.player?.prospect_rank,
        prospect_status: p.player?.prospect_status,
        sportSlug,
      }),
      cascade_score_adj: cascade.adjustment,
    };
  });

  // ─── Variants: bucket by player_product_id (hobby_odds only) ────────────
  const variantsByPlayerProductId: Record<string, Array<{ hobby_odds: number | null }>> = {};
  for (const v of (variantsRes.data ?? []) as Array<{ player_product_id: string; hobby_odds: number | null }>) {
    const arr = variantsByPlayerProductId[v.player_product_id] ?? [];
    arr.push({ hobby_odds: v.hobby_odds });
    variantsByPlayerProductId[v.player_product_id] = arr;
  }

  return {
    rawPlayers,
    chaseCards,
    riskFlagRecord,
    hypeObsRows,
    askingPriceObsRows: (askRes.data ?? []) as AskingPriceObsRow[],
    variantsByPlayerProductId,
  };
}

/**
 * Load the full break-page data bundle for a given product, cached for 60s
 * per productId. Returns a Promise that resolves to BreakPageData. Server
 * components can either await this (blocking) or pass the promise down to
 * a client component for Suspense streaming.
 *
 * Cache key: ['break-page-data', productId]
 * Tag:       `break-page-{productId}` (for future revalidateTag hooks)
 */
export async function loadBreakPageData(product: ProductWithSport): Promise<BreakPageData> {
  return unstable_cache(
    () => loadBreakPageDataRaw(product),
    ['break-page-data', product.id],
    { revalidate: 60, tags: [`break-page-${product.id}`] },
  )();
}
