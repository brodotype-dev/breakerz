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
  sport?: Sport;
}

export interface Player {
  id: string;
  name: string;
  sport_id: string;
  team: string;
  is_rookie: boolean;
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
  player?: Player;
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
  pricingSource: 'live' | 'cached' | 'none';
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
