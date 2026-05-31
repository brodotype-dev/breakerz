import type { PlayerWithPricing, BreakConfig, Signal, TeamSlot } from './types';

// Slot-pricing mode. Default 'case_cost_share' = behavior-preserving
// (hobbyBreakCost × hobbyWeight/totalHobbyWeight). 'fair_value_ev' = each
// player's hobby slot is C × H × hobbyEVPerBox (no effective-score multiplier,
// no markup — that's display-layer). Sums of per-player fair_value_ev hobby
// slots across a team equal the team PYT, matching the per-player PYP math
// in lib/player-pyp-pricing.ts. BD + jumbo remain on case-cost-share in v1.
// See docs/plans/2026-05-30-handoff.md §4.
export type SlotPricingMode = 'case_cost_share' | 'fair_value_ev';

// Coverage threshold below which fair_value_ev silently falls back to
// case_cost_share. Mirrors lib/player-pyp-pricing.ts MIN_ODDS_COVERAGE so
// the same products that suppress the PYP column suppress the new PYT mode.
const FAIR_VALUE_MIN_ODDS_COVERAGE = 0.30;

// Exported for use in UI components that need to display buzz signals.
// risk_score_adj / hype_score_adj / prospect_score_adj / cascade_score_adj are
// runtime modulators folded in alongside buzz + breakerz before the clamp.
// All default 0 when omitted. See lib/score-modulation.ts (risk + hype),
// lib/prospect-score.ts (Track A), lib/cascading-sentiment.ts (Track B).
export function computeEffectiveScore(
  buzzScore: number | null | undefined,
  breakerzScore: number | null | undefined,
  isIcon: boolean,
  riskScoreAdj: number | null | undefined = 0,
  hypeScoreAdj: number | null | undefined = 0,
  prospectScoreAdj: number | null | undefined = 0,
  cascadeScoreAdj: number | null | undefined = 0,
): number {
  if (isIcon) return 0;
  return Math.max(
    -0.9,
    Math.min(
      1.0,
      (buzzScore ?? 0) +
        (breakerzScore ?? 0) +
        (riskScoreAdj ?? 0) +
        (hypeScoreAdj ?? 0) +
        (prospectScoreAdj ?? 0) +
        (cascadeScoreAdj ?? 0),
    ),
  );
}

