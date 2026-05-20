// Database types matching Supabase schema

export interface Sport {
  id: string;
  name: string;
  slug: string;
}

export type ProductLifecycle = 'pre_release' | 'live' | 'dormant';

export type BreakFormat = 'hobby' | 'bd' | 'jumbo';

// Sparse vector describing the case mix per slot for an asking_price /
// odds observation. Replaces the old single-`format` field. Keys present
// are the formats involved. Values are case counts per slot when known,
// or `null` when the format is involved but the ratio wasn't stated.
//
//   "Whatnot stream — $45 Diamondbacks"          → { hobby: null }
//   "Bowman hobby per-team"                      → { hobby: null }
//   "delight/hobby, 20 delight 5 hobby per slot" → { bd: 20, hobby: 5 }
//   "delight/hobby case mix" (no ratio)          → { bd: null, hobby: null }
//
// "Mixed" is never a stored value — it's a display computation on top of
// this shape (`Object.keys(composition).length > 1 ? 'Mixed' : keys[0]`).
// See docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md.
export type SlotComposition = Partial<Record<BreakFormat, number | null>>;

// Epistemic kind of an observation. Orthogonal to the existing `source`
// enum (which captures the *channel* the observation arrived through):
//
//   competitor_listing — a price a competitor is asking (Whatnot, eBay,
//                        social posts of stream-room screenshots)
//   breaker_estimate   — an SME read on what a slot SHOULD be priced at
//                        (Dan Reed DMs, breaker friends weighing in)
//   historical_sale    — a completed sale we captured after the fact
//
// Derived deterministically from `source` at apply time — see
// `deriveSourceType` below. Slice 2a will weight these differently when
// the calibration aggregator ships.
export type ObservationSourceType =
  | 'competitor_listing'
  | 'breaker_estimate'
  | 'historical_sale';

export type AskingPriceSource = 'ebay_listing' | 'stream_ask' | 'social_post' | 'other';

// Maps the existing `source` channel to its epistemic kind. Trade-off
// accepted: not 100% accurate (a `social_post` could be a competitor's
// tweet, not always an SME estimate), but deterministic + zero-cost
// classification. If this skews calibration in slice 2a, revisit with
// an explicit slash-command override.
export function deriveSourceType(source: AskingPriceSource): ObservationSourceType {
  switch (source) {
    case 'stream_ask':   return 'competitor_listing';
    case 'ebay_listing': return 'competitor_listing';
    case 'social_post':  return 'breaker_estimate';
    case 'other':        return 'competitor_listing';
  }
}

// Raw market_observations rows surfaced to the consumer pre-release page for
// chip rendering. The hype tag union mirrors lib/score-modulation.ts.
export type HypeObsRow = {
  scope_type: 'product' | 'team' | 'player' | 'variant';
  scope_id: string | null;
  scope_team: string | null;
  payload: {
    tag: 'release_premium' | 'cooled' | 'overhyped' | 'underhyped';
    strength: number;
    decay_days: number;
    variant_name?: string;
  };
  observed_at: string;
  source_narrative: string | null;
};

export type AskingPriceObsRow = {
  scope_type: 'product' | 'team' | 'player' | 'variant';
  scope_id: string | null;
  scope_team: string | null;
  payload: {
    composition: SlotComposition;
    price_low: number;
    price_high: number;
    source: AskingPriceSource;
    source_type: ObservationSourceType;
    variant_name?: string;
  };
  observed_at: string;
  source_narrative: string | null;
};

export interface Product {
  id: string;
  sport_id: string;
  name: string;
  slug: string;
  manufacturer: string;
  year: string;
  hobby_case_cost: number;
  bd_case_cost: number | null;
  jumbo_case_cost: number | null;
  hobby_am_case_cost: number | null;
  bd_am_case_cost: number | null;
  jumbo_am_case_cost: number | null;
  hobby_autos_per_case: number;
  bd_autos_per_case: number | null;
  jumbo_autos_per_case: number | null;
  is_active: boolean;
  has_odds: boolean;
  release_date: string | null; // ISO date string (YYYY-MM-DD)
  ch_set_name: string | null; // Exact CardHedger canonical set name for matching
  lifecycle_status: ProductLifecycle; // pre_release | live | dormant
  // Stamp of the most recent pre_release → live transition. Drives the
  // FRESHNESS_PREMIUM decay in lib/market-markup.ts. Backfilled to
  // created_at for products that were already live before Plan C shipped.
  live_since: string | null;
  // Brand-line taxonomy (bowman_flagship, bowman_chrome, bowman_best,
  // topps_chrome, panini_prizm, etc.). Canonical list + display labels
  // live in lib/product-lines.ts. Drives parser context and format
  // expectations for specialty products.
  product_line: string | null;
  sport?: Sport;
}

