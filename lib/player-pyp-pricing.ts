// Per-player PYP (Pick Your Player) slot-price prediction — fair-value EV
// model. PYP is a lottery ticket on a single player's autograph pulls; the
// buyer's fair price is the expected dollar value of pulls, marked up.
//
// FROM FIRST PRINCIPLES (gambling math, not engineering math):
//
//   For a hobby case of H boxes:
//     E[$ from player p in this case] = H × Σ_p_variants(EV_v × 1/odds_per_box_v)
//                                     = H × hobbyEVPerBox_p
//
//   For C hobby cases:
//     fair_pyp_p   = C × H × hobbyEVPerBox_p
//     market_pyp_p = fair_pyp_p × MARKET_MARKUP_BY_LIFECYCLE(lifecycle)
//
//   H (boxes per case) isn't stored, but we can derive it:
//     H = hobby_autos_per_case / total_pull_rate_per_box
//   where total_pull_rate_per_box = Σ_all_variants(1/hobby_odds_per_box)
//   — i.e. total expected autographs per box across every variant.
//
// AND THE VARIANCE SIGNAL (because PYP is a lottery, not an annuity):
//
//   λ_p = C × hobby_autos_per_case × (playerPullRate_p / total_pull_rate)
//       = expected number of player p auto pulls across the full break
//
//   P(zero hits) ≈ e^(-λ_p)  (Poisson approximation — exact binomial is
//                              (1 - p)^n; for small p and large n the
//                              difference is < 1% and Poisson reads cleaner)
//
// This matters because real breakers price the variance: low-λ slots
// (rare-pull stars) often trade at a premium over fair value because the
// upside-only payoff is itself worth something. v1 of this model is the
// fair-value point estimate + the no-hit probability — surfacing both lets
// SMEs and buyers see WHY a slot might be priced above the model.
//
// SCOPED TO HOBBY for v1. BD/jumbo PYP is rare in practice; jumbo case
// odds also vary product-to-product in ways we don't yet model. Will
// extend once /break-price captures show demand.
//
// REFINEMENTS WE DELIBERATELY DEFER (see BACKLOG P1):
//   - Risk-premium markup that grows with 1/λ
//   - "Carve out as PYP" toggle that excludes a player from the team-slot
//     denominator and re-prices both
//
// AND THE P0 IN THE BACKLOG: the team-slot pricing pipeline
// (computeSlotPricing in lib/engine.ts) currently uses case-cost-share,
// not fair-value EV. The same critique that produced this rewrite applies
// to PYT. Worth aligning both on one foundation.

import { MARKET_MARKUP_BY_LIFECYCLE } from '@/lib/market-markup';
import type { BreakConfig, PlayerWithPricing, ProductLifecycle } from '@/lib/types';

export interface PlayerPypResult {
  /** Σ_player_variants(1/hobby_odds_per_box). Expected autos per box of THIS player. */
  playerPullRate: number;
  /** Player share of total expected autos per box (0..1). */
  shareOfPulls: number;
  /** Expected number of player p auto pulls across the full break. = λ. */
  expectedHits: number;
  /** Pure-EV PYP slot price — no breaker margin. */
  pypPure: number;
  /** Display PYP slot price — pypPure × lifecycle market markup. */
  pypMarket: number;
  /** P(zero hits in the configured break). Poisson approximation. 0..1. */
  pZeroHits: number;
}

export interface PlayerPypTable {
  /** Map keyed by player_product.id. Missing key = player couldn't be priced. */
  byPlayerProductId: Map<string, PlayerPypResult>;
  /**
   * Whether the product publishes per-variant odds densely enough that PYP
   * predictions are meaningful. False → the UI should hide the column.
   */
  oddsCoverageOk: boolean;
  /** Fraction of priced players with at least one variant carrying hobby_odds (0..1). */
  oddsCoverage: number;
  /**
   * Total expected autos per box across every variant of every player in
   * the product. Diagnostic — when this is far off from
   * hobby_autos_per_case / typical-boxes-per-case (≈ 1-2 for most products),
   * either the odds data is mis-imported or the product is unusual.
   */
  totalPullRatePerBox: number;
}

