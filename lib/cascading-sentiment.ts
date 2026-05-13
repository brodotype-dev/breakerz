/**
 * Track B (Phase 2) — Cascading sentiment reader.
 *
 * Reads active observations of three new market_observations types — team_sentiment,
 * product_sentiment, team_product_sentiment — and computes a per-player_product
 * adjustment that folds into effectiveScore alongside risk + hype + prospect.
 *
 * Each scope contributes within its own cap; the three scope caps sum into a
 * combined cap; the combined value is multiplied by a per-sport throttle.
 * Math mirrors lib/score-modulation.ts's hype path (direction × strength ×
 * SCOPE_CAP × linear decay) so per-observation contributions are bounded and
 * decay predictably.
 *
 * See docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.
 */

import { supabaseAdmin } from './supabase';

// Plan-mandated per-scope caps. Specificity earns more weight: the team×product
// intersection beats team-only beats product-only.
export const CASCADE_SCOPE_CAPS = {
  team_product_sentiment: 0.25,
  team_sentiment:         0.20,
  product_sentiment:      0.15,
} as const;

// Hard ceiling on the cascade contribution from all three scopes combined,
// so prospect_score + cascade_score can't break past the engine's +1.0 clamp
// even when both are saturated.
export const CASCADE_COMBINED_CAP = 0.65;

// Same throttle shape as lib/prospect-score.ts. The cascade reader doesn't
// need to know about per-sport prospect-rank reliability — but per-sport
// trust in Discord chatter follows the same rough ordering, and using a
// single multiplier keeps the engine math interpretable.
export const SPORT_CASCADE_MULTIPLIER: Record<string, number> = {
  baseball:   1.0,
  basketball: 0.9,
  football:   0.7,
  hockey:     0.6,
};

export type CascadeObservationType =
  | 'team_sentiment'
  | 'product_sentiment'
  | 'team_product_sentiment';

export interface CascadeObservation {
  observation_type: CascadeObservationType;
  scope_team: string | null;
  product_id: string | null;
  payload: {
    direction: 1 | -1;
    strength: number;       // 0..1
    decay_days: number;     // 1..60
    tag?: string;
  };
  observed_at: string;
}

interface ScopeBreakdownRow {
  scope: CascadeObservationType;
  contribution: number;
  scope_team: string | null;
  observed_at: string;
  decay_days: number;
  tag?: string;
}

export interface CascadeBreakdown {
  team_sentiment: number;
  product_sentiment: number;
  team_product_sentiment: number;
  combined: number;
  sportMultiplier: number;
  // Final per-pp adjustment after combined-cap clamp and sport multiplier.
  adjustment: number;
  rows: ScopeBreakdownRow[];
}

function linearDecay(observedAtIso: string, decayDays: number, now: Date): number {
  const observedMs = new Date(observedAtIso).getTime();
  if (Number.isNaN(observedMs)) return 0;
  const daysSince = Math.max(0, (now.getTime() - observedMs) / (1000 * 60 * 60 * 24));
  const days = Math.max(1, decayDays);
  return Math.max(0, 1 - daysSince / days);
}

function contribution(o: CascadeObservation, scopeCap: number, now: Date): number {
  const direction = o.payload.direction === -1 ? -1 : o.payload.direction === 1 ? 1 : 0;
  if (!direction) return 0;
  const strength = Math.max(0, Math.min(1, Number(o.payload.strength) || 0));
  if (strength === 0) return 0;
  const decay = linearDecay(o.observed_at, Number(o.payload.decay_days) || 14, now);
  if (decay === 0) return 0;
  return direction * strength * scopeCap * decay;
}

function clampScope(sum: number, scopeCap: number): number {
  return Math.max(-scopeCap, Math.min(scopeCap, sum));
}

/**
 * Compute the cascade adjustment for one player_product given pre-filtered
 * observations for its (team, product). Caller is responsible for splitting
 * the observation set per team — we just sum and cap.
 */