export interface Player {
  id: string;
  name: string;
  sport_id: string;
  team: string;
  is_rookie: boolean;
  is_icon: boolean;
  // Track A — Objective prospect attributes (institutional source). NULL on
  // every player by default; populated via admin CSV import. See
  // lib/prospect-score.ts and docs/plans/2026-05-12-prospect-attrs-and-cascading-sentiment.md.
  prospect_rank?: number | null;
  prospect_status?: 'graduated_rc' | 'international_signee' | null;
  prospect_rank_source?: string | null;
  prospect_rank_updated_at?: string | null;
}

export interface PlayerProduct {
  id: string;
  player_id: string;
  product_id: string;
  hobby_sets: number;
  bd_only_sets: number;
  total_sets: number;
  insert_only: boolean;
  cardhedger_card_id: string | null;
  buzz_score: number | null;
  breakerz_score: number | null;
  breakerz_note: string | null;
  is_high_volatility: boolean;
  c_score: number | null;
  player?: Player;
}

export interface PlayerRiskFlag {
  id: string;
  player_product_id: string;
  flag_type: 'injury' | 'suspension' | 'legal' | 'trade' | 'retirement' | 'off_field';
  note: string;
  created_at: string;
  cleared_at: string | null;
}

export interface PricingCache {
  id: string;
  player_product_id: string;
  cardhedger_card_id: string;
  ev_low: number;
  ev_mid: number;
  ev_high: number;
  raw_comps: Record<string, unknown>;
  fetched_at: string;
  expires_at: string;
}

// --- App-level types (computed, not stored) ---

export interface BreakConfig {
  hobbyCases: number;
  bdCases: number;
  jumboCases: number;
  hobbyCaseCost: number;
  bdCaseCost: number;
  jumboCaseCost: number;
}

export interface PlayerWithPricing extends PlayerProduct {
  player: Player;
  evLow: number;
  evMid: number;
  evHigh: number;
  hobbyEVPerBox: number;  // odds-weighted: Σ(variantEV × 1/hobby_odds); falls back to evMid if no odds
  jumbo_sets?: number;
  hobbyWeight: number;
  bdWeight: number;
  jumboWeight: number;
  hobbySlotCost: number;
  bdSlotCost: number;
  jumboSlotCost: number;
  totalCost: number;
  hobbyPerCase: number;
  bdPerCase: number;
  jumboPerCase: number;
  maxPay: number;
  pricingSource: 'live' | 'cached' | 'search-fallback' | 'cross-product' | 'default' | 'none';
  // CH batch-price-estimate confidence (0..1), sales-weighted across the
  // priced variants for this player_product. null when the row was built from
  // a fallback rung (search/sibling/default) — those don't have a modeled
  // confidence to report.
  confidence?: number | null;
  // Runtime-only score modulators applied before the engine clamps.
  // All default to 0 when undefined; not persisted in pricing_cache.
  // See lib/score-modulation.ts (risk + hype), lib/prospect-score.ts (Track A),
  // lib/cascading-sentiment.ts (Track B).
  risk_score_adj?: number;
  hype_score_adj?: number;
  prospect_score_adj?: number;
  cascade_score_adj?: number;
}

export interface PlayerProductVariant {
  id: string;
  player_product_id: string;
  variant_name: string;
  cardhedger_card_id: string | null;
  hobby_sets: number;
  bd_only_sets: number;
  jumbo_sets: number;
  match_confidence: number | null;
  hobby_odds: number | null;
  jumbo_odds: number | null;
  print_run: number | null;
}

export type Signal = 'BUY' | 'WATCH' | 'PASS';

export type TeamSlot = {
  team: string;
  playerCount: number;
  rookieCount: number;
  hobbySlotCost: number;
  bdSlotCost: number;
  jumboSlotCost: number;
  totalCost: number;
  hobbyPerCase: number;
  bdPerCase: number;
  jumboPerCase: number;
  maxPay: number;
  players: PlayerWithPricing[];
};