export function computeSlotPricing(
  players: PlayerWithPricing[],
  config: BreakConfig,
  mode: SlotPricingMode = 'case_cost_share',
  variantsByPlayerProductId?: Map<string, Array<{ hobby_odds: number | null }>>,
  productHobbyAutosPerCase?: number | null,
): PlayerWithPricing[] {
  const eligible = players.filter(p => !p.insert_only);

  // Hobby + jumbo pools weight by hobbyEVPerBox × (1 + effectiveScore). Jumbo
  // products typically pull from a similar variant pool to hobby (refractors,
  // numbered parallels) so we reuse the same per-box-EV expectation. BD weights
  // by raw evMid since BD pulls a flatter, less variant-driven slate.
  // BD-only players (hobby_sets === 0) are excluded from the hobby pool;
  // jumbo-only is similarly excluded if jumbo_sets === 0.
  const effectiveScore = (p: PlayerWithPricing) =>
    p.player?.is_icon
      ? 0
      : Math.max(
          -0.9,
          Math.min(
            1.0,
            (p.buzz_score ?? 0) +
              (p.breakerz_score ?? 0) +
              (p.risk_score_adj ?? 0) +
              (p.hype_score_adj ?? 0) +
              (p.prospect_score_adj ?? 0) +
              (p.cascade_score_adj ?? 0),
          ),
        );
  const hobbyWeightFor = (p: PlayerWithPricing) =>
    p.hobby_sets > 0 ? p.hobbyEVPerBox * (1 + effectiveScore(p)) : 0;
  const jumboWeightFor = (p: PlayerWithPricing) =>
    (p.jumbo_sets ?? 0) > 0 ? p.hobbyEVPerBox * (1 + effectiveScore(p)) : 0;

  const totalHobbyWeight = eligible.reduce((sum, p) => sum + hobbyWeightFor(p), 0);
  const totalJumboWeight = eligible.reduce((sum, p) => sum + jumboWeightFor(p), 0);
  const totalBdWeight = eligible.reduce((sum, p) => sum + p.evMid, 0);

  const hobbyBreakCost = config.hobbyCases * config.hobbyCaseCost;
  const bdBreakCost = config.bdCases * config.bdCaseCost;
  const jumboBreakCost = config.jumboCases * config.jumboCaseCost;

  // ── Fair-value EV pre-computation (hobby only) ─────────────────────────
  // Per-player pullRate = Σ over hobby_odds-bearing variants of (1/odds).
  // Identical to lib/player-pyp-pricing.ts so PYT sums match per-player PYP.
  // If coverage is too thin (or no autos_per_case), silently bail to
  // case-cost-share for hobby — same fallback policy as the PYP column.
  let useFairValueHobby = false;
  let boxesPerCase = 0;
  let totalPullRatePerBox = 0;
  const playerPullRates = new Map<string, number>();
  const totalHobbyPullsInBreak =
    config.hobbyCases * (productHobbyAutosPerCase ?? 0);

  if (mode === 'fair_value_ev' && variantsByPlayerProductId && productHobbyAutosPerCase && productHobbyAutosPerCase > 0) {
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
    if (oddsCoverage >= FAIR_VALUE_MIN_ODDS_COVERAGE && totalPullRatePerBox > 0 && config.hobbyCases > 0) {
      useFairValueHobby = true;
      boxesPerCase = productHobbyAutosPerCase / totalPullRatePerBox;
    }
  }

  return eligible.map(player => {
    const hobbyWeight = hobbyWeightFor(player);
    const jumboWeight = jumboWeightFor(player);
    const bdWeight = player.evMid;

    // Hobby — fair_value_ev for products that publish dense enough odds;
    // case-cost-share otherwise. Players with hobby_sets=0 or zero pullRate
    // get a $0 hobby slot in the fair-value path (they have no expected
    // pulls per the data); UI surfaces this via the PYP "—" rendering.
    let hobbySlotCost: number;
    let expectedHits: number | undefined;
    let pZeroHits: number | undefined;

    if (useFairValueHobby && player.hobby_sets > 0) {
      const playerPullRate = playerPullRates.get(player.id) ?? 0;
      if (playerPullRate > 0 && player.hobbyEVPerBox > 0) {
        // fair = C × H × hobbyEVPerBox — pure expected $ of pulls. No
        // effective-score multiplier (score modulation belongs to the
        // markup layer, not the EV layer).
        hobbySlotCost = config.hobbyCases * boxesPerCase * player.hobbyEVPerBox;
        expectedHits = totalHobbyPullsInBreak * (playerPullRate / totalPullRatePerBox);
        pZeroHits = Math.exp(-expectedHits);
      } else {
        hobbySlotCost = 0;
        expectedHits = 0;
        pZeroHits = 1;
      }
    } else {
      hobbySlotCost =
        totalHobbyWeight > 0 ? hobbyBreakCost * (hobbyWeight / totalHobbyWeight) : 0;
    }

    const bdSlotCost =
      totalBdWeight > 0 ? bdBreakCost * (bdWeight / totalBdWeight) : 0;
    const jumboSlotCost =
      totalJumboWeight > 0 ? jumboBreakCost * (jumboWeight / totalJumboWeight) : 0;
    const totalCost = hobbySlotCost + bdSlotCost + jumboSlotCost;

    return {
      ...player,
      hobbyWeight,
      bdWeight,
      jumboWeight,
      hobbySlotCost,
      bdSlotCost,
      jumboSlotCost,
      totalCost,
      hobbyPerCase: config.hobbyCases > 0 ? hobbySlotCost / config.hobbyCases : 0,
      bdPerCase: config.bdCases > 0 ? bdSlotCost / config.bdCases : 0,
      jumboPerCase: config.jumboCases > 0 ? jumboSlotCost / config.jumboCases : 0,
      maxPay: totalCost * 1.5,
      ...(expectedHits !== undefined ? { expectedHits, pZeroHits } : {}),
    };
  }).sort((a, b) => (a.player?.name ?? '').localeCompare(b.player?.name ?? ''));
}