export function computeCascadeAdjustment(input: {
  observations: CascadeObservation[];
  sportSlug: string | null | undefined;
  now?: Date;
}): CascadeBreakdown {
  const now = input.now ?? new Date();
  const rows: ScopeBreakdownRow[] = [];

  let team = 0;
  let product = 0;
  let teamProduct = 0;

  for (const o of input.observations) {
    const cap = CASCADE_SCOPE_CAPS[o.observation_type];
    if (!cap) continue;
    const c = contribution(o, cap, now);
    if (c === 0) continue;
    rows.push({
      scope: o.observation_type,
      contribution: c,
      scope_team: o.scope_team,
      observed_at: o.observed_at,
      decay_days: o.payload.decay_days,
      tag: o.payload.tag,
    });
    if (o.observation_type === 'team_sentiment') team += c;
    else if (o.observation_type === 'product_sentiment') product += c;
    else if (o.observation_type === 'team_product_sentiment') teamProduct += c;
  }

  const teamCapped = clampScope(team, CASCADE_SCOPE_CAPS.team_sentiment);
  const productCapped = clampScope(product, CASCADE_SCOPE_CAPS.product_sentiment);
  const teamProductCapped = clampScope(teamProduct, CASCADE_SCOPE_CAPS.team_product_sentiment);

  const combinedRaw = teamCapped + productCapped + teamProductCapped;
  const combined = Math.max(-CASCADE_COMBINED_CAP, Math.min(CASCADE_COMBINED_CAP, combinedRaw));

  const sportMul =
    SPORT_CASCADE_MULTIPLIER[(input.sportSlug ?? '').toLowerCase()] ?? 0;

  return {
    team_sentiment: teamCapped,
    product_sentiment: productCapped,
    team_product_sentiment: teamProductCapped,
    combined,
    sportMultiplier: sportMul,
    adjustment: combined * sportMul,
    rows,
  };
}

/**
 * Bulk-fetch active cascade observations relevant to a product. Returns rows
 * pre-split by scope for the caller to combine per-team. Two queries:
 *   1. global team_sentiment (product_id IS NULL) — applies to any product
 *      whose roster contains the named team
 *   2. product-scoped types (product_id matches) — covers product_sentiment
 *      and team_product_sentiment, plus product-attached team_sentiment if
 *      someone ever writes one (the global path is canonical, but we accept
 *      both to be forgiving)
 */
export async function loadCascadeObservations(productId: string): Promise<CascadeObservation[]> {
  const nowIso = new Date().toISOString();
  const [globalRes, productRes] = await Promise.all([
    supabaseAdmin
      .from('market_observations')
      .select('observation_type, scope_team, product_id, payload, observed_at')
      .eq('observation_type', 'team_sentiment')
      .is('product_id', null)
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('observation_type, scope_team, product_id, payload, observed_at')
      .in('observation_type', ['team_sentiment', 'product_sentiment', 'team_product_sentiment'])
      .eq('product_id', productId)
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
  ]);

  if (globalRes.error) throw globalRes.error;
  if (productRes.error) throw productRes.error;

  return [
    ...((globalRes.data ?? []) as CascadeObservation[]),
    ...((productRes.data ?? []) as CascadeObservation[]),
  ];
}

/**
 * Per-pp filter. Returns the observations relevant to one player_product
 * given its team:
 *   - product_sentiment: always included (applies to every player in product)
 *   - team_sentiment: included when scope_team matches the pp's team
 *   - team_product_sentiment: included when scope_team matches AND
 *     product_id matches the pp's product (already filtered by the loader,
 *     but we still verify scope_team here)
 */
export function filterObservationsForPlayer(
  all: CascadeObservation[],
  playerTeam: string | null | undefined,
): CascadeObservation[] {
  const team = (playerTeam ?? '').trim().toLowerCase();
  return all.filter(o => {
    if (o.observation_type === 'product_sentiment') return true;
    const scopeTeam = (o.scope_team ?? '').trim().toLowerCase();
    if (!scopeTeam) return false;
    return scopeTeam === team;
  });
}
