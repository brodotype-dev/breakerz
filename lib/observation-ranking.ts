// Pure ranking + rendering helpers for asking-price observations.
//
// Extracted from lib/observation-context.ts (slice 2b) so the same logic
// can run on the client (consumer break page) without dragging in the
// supabaseAdmin import that observation-context.ts uses for its server
// fetch. No Supabase, no I/O, no React — pure functions only.

import type { SlotComposition } from '@/lib/types';

// 30-day lookback used everywhere we age observations out. Linear decay
// to zero at the boundary. Matches slice 2b's existing window.
export const OBSERVATION_LOOKBACK_DAYS = 30;

/**
 * Composition similarity in [0..1].
 *   1.0 = identical key set
 *   0.5 = one is a subset of the other (covers "verdict is hobby-only,
 *         observation was a bd+hobby bundle" — partially relevant)
 *   0.0 = disjoint key sets, or either side is empty
 *
 * Values inside a key set are ignored — case counts vary widely and the
 * narrative doesn't need exact ratio match.
 */
export function compositionSimilarity(target: SlotComposition, candidate: SlotComposition): number {
  const tKeys = Object.keys(target).sort();
  const cKeys = Object.keys(candidate).sort();
  if (tKeys.length === 0 || cKeys.length === 0) return 0;
  if (tKeys.join('|') === cKeys.join('|')) return 1.0;
  const intersection = tKeys.filter(k => cKeys.includes(k));
  if (intersection.length === 0) return 0;
  return 0.5;
}

export function recencyWeight(observedAt: string, now: Date = new Date()): number {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return 0;
  const ageDays = (now.getTime() - t) / 86_400_000;
  if (ageDays < 0) return 1;
  if (ageDays > OBSERVATION_LOOKBACK_DAYS) return 0;
  return 1 - ageDays / OBSERVATION_LOOKBACK_DAYS;
}

/**
 * Human-readable label for a composition. Single-key with null value
 * renders just the format name. Single-key with a count renders "bd ×20".
 * Multi-key renders "bd 20 + hobby 5" with null counts collapsing to just
 * the format name.
 */
export function renderComposition(comp: SlotComposition): string {
  const ORDER: Array<'hobby' | 'bd' | 'jumbo'> = ['hobby', 'bd', 'jumbo'];
  const present = ORDER.filter(k => comp[k] !== undefined);
  if (present.length === 0) return '?';
  if (present.length === 1) {
    const k = present[0];
    const v = comp[k];
    return v == null ? k : `${k} ×${v}`;
  }
  return present.map(k => {
    const v = comp[k];
    return v == null ? k : `${k} ${v}`;
  }).join(' + ');
}

/**
 * Active break config distilled into a composition map so we can rank
 * candidates. Mirrors the shape `runBreakAnalysis` already uses for its
 * formats input.
 */
export function configToComposition(formats: { hobby: number; bd: number; jumbo: number }): SlotComposition {
  const out: SlotComposition = {};
  if (formats.hobby > 0) out.hobby = formats.hobby;
  if (formats.bd > 0)    out.bd    = formats.bd;
  if (formats.jumbo > 0) out.jumbo = formats.jumbo;
  return out;
}

/**
 * Best composite score (similarity × recency) across a set of observations
 * vs. the target composition. Used by callers that just want "do any of
 * these match well enough to show" without ranking the full list.
 */
export function bestCompositeScore(
  target: SlotComposition,
  observations: Array<{ composition: SlotComposition; observed_at: string }>,
  now: Date = new Date(),
): number {
  let best = 0;
  for (const o of observations) {
    const s = compositionSimilarity(target, o.composition) * recencyWeight(o.observed_at, now);
    if (s > best) best = s;
  }
  return best;
}