/** Coverage threshold below which the PYP column is suppressed entirely. */
const MIN_ODDS_COVERAGE = 0.30;

export interface VariantOddsRow {
  hobby_odds: number | null;
}

/**
 * Caller passes a per-player-product map of variant rows (only `hobby_odds`
 * is consulted). Same data the analysis / pricing pipeline already loads to
 * compute `hobbyEVPerBox`; we just need it here too so the model has the
 * total pull-rate denominator.
 */
export function computePlayerPyp(
  players: PlayerWithPricing[],
  variantsByPlayerProductId: Map<string, VariantOddsRow[]>,
  config: BreakConfig,
  productHobbyAutosPerCase: number | null,
  lifecycle: ProductLifecycle | null,
): PlayerPypTable {
  const byPlayerProductId = new Map<string, PlayerPypResult>();
  const eligible = players.filter(p => !p.insert_only);

  // Per-player pull rate: Σ over the player's variants of (1/hobby_odds).
  // Variants without odds (null or 0) contribute 0 — they don't move the
  // numerator OR the denominator, so a partial-odds product still produces
  // sensible PYP for the players we DO have odds for.
  const playerPullRates = new Map<string, number>();
  let totalPullRatePerBox = 0;
  let playersWithOdds = 0;

  for (const p of eligible) {
    const variants = variantsByPlayerProductId.get(p.id) ?? [];
    let r = 0;
    for (const v of variants) {
      if (v.hobby_odds != null && v.hobby_odds > 0) r += 1 / v.hobby_odds;
    }
    playerPullRates.set(p.id, r);
    totalPullRatePerBox += r;
    if (r > 0) playersWithOdds++;
  }

  const oddsCoverage = eligible.length > 0 ? playersWithOdds / eligible.length : 0;
  const oddsCoverageOk = oddsCoverage >= MIN_ODDS_COVERAGE;

  // Bail conditions — column gets suppressed, but coverage stays available
  // so the caller can render a "configure your break" hint vs. "no PYP for
  // this product" message.
  if (
    !oddsCoverageOk ||
    !productHobbyAutosPerCase ||
    productHobbyAutosPerCase <= 0 ||
    totalPullRatePerBox <= 0 ||
    config.hobbyCases <= 0
  ) {
    return { byPlayerProductId, oddsCoverageOk, oddsCoverage, totalPullRatePerBox };
  }

  // Boxes per case, derived: autos/case ÷ autos/box.
  const boxesPerCase = productHobbyAutosPerCase / totalPullRatePerBox;
  const markup = lifecycle
    ? MARKET_MARKUP_BY_LIFECYCLE[lifecycle]
    : MARKET_MARKUP_BY_LIFECYCLE.live;

  const totalPullsInBreak = config.hobbyCases * productHobbyAutosPerCase;

  for (const p of eligible) {
    const playerPullRate = playerPullRates.get(p.id) ?? 0;
    if (playerPullRate <= 0 || p.hobbyEVPerBox <= 0) continue;

    const shareOfPulls = playerPullRate / totalPullRatePerBox;
    const expectedHits = totalPullsInBreak * shareOfPulls;

    // fair_pyp = C × H × hobbyEVPerBox — the buyer's expected $ of pulls.
    const pypPure = config.hobbyCases * boxesPerCase * p.hobbyEVPerBox;
    const pypMarket = pypPure * markup;

    // Poisson(λ = expectedHits). For λ = 0.5 → P(0) = 0.61, for λ = 2 →
    // 0.135, for λ = 5 → 0.007. The "lottery ticket vs near-certainty"
    // spectrum users should be aware of.
    const pZeroHits = Math.exp(-expectedHits);

    byPlayerProductId.set(p.id, {
      playerPullRate,
      shareOfPulls,
      expectedHits,
      pypPure,
      pypMarket,
      pZeroHits,
    });
  }

  return { byPlayerProductId, oddsCoverageOk, oddsCoverage, totalPullRatePerBox };
}
