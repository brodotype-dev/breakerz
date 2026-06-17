// Concept B — rank-tiered base EV floor for pre-release / thin-data cards.
//
// Track A (computeProspectAdjustment) bumps a player's weight SHARE in the
// pool, not their base VALUE. For pre-release Bowman with no CardHedger data
// the engine falls back to $15 (rookie) / $8 (generic); a top-10 prospect ×
// Track A's ~1.6 share = ~$24, which isn't the meaningful change Kyle expects.
// This sets the base EV from a rank-tiered table BEFORE the weight-share math,
// so a #1 prospect starts at ~$80 → ×share, not ~$24.
//
// Bowman-scoped on purpose ("anything Bowman is the only thing that matters" —
// Kyle). Non-Bowman prospect products keep the legacy rookie/generic fallback.
// Gated by the SAME feature_flags.prospect_rank_enabled kill switch as Track A
// — the gate lives at the engine call sites; this helper is pure.
//
// The floor numbers are CALIBRATED GUESSES, not validated against a clean
// dataset. Tune post-deploy via Market Delta Watch: systematically over-priced
// → drop the tiers; under → raise. See CHANGELOG 2026-06-16.

const PROSPECT_RANK_BASE_EV: ReadonlyArray<{ maxRank: number; ev: number }> = [
  { maxRank: 10,  ev: 80 },   // top-10 prospects
  { maxRank: 30,  ev: 50 },   // #11–30
  { maxRank: 100, ev: 25 },   // #31–100
];
const IN_BOWMAN_UNRANKED_EV = 15;  // any player in a Bowman product but unranked
const ROOKIE_DEFAULT_EV = 15;      // legacy, unchanged
const GENERIC_DEFAULT_EV = 8;      // legacy, unchanged

export function computeFallbackBaseEV(params: {
  isRookie: boolean;
  prospectRank: number | null | undefined;
  productLine: string | null | undefined;
}): number {
  const { isRookie, prospectRank, productLine } = params;
  if (prospectRank != null) {
    const tier = PROSPECT_RANK_BASE_EV.find(t => prospectRank <= t.maxRank);
    if (tier) return tier.ev;
  }
  if (productLine?.startsWith('bowman_')) return IN_BOWMAN_UNRANKED_EV;
  if (isRookie) return ROOKIE_DEFAULT_EV;
  return GENERIC_DEFAULT_EV;
}
