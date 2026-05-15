/**
 * Slice 2b — Observation context for the AI verdict narrative.
 *
 * Pulls recent /break-price (asking_price) observations for a product,
 * weights them by composition similarity + recency, and returns a
 * prompt-ready text block + counts. Caller decides whether to splice
 * into the verdict prompt based on the feature flag and the threshold.
 *
 * See docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { SlotComposition, ObservationSourceType } from '@/lib/types';
import {
  OBSERVATION_LOOKBACK_DAYS,
  compositionSimilarity,
  recencyWeight,
  renderComposition,
  configToComposition as configToCompositionShared,
} from '@/lib/observation-ranking';

// Hard-coded knobs. Tuned against expected slice-1 volume; revisit when
// observation volume grows past ~50/product/week.
const LOOKBACK_DAYS = OBSERVATION_LOOKBACK_DAYS;
const MAX_OBSERVATIONS_RETURNED = 5;
const MIN_OBSERVATIONS_TO_CITE = 3;
const RAW_FETCH_CAP = 50; // pull the freshest 50 then rank locally

export interface ObservationForVerdict {
  composition: SlotComposition;
  compositionLabel: string;        // human-readable, e.g. "bd 20 + hobby 5"
  price_low: number;
  price_high: number;
  source_type: ObservationSourceType;
  observed_at: string;             // ISO timestamp
  similarity: number;              // 0..1 — composition overlap with the verdict's target
  recency_weight: number;          // 0..1 — exponential decay by age
  composite_score: number;         // similarity × recency_weight
}

export interface ObservationContext {
  /** Prompt-ready text block, or empty string when threshold not met. */
  block: string;
  /** Total observations returned (post-ranking, ≤ MAX_OBSERVATIONS_RETURNED). */
  observationCount: number;
  /** True when ≥ MIN_OBSERVATIONS_TO_CITE — caller uses to decide
   *  whether to soften the prompt's market-range claim language. */
  hasEnough: boolean;
  /** Top observations, in descending composite score order. Returned even
   *  when below threshold so the admin debug surface can inspect them. */
  observations: ObservationForVerdict[];
}

// Re-export the active-config helper at its original symbol name so existing
// imports of `configToComposition` from this module keep working. The pure
// math + rendering helpers (compositionSimilarity, recencyWeight,
// renderComposition) now live in lib/observation-ranking.ts so the client
// surfaces can use them without pulling supabaseAdmin.
export const configToComposition = configToCompositionShared;

export async function getRecentObservationsForVerdict(
  productId: string,
  targetComposition: SlotComposition,
): Promise<ObservationContext> {
  if (!productId) {
    return { block: '', observationCount: 0, hasEnough: false, observations: [] };
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('market_observations')
    .select('id, observed_at, payload')
    .eq('observation_type', 'asking_price')
    .eq('product_id', productId)
    .is('superseded_at', null)
    .gt('observed_at', cutoff)
    .order('observed_at', { ascending: false })
    .limit(RAW_FETCH_CAP);

  if (error || !rows?.length) {
    return { block: '', observationCount: 0, hasEnough: false, observations: [] };
  }

  const now = new Date();
  const ranked: ObservationForVerdict[] = rows
    .map((r: { id: string; observed_at: string; payload: Record<string, unknown> }) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;

      // Read composition with fallback to legacy `format` for any rows
      // that slipped through pre-backfill. Defense in depth — backfill
      // ran on prod but new envs / staging may lag.
      let composition: SlotComposition = {};
      const compRaw = payload.composition as Record<string, unknown> | undefined;
      if (compRaw && typeof compRaw === 'object') {
        for (const k of ['hobby', 'bd', 'jumbo'] as const) {
          if (k in compRaw) {
            const v = compRaw[k];
            composition[k] = v == null ? null : Number(v);
          }
        }
      } else if (typeof payload.format === 'string') {
        const f = payload.format as 'hobby' | 'bd' | 'jumbo';
        if (f === 'hobby' || f === 'bd' || f === 'jumbo') composition[f] = null;
      }

      const rawSourceType = payload.source_type as string | undefined;
      const source_type: ObservationSourceType =
        rawSourceType === 'competitor_listing' || rawSourceType === 'breaker_estimate' || rawSourceType === 'historical_sale'
          ? rawSourceType
          : 'competitor_listing'; // safe default for legacy rows

      const similarity = compositionSimilarity(targetComposition, composition);
      const recency = recencyWeight(r.observed_at, now);

      return {
        composition,
        compositionLabel: renderComposition(composition),
        price_low: Number(payload.price_low) || 0,
        price_high: Number(payload.price_high) || 0,
        source_type,
        observed_at: r.observed_at,
        similarity,
        recency_weight: recency,
        composite_score: similarity * recency,
      } as ObservationForVerdict;
    })
    // Drop rows with zero score — disjoint composition or aged out.
    // Keeps the cited set on-topic rather than padding with noise.
    .filter(o => o.composite_score > 0)
    .sort((a, b) => b.composite_score - a.composite_score)
    .slice(0, MAX_OBSERVATIONS_RETURNED);

  const observationCount = ranked.length;
  const hasEnough = observationCount >= MIN_OBSERVATIONS_TO_CITE;

  return {
    block: hasEnough ? renderContextBlock(ranked) : '',
    observationCount,
    hasEnough,
    observations: ranked,
  };
}

function renderContextBlock(obs: ObservationForVerdict[]): string {
  // Group by source_type so the narrative can cite them differently.
  const listings = obs.filter(o => o.source_type === 'competitor_listing');
  const estimates = obs.filter(o => o.source_type === 'breaker_estimate');
  const sales = obs.filter(o => o.source_type === 'historical_sale');

  const summarize = (rows: ObservationForVerdict[], label: string): string => {
    if (rows.length === 0) return '';
    const prices = rows.flatMap(r => [r.price_low, r.price_high]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = min === max ? `$${min.toLocaleString()}` : `$${min.toLocaleString()}–$${max.toLocaleString()}`;
    const compShapes = Array.from(new Set(rows.map(r => r.compositionLabel))).join(', ');
    return `  ${rows.length} ${label} ${range} (${compShapes})`;
  };

  const lines = [
    `Recent /break-price observations for this product (last ${LOOKBACK_DAYS}d, ranked by composition match + recency):`,
    summarize(listings, listings.length === 1 ? 'competitor listing:' : 'competitor listings:'),
    summarize(estimates, estimates.length === 1 ? 'breaker estimate:' : 'breaker estimates:'),
    summarize(sales, sales.length === 1 ? 'historical sale:' : 'historical sales:'),
  ].filter(s => s !== '');

  return lines.join('\n');
}
