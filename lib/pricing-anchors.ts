/**
 * Per-player EV aggregation strategies.
 *
 * Extracted from lib/pricing-refresh.ts:495 so per-product `anchor_strategy` /
 * `anchor_variant_patterns` configuration can dispatch between different ways
 * of folding per-variant CH prices into one ev_low/ev_mid/ev_high triple.
 *
 * - `sets_weighted_all` (default): byte-for-byte the original sets-weighted average.
 * - `curated_variants`: only count variants whose variant_name matches any of the
 *    configured regex patterns. Falls back to sets_weighted_all (with warning) when
 *    no variants match — never let a misconfiguration zero out a slot.
 * - `curated_with_tail`: curated subset + a fixed CURATED_TAIL_BONUS as residual
 *    long-tail option value. Same fallback behavior.
 *
 * See docs/plans/2026-05-11-per-product-anchor-configurator.md for the broader picture.
 */

export type AnchorStrategy =
  | 'sets_weighted_all'
  | 'curated_variants'
  | 'curated_with_tail';

export const ANCHOR_STRATEGY_DEFAULT: AnchorStrategy = 'sets_weighted_all';

/** Long-tail option-value multiplier for `curated_with_tail`. Tune here. */
export const CURATED_TAIL_BONUS = 0.15;

export interface VariantEV {
  variantId: string;
  variantName: string | null;
  evLow: number;
  evMid: number;
  evHigh: number;
  confidence: number;
  sets: number;        // hobby + bd_only + jumbo, floor 1 (matches pricing-refresh behavior)
  hobbyOdds: number | null;
  printRun: number | null;
}

export interface AggregatedEV {
  evLow: number;
  evMid: number;
  evHigh: number;
  confidence: number;
  /** How many variants actually contributed to the math. 0 means we fell back to the default. */
  matchedVariants: number;
  /** Which strategy was *applied* — differs from the requested strategy when a curated_* fell back. */
  strategyApplied: AnchorStrategy;
  /** True when curated_* requested but no patterns matched. Logged by caller for telemetry. */
  fellBack: boolean;
}

const EMPTY: AggregatedEV = {
  evLow: 0, evMid: 0, evHigh: 0, confidence: 0,
  matchedVariants: 0, strategyApplied: 'sets_weighted_all', fellBack: false,
};

/**
 * Aggregate per-variant EVs into a single triple using the configured strategy.
 *
 * `variantEVs` is the post-filter slice (1/1s already excluded by the caller —
 * we don't repeat that filter here so the per-variant exclusion logic in
 * pricing-refresh stays the single source of truth).
 *
 * Patterns are compiled once per call. Caller should batch many players' calls
 * with the same `patterns` if it cares about regex compile cost; current scale
 * (<10k variants per product) doesn't warrant a compile cache.
 */
export function aggregatePlayerEV(
  variantEVs: VariantEV[],
  strategy: AnchorStrategy,
  patterns: string[],
): AggregatedEV {
  const priced = variantEVs.filter(v => v.evMid > 0);
  if (priced.length === 0) return EMPTY;

  if (strategy === 'sets_weighted_all') {
    return setsWeighted(priced, 'sets_weighted_all');
  }

  // curated_* paths
  const compiled = compilePatterns(patterns);
  const matched = compiled.length > 0
    ? priced.filter(v => v.variantName != null && compiled.some(re => re.test(v.variantName!)))
    : [];

  if (matched.length === 0) {
    // Empty patterns OR patterns matched nothing — fall back to sets_weighted_all
    // so a misconfiguration never zeros out slot prices on a live product.
    const result = setsWeighted(priced, 'sets_weighted_all');
    return { ...result, fellBack: true };
  }

  const base = setsWeighted(matched, strategy);
  if (strategy === 'curated_variants') return base;

  // curated_with_tail: bonus is a flat percentage on top of the curated EV.
  // Represents the long-tail option value the curated subset ignored. Conservative:
  // we don't pull from the unmatched variants directly because their prices are
  // often the unreliable ones (that's why the admin curated in the first place).
  const bonus = 1 + CURATED_TAIL_BONUS;
  return {
    evLow:  Math.round(base.evLow  * bonus),
    evMid:  Math.round(base.evMid  * bonus),
    evHigh: Math.round(base.evHigh * bonus),
    confidence: base.confidence,
    matchedVariants: base.matchedVariants,
    strategyApplied: 'curated_with_tail',
    fellBack: false,
  };
}

function setsWeighted(variants: VariantEV[], applied: AnchorStrategy): AggregatedEV {
  const totalSets = variants.reduce((sum, v) => sum + v.sets, 0);
  if (totalSets === 0) return EMPTY;
  const evLow  = variants.reduce((sum, v) => sum + v.evLow  * v.sets, 0) / totalSets;
  const evMid  = variants.reduce((sum, v) => sum + v.evMid  * v.sets, 0) / totalSets;
  const evHigh = variants.reduce((sum, v) => sum + v.evHigh * v.sets, 0) / totalSets;
  const confidence = variants.reduce((sum, v) => sum + v.confidence * v.sets, 0) / totalSets;
  return {
    evLow:  Math.round(evLow),
    evMid:  Math.round(evMid),
    evHigh: Math.round(evHigh),
    confidence,
    matchedVariants: variants.length,
    strategyApplied: applied,
    fellBack: false,
  };
}

function compilePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    if (!p || typeof p !== 'string') continue;
    try {
      out.push(new RegExp(p, 'i'));
    } catch {
      // Invalid regex silently dropped. The configurator UI is responsible
      // for validating before save; this is just a runtime safety net.
    }
  }
  return out;
}
