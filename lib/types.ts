// Database types matching Supabase schema

export interface Sport {
  id: string;
  name: string;
  slug: string;
}

export interface Product {
  id: string;
  sport_id: string;
  name: string;
  slug: string;
  manufacturer: string;
  year: string;
  hobby_case_cost: number;
  bd_case_cost: number | null;
  hobby_autos_per_case: number;
  bd_autos_per_case: number | null;
  is_active: boolean;
  has_odds: boolean;
  release_date: string | null; // ISO date string (YYYY-MM-DD)
  sport?: Sport;
}

export interface Player {
  id: string;
  name: string;
  sport_id: string;
  team: string;
  is_rookie: boolean;
  is_icon: boolean;
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
  hobbyCaseCost: number;
  bdCaseCost: number;
}

export interface PlayerWithPricing extends PlayerProduct {
  player: Player;
  evLow: number;
  evMid: number;
  evHigh: number;
  hobbyEVPerBox: number;  // odds-weighted: Σ(variantEV × 1/hobby_odds); falls back to evMid if no odds
  hobbyWeight: number;
  bdWeight: number;
  hobbySlotCost: number;
  bdSlotCost: number;
  totalCost: number;
  hobbyPerCase: number;
  bdPerCase: number;
  maxPay: number;
  pricingSource: 'live' | 'cached' | 'search-fallback' | 'cross-product' | 'default' | 'none';
}

export interface PlayerProductVariant {
  id: string;
  player_product_id: string;
  variant_name: string;
  cardhedger_card_id: string | null;
  hobby_sets: number;
  bd_only_sets: number;
  match_confidence: number | null;
  hobby_odds: number | null;
}

export type Signal = 'BUY' | 'WATCH' | 'PASS';

export type TeamSlot = {
  team: string;
  playerCount: number;
  rookieCount: number;
  hobbySlotCost: number;
  bdSlotCost: number;
  totalCost: number;
  hobbyPerCase: number;
  bdPerCase: number;
  maxPay: number;
  players: PlayerWithPricing[];
};

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
  team: string;
  break_type: 'hobby' | 'bd';
  num_cases: number;
  ask_price: number;
  platform: Platform;
  platform_other: string | null;
  snapshot_signal: Signal | null;
  snapshot_value_pct: number | null;
  snapshot_fair_value: number | null;
  snapshot_analysis: string | null;
  snapshot_top_players: Array<{ name: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }> | null;
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
