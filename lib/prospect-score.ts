/**
 * Track A — Objective prospect adjustment.
 *
 * Reads players.prospect_rank + prospect_status + sport slug, returns an
 * additive bump in the same units as risk_score_adj / hype_score_adj. Folded
 * into effectiveScore alongside buzz + breakerz before the engine clamps.
 *
 * Source attribution is institutional (lives in players.prospect_rank_source).
 * No personal-name attribution path — that's Track B Discord territory.
 *
 * See docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.
 */

export const PROSPECT_RANK_TIERS: ReadonlyArray<{ maxRank: number; bump: number }> = [
  { maxRank: 10,  bump: 0.60 },
  { maxRank: 30,  bump: 0.40 },
  { maxRank: 100, bump: 0.20 },
];

export const PROSPECT_STATUS_BUMP: Record<string, number> = {
  graduated_rc:         0.15,
  international_signee: 0.10,
};

// Sport-aware throttle. Baseball prospect markets are the deepest and most
// codified (MLB Pipeline is monthly + widely-trusted); hockey lags because
// Upper Deck Young Guns RC year often diverges from prospect-rank year.
export const SPORT_PROSPECT_MULTIPLIER: Record<string, number> = {
  baseball:   1.0,
  basketball: 0.9,
  football:   0.7,
  hockey:     0.6,
};

export const PROSPECT_SCORE_CAP = 0.70;

export type ProspectStatus = 'graduated_rc' | 'international_signee';

export interface ProspectInput {
  prospect_rank: number | null | undefined;
  prospect_status: string | null | undefined;
  sportSlug: string | null | undefined;
}

export function computeProspectAdjustment(p: ProspectInput): number {
  const sportMul = SPORT_PROSPECT_MULTIPLIER[(p.sportSlug ?? '').toLowerCase()] ?? 0;
  if (!sportMul) return 0;

  let base = 0;
  if (p.prospect_rank != null) {
    const tier = PROSPECT_RANK_TIERS.find(t => p.prospect_rank! <= t.maxRank);
    if (tier) base += tier.bump;
  }
  if (p.prospect_status && PROSPECT_STATUS_BUMP[p.prospect_status]) {
    base += PROSPECT_STATUS_BUMP[p.prospect_status];
  }

  return Math.min(PROSPECT_SCORE_CAP, sportMul * base);
}