// --- Onboarding ---

export type ExperienceLevel = 'beginner' | 'casual' | 'regular' | 'serious';
export type MonthlySpend = 'under_150' | '150_500' | '500_1000' | '1000_5000' | '5000_plus';
export type ReferralSource = 'word_of_mouth' | 'youtube' | 'social_media' | 'google' | 'reddit' | 'referral' | 'other';
export type CollectingEra = 'modern' | '2010s' | '2000s' | '90s' | '80s_earlier';

// --- My Breaks ---

export type Platform =
  | 'fanatics_live'
  | 'whatnot'
  | 'ebay'
  | 'dave_adams'
  | 'layton_sports'
  | 'local_card_shop'
  | 'other';

export type BreakOutcome = 'win' | 'mediocre' | 'bust';
export type BreakStatus = 'pending' | 'completed' | 'abandoned';

export interface UserBreak {
  id: string;
  user_id: string;
  product_id: string;
  // Multi-team / multi-player / mixed-format shape (v2). Old single-team
  // columns (team, break_type, num_cases) still exist as nullable for
  // legacy rows but the app reads/writes only the new shape.
  teams: string[];
  extra_player_product_ids: string[];
  formats: { hobby: number; bd: number; jumbo: number };
  ask_price: number;
  platform: Platform;
  platform_other: string | null;
  snapshot_signal: Signal | null;
  snapshot_value_pct: number | null;
  snapshot_fair_value: number | null;
  snapshot_analysis: string | null;
  snapshot_top_players: Array<{ name: string; team?: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }> | null;
  snapshot_risk_flags: Array<{ playerName: string; flagType: string; note: string }> | null;
  snapshot_hv_players: string[] | null;
  outcome: BreakOutcome | null;
  outcome_notes: string | null;
  status: BreakStatus;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

// --- CardHedger API types ---

export interface CardHedgerPrice {
  grade: string;
  price: number;
  sold_count?: number;
}

export interface CardHedgerComp {
  sale_price: number;
  sale_date: string;
  grade: string;
  platform: string;
}

export interface CardHedgerCard {
  card_id: string;
  player_name: string;
  set_name: string;
  year: string;
  sport: string;
  card_number?: string;
}

// --- Chase Cards ---

export type ChaseCardType = 'chase_card' | 'chase_player';

export interface ChaseCard {
  id: string;
  product_id: string;
  player_product_id: string;
  type: ChaseCardType;
  display_name: string | null;
  odds_display: string | null;
  is_hit: boolean;
  hit_at: string | null;
  hit_reported_by: string | null;
  display_order: number;
  created_at: string;
  // joined
  player_product?: PlayerProduct & { player: Player };
}

// --- Player Comps (drawer) ---

export interface VariantWithPrices {
  id: string;
  variant_name: string;
  cardhedger_card_id: string | null;
  hobby_odds: number | null;
  breaker_odds: number | null;
  match_tier: string | null;
  // `method` + `confidence` are populated when prices come from CardHedger's
  // `/v1/cards/card-fmv-batch` (drawer surface, 2026-05-20). `method !== 'direct'`
  // means the price is a model estimate (segment fallback, anchor multiplier,
  // cross-grade interpolation, or stale price with movement index applied)
  // rather than a recent sale aggregate. UI uses this to dim estimated cells.
  prices: Array<{ grade: string; price: number; method?: string; confidence?: number | null }>;
}

export interface PlayerCompsResponse {
  player_name: string;
  team: string;
  variants: VariantWithPrices[];
  recentComps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }>;
}

// My Chase / Players Hub — see docs/my-chase.md
export interface ChaseListEntry {
  player_id: string;
  player_name: string;
  team: string | null;
  is_rookie: boolean;
  is_icon: boolean;
  buzz_score: number;
  breakerz_score: number;
  added_at: string;
  // Most recent EV signal across all of this player's player_products.
  // null when no pricing has landed yet for any of them.
  market: {
    ev_mid: number;
    product_id: string;
    product_slug: string;
    product_name: string;
    fetched_at: string;
  } | null;
  risk_flags: Array<{ flag_type: string; note: string }>;
}
