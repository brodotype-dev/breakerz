// Reasonable-margin band — the checks-and-balances model.
//
// BreakIQ isn't anti-breaker. Breakers run a real business and deserve a fair
// margin over the expected value of what they're selling. What consumers need
// is a referee: a band that says "this much markup is reasonable; below it
// you're getting a steal; above it you're being fleeced."
//
// Three zones around the pure fair value (F = expected $ of pulls):
//
//   ask <  F × bandLow   → STEAL       (lean in)
//   F × bandLow ≤ ask ≤ F × bandHigh → FAIR  (breaker making honest money)
//   ask >  F × bandHigh  → OVERPAYING  (the fleecing we exist to catch)
//
// THE BAND CENTER IS WHERE THE MOAT LIVES.
//
//   bandCenter = MARKET_MARKUP_BY_LIFECYCLE[lifecycle] × (1 + α × effectiveScore)
//
// effectiveScore folds in everything CardHedger can't see — SME sentiment
// (breakerz_score), prospect rank (Track A), hype tags, risk flags, cascade
// sentiment (Track B). It SHIFTS the reasonable band, it doesn't fight the
// breaker:
//
//   - A player on a heater (positive score) → band shifts UP. It's genuinely
//     reasonable for a breaker to charge more right now; we say so.
//   - A risk-flagged / cooling player (negative score) → band shifts DOWN.
//     Charging the normal premium on a player who just got hurt IS fleecing,
//     and the band catches it where a flat markup wouldn't.
//
// This is the thing a CardHedger wrapper can't replicate: the band knows
// WHERE the reasonable line should sit for THIS player at THIS moment.
//
// Scoped to bundle/team/player fair values alike — caller supplies F + a
// representative effectiveScore (EV-weighted across the bundle for verdicts).

import type { ProductLifecycle, Signal } from '@/lib/types';
import { MARKET_MARKUP_BY_LIFECYCLE } from '@/lib/market-markup';

export type MarginZone = 'steal' | 'fair' | 'overpaying';

// α — how hard effectiveScore swings the reasonable band center. effectiveScore
// is already clamped to [-0.9, 1.0] upstream, so at α=0.15 a max-hype player's
// band center moves +15% and a max-risk player's moves −13.5%. Conservative
// starting value; tune from /break-price capture deltas as they accumulate.
export const MARGIN_BAND_SCORE_SENSITIVITY = 0.15;

// Half-width of the "fair" zone as a fraction of the band center. ±10% means a
// live product (base markup 1.20, no score) treats 1.08–1.32 as reasonable.
// Wide on purpose for v1 — we'd rather under-call fleecing than cry wolf.
export const MARGIN_BAND_HALF_WIDTH = 0.10;

export interface MarginBand {
  /** Pure expected value — the floor the whole band is built on. */
  fairValue: number;
  /** Lifecycle base markup before the score shift (1.40 / 1.20 / 1.05). */
  baseMarkup: number;
  /** Score-shifted band center multiplier. */
  centerMarkup: number;
  /** Reasonable-margin price band edges, in dollars. */
  priceLow: number;
  priceCenter: number;
  priceHigh: number;
}

/**
 * Build the reasonable-margin band for a fair value at a given lifecycle,
 * shifted by the (EV-weighted) effective score of whatever the band covers.
 * effectiveScore defaults to 0 — callers that don't have score context
 * (e.g. the admin 1-case approximation) get the flat lifecycle band.
 */
export function computeMarginBand(
  fairValue: number,
  lifecycle: ProductLifecycle | null | undefined,
  effectiveScore = 0,
): MarginBand {
  const baseMarkup = lifecycle
    ? MARKET_MARKUP_BY_LIFECYCLE[lifecycle]
    : MARKET_MARKUP_BY_LIFECYCLE.live;
  const centerMarkup = baseMarkup * (1 + MARGIN_BAND_SCORE_SENSITIVITY * effectiveScore);
  const priceCenter = fairValue * centerMarkup;
  return {
    fairValue,
    baseMarkup,
    centerMarkup,
    priceLow: priceCenter * (1 - MARGIN_BAND_HALF_WIDTH),
    priceCenter,
    priceHigh: priceCenter * (1 + MARGIN_BAND_HALF_WIDTH),
  };
}

/** Which zone does an observed ask fall in relative to the band? */
export function classifyAsk(ask: number, band: MarginBand): MarginZone {
  if (band.priceCenter <= 0) return 'fair'; // no signal — don't accuse
  if (ask < band.priceLow) return 'steal';
  if (ask > band.priceHigh) return 'overpaying';
  return 'fair';
}

// Map the band zone onto the existing BUY/WATCH/PASS enum so nothing
// downstream (snapshots, PostHog, the result panel) needs a schema change.
// The labels gain a sharper meaning: BUY = steal vs. a reasonable margin,
// WATCH = the margin is fair, PASS = you're overpaying.
export function zoneToSignal(zone: MarginZone): Signal {
  switch (zone) {
    case 'steal':      return 'BUY';
    case 'fair':       return 'WATCH';
    case 'overpaying': return 'PASS';
  }
}

/** Short human label for the zone, for chips + admin copy. */
export function zoneLabel(zone: MarginZone): string {
  switch (zone) {
    case 'steal':      return 'Steal';
    case 'fair':       return 'Fair margin';
    case 'overpaying': return 'Overpaying';
  }
}

// valuePct relative to the band center — keeps the existing "X% above/below"
// display working, now anchored to the reasonable price rather than a raw
// markup. Positive = ask is below center (good for the buyer).
export function bandValuePct(ask: number, band: MarginBand): number {
  if (band.priceCenter <= 0) return -100;
  return ((band.priceCenter - ask) / band.priceCenter) * 100;
}
