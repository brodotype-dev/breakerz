/**
 * lib/ev-override.ts — per-player-per-product manual EV override.
 *
 * Kyle/Brody set a base EV for a player whose modeled value is wrong (expected
 * to explode, or a base the pipeline mis-prices). We apply it at READ time —
 * wherever a PlayerWithPricing row is assembled (loadCached,
 * loadPreReleaseBaseline, runBreakAnalysis, team-fair-value) — rather than in
 * the refresh pipeline, so the override is:
 *
 *   - authoritative regardless of pricing_cache / refresh state,
 *   - identical for live AND pre-release products (they use different read
 *     paths but both build PlayerWithPricing rows),
 *   - durable across every pricing refresh (refresh keeps writing modeled CH
 *     numbers to pricing_cache; the read layer just prefers the override).
 *
 * The override is the post-lifecycle BASE EV. Display-layer breaker markup,
 * compression, and pool weighting still apply at render, so the final slot
 * price is NOT equal to the entered number — matching "a base that doesn't
 * match our model," not "pin the slot price."
 *
 * evLow / evHigh are derived from the override with the same 0.35 / 2.5 spread
 * the fallback rungs use, so the player drawer + "Why this price?" render a
 * sensible band.
 */

export interface EvOverrideResult {
  evLow: number;
  evMid: number;
  evHigh: number;
}

/**
 * Returns the derived {evLow, evMid, evHigh} triple when a player_product
 * carries a valid manual override, else null. Accepts any row shape that
 * includes `ev_override` (Postgres NUMERIC arrives as string | number).
 */
export function evOverrideFor(
  pp: { ev_override?: number | string | null },
): EvOverrideResult | null {
  const raw = pp?.ev_override;
  if (raw == null) return null;
  const mid = Number(raw);
  if (!Number.isFinite(mid) || mid <= 0) return null;
  return {
    evMid: Math.round(mid),
    evLow: Math.round(mid * 0.35),
    evHigh: Math.round(mid * 2.5),
  };
}
