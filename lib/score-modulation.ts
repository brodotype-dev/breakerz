/**
 * Score modulation — risk_flags + hype_tag observations fold into effectiveScore
 * alongside buzz_score + breakerz_score before the engine clamps.
 *
 * Conservative defaults. Tune the constants below in PR review; no admin UI.
 * See docs/score-modulation.md for math + verification.
 */

import type { PlayerRiskFlag } from './types';

export type HypeTag = 'release_premium' | 'cooled' | 'overhyped' | 'underhyped';

export const RISK_ADJUSTMENTS: Record<PlayerRiskFlag['flag_type'], number> = {
  injury:     -0.30,
  suspension: -0.50,
  retirement: -0.80,
  legal:      -0.40,
  off_field:  -0.25,
  trade:      -0.15,
};

export const HYPE_MAX = 0.30;

export const HYPE_DIRECTION: Record<HypeTag, 1 | -1> = {
  release_premium: +1,
  underhyped:      +1,
  cooled:          -1,
  overhyped:       -1,
};

export interface HypeObservation {
  tag: HypeTag;
  strength: number;     // 0..1
  decay_days: number;   // 1..60
  observed_at: string;  // ISO timestamp
}

/**
 * Returns the SINGLE most-negative active flag's adjustment, or 0 if none.
 * Stacking-by-sum is rejected: a player with both injury + off_field should
 * not double-count — the dominant signal wins.
 */
export function computeRiskAdjustment(
  activeFlags: Pick<PlayerRiskFlag, 'flag_type'>[],
): number {
  if (!activeFlags.length) return 0;
  let worst = 0;
  for (const f of activeFlags) {
    const adj = RISK_ADJUSTMENTS[f.flag_type] ?? 0;
    if (adj < worst) worst = adj;
  }
  return worst;
}

/**
 * Σ over hype_tag observations: direction × strength × HYPE_MAX × decayFactor
 * decayFactor = max(0, 1 - daysSinceObserved / decay_days). Linear decay.
 * Multiple hype tags ARE summed (release_premium + underhyped can stack).
 */
export function computeHypeAdjustment(
  observations: HypeObservation[],
  now: Date = new Date(),
): number {
  if (!observations.length) return 0;
  let total = 0;
  const nowMs = now.getTime();
  for (const o of observations) {
    const direction = HYPE_DIRECTION[o.tag];
    if (!direction) continue;
    const observedMs = new Date(o.observed_at).getTime();
    if (Number.isNaN(observedMs)) continue;
    const daysSince = Math.max(0, (nowMs - observedMs) / (1000 * 60 * 60 * 24));
    const decayDays = Math.max(1, o.decay_days);
    const decayFactor = Math.max(0, 1 - daysSince / decayDays);
    if (decayFactor === 0) continue;
    const strength = Math.max(0, Math.min(1, o.strength ?? 0));
    total += direction * strength * HYPE_MAX * decayFactor;
  }
  return total;
}