export function computeSignal(evMid: number, askPrice: number): { valuePct: number; signal: Signal } {
  const valuePct = evMid > 0 ? ((evMid - askPrice) / evMid) * 100 : -100;
  let signal: Signal;
  if (valuePct >= 30) signal = 'BUY';
  else if (valuePct >= 0) signal = 'WATCH';
  else signal = 'PASS';
  return { valuePct, signal };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

// CardHedger confidence (0..1) bucketed into named tiers. Pattern mirrors
// Card Ladder's age-based pricing-confidence rating. Reused across the
// player table + drawer so the same row reads consistently everywhere it
// renders. Returns null when there's no modeled confidence (fallback-priced
// rows write `null` into pricing_cache).
export type ConfidenceTier = 'strong' | 'solid' | 'stale' | 'cold';
export interface ConfidenceTierInfo {
  tier: ConfidenceTier;
  label: string;
  // CSS variables match the rest of the design system. Strong + Solid lean
  // green/neutral so they fade into the row; Stale/Cold are the actionable
  // signals collectors should notice.
  bg: string;
  fg: string;
  border: string;
}

export function confidenceTier(confidence: number | null | undefined): ConfidenceTierInfo | null {
  if (confidence == null) return null;
  if (confidence >= 0.7) return {
    tier: 'strong', label: 'Strong',
    bg: 'rgba(34,197,94,0.10)', fg: 'var(--signal-buy)', border: 'rgba(34,197,94,0.30)',
  };
  if (confidence >= 0.5) return {
    tier: 'solid', label: 'Solid',
    bg: 'rgba(148,163,184,0.10)', fg: 'var(--text-secondary)', border: 'rgba(148,163,184,0.30)',
  };
  if (confidence >= 0.2) return {
    tier: 'stale', label: 'Stale',
    bg: 'rgba(245,158,11,0.10)', fg: 'var(--accent-orange)', border: 'rgba(245,158,11,0.30)',
  };
  return {
    tier: 'cold', label: 'Cold',
    bg: 'rgba(239,68,68,0.10)', fg: 'var(--signal-pass)', border: 'rgba(239,68,68,0.30)',
  };
}

export function computeTeamSlotPricing(
  pricedPlayers: PlayerWithPricing[],
  config: BreakConfig
): TeamSlot[] {
  const teamMap = new Map<string, PlayerWithPricing[]>();
  for (const p of pricedPlayers) {
    const team = p.player?.team || 'Unknown';
    if (!teamMap.has(team)) teamMap.set(team, []);
    teamMap.get(team)!.push(p);
  }
  return Array.from(teamMap.entries()).map(([team, players]) => {
    const hobbySlotCost = players.reduce((s, p) => s + p.hobbySlotCost, 0);
    const bdSlotCost = players.reduce((s, p) => s + p.bdSlotCost, 0);
    const jumboSlotCost = players.reduce((s, p) => s + p.jumboSlotCost, 0);
    const totalCost = hobbySlotCost + bdSlotCost + jumboSlotCost;
    return {
      team,
      playerCount: players.length,
      rookieCount: players.filter(p => p.player?.is_rookie).length,
      hobbySlotCost,
      bdSlotCost,
      jumboSlotCost,
      totalCost,
      hobbyPerCase: config.hobbyCases > 0 ? hobbySlotCost / config.hobbyCases : 0,
      bdPerCase: config.bdCases > 0 ? bdSlotCost / config.bdCases : 0,
      jumboPerCase: config.jumboCases > 0 ? jumboSlotCost / config.jumboCases : 0,
      maxPay: totalCost * 1.5,
      players: players.sort((a, b) => (a.player?.name ?? '').localeCompare(b.player?.name ?? '')),
    };
  }).sort((a, b) => a.team.localeCompare(b.team));
}
