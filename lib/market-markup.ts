import type { ProductLifecycle } from '@/lib/types';

// ── Plan B (display-layer market markup) ──────────────────────────────────
// Lifecycle-aware market markup applied at display time. Pure EV stays in
// pricing_cache; this multiplies it to estimate what the secondary break
// market actually charges per slot.
//
//   pre_release: 1.40 — release-week premium baked in
//   live:        1.20 — typical breaker margin over pure EV
//   dormant:     1.05 — settled but still a small slot premium
//
// See docs/plans/2026-05-11-slot-price-market-markup.md.
export const MARKET_MARKUP_BY_LIFECYCLE: Record<ProductLifecycle, number> = {
  pre_release: 1.40,
  live:        1.20,
  dormant:     1.05,
};

// ± around the midpoint when rendering the displayed range.
export const MARKET_MARKUP_RANGE = 0.10;

export function getMarketMarkup(lifecycle: ProductLifecycle | null | undefined): number {
  return lifecycle
    ? MARKET_MARKUP_BY_LIFECYCLE[lifecycle]
    : MARKET_MARKUP_BY_LIFECYCLE.live;
}

// ── Compression markup (2026-08-14) ───────────────────────────────────────
// The flat markup above multiplies every slot equally. But breakers price
// slots FLATTER than EV — they floor small spots (run them near cost+10% to
// move them) and dampen the big spots (they sell anyway), carrying margin on
// the top. Validated over 10 full-break captures (see
// docs/breaker-markup-validation.md; PRD: docs/plans/2026-08-14-market-compression-markup.md).
//
// `compressionMarkups` reallocates a break's flat markup across its slots so
// small spots lift and big spots dampen, CONSERVING the total (Σ cost×markup is
// unchanged) — a redistribution, not an inflation. Per-slot markup:
//   perSlotMarkup_i = M · s_i^(γ−1) / Σ s_j^γ    where s_i = cost_i / Σcost
// γ=1 is the identity (today's flat markup); γ<1 compresses; γ>1 amplifies the
// top. Data implies γ≈0.35; we start at 0.5 and tune via Market Delta once live.
// This is the GLOBAL default — the break page prefers a per-product override
// (`products.compression_gamma`) when set, since product character varies
// (commodity compresses, premium-with-singular-chase amplifies).
export const COMPRESSION_GAMMA = 0.5;

// Returns a per-slot effective markup aligned to `modelCosts`. Falls back to a
// uniform `baseMarkup` for degenerate inputs (empty / all-zero) and for γ=1.
export function compressionMarkups(
  modelCosts: number[],
  baseMarkup: number,
  gamma: number = COMPRESSION_GAMMA,
): number[] {
  const n = modelCosts.length;
  if (n === 0) return [];
  const uniform = () => modelCosts.map(() => baseMarkup);
  if (gamma === 1) return uniform();

  const total = modelCosts.reduce((s, c) => s + Math.max(0, c), 0);
  if (total <= 0) return uniform();

  const shares = modelCosts.map(c => Math.max(0, c) / total);
  const denom = shares.reduce((s, sh) => s + (sh > 0 ? Math.pow(sh, gamma) : 0), 0);
  if (denom <= 0) return uniform();

  return shares.map(sh => (sh > 0 ? (baseMarkup * Math.pow(sh, gamma - 1)) / denom : baseMarkup));
}

export interface MarketRange {
  low: number;
  mid: number;
  high: number;
}

// Build a displayable market range from a pure-EV fair value + lifecycle.
export function buildMarketRange(
  fairValue: number,
  lifecycle: ProductLifecycle | null | undefined,
): MarketRange {
  const markup = getMarketMarkup(lifecycle);
  return {
    low:  fairValue * (markup - MARKET_MARKUP_RANGE),
    mid:  fairValue *  markup,
    high: fairValue * (markup + MARKET_MARKUP_RANGE),
  };
}

// ── Plan C (math-layer release + freshness decay) ─────────────────────────
// Math-layer premiums applied during pricing-refresh. These multiply
// aggregated player EV BEFORE it lands in pricing_cache, so the cached
// value represents expected sale prices in the current lifecycle window.
// Plan B's display markup then layers on top at render time — the math
// layer is "what the cards are worth right now in this window," the
// display layer is "what the breaker charges for a slot above that."
//
// See docs/plans/2026-05-11-release-freshness-decay.md.

// Pre-release: prior-year / sibling comps need a small upward nudge
// because they don't reflect first-week release demand. Kept modest
// (1.15, not 1.40) since Plan B already adds 1.40 on the display side.
export const RELEASE_PREMIUM = 1.15;

// First-2-weeks-live decay. Peak at the moment the product goes live,
// halflife of 10 days, settled to 1.0 past 30 days.
export const FRESHNESS_PREMIUM = 0.20;
export const FRESHNESS_HALFLIFE_DAYS = 10;
const FRESHNESS_FLOOR_DAYS = 30;

export function freshnessMultiplier(liveSince: string | null | undefined): number {
  if (!liveSince) return 1.0;
  const t = Date.parse(liveSince);
  if (!Number.isFinite(t)) return 1.0;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 0) return 1.0;                       // future-dated, treat as no boost
  if (days > FRESHNESS_FLOOR_DAYS) return 1.0;    // cleanly settle past day 30
  return 1 + FRESHNESS_PREMIUM * Math.pow(0.5, days / FRESHNESS_HALFLIFE_DAYS);
}

// Combined math-layer multiplier — pre-release uses the static release
// premium; live uses the freshness decay; dormant is unchanged.
export function lifecycleEvMultiplier(
  lifecycle: ProductLifecycle | null | undefined,
  liveSince: string | null | undefined,
): number {
  if (lifecycle === 'pre_release') return RELEASE_PREMIUM;
  if (lifecycle === 'live')        return freshnessMultiplier(liveSince);
  return 1.0;
}
