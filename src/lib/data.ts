// CardPulse Break Analysis Engine - Static Data & Types

export interface TierConfig {
  tier: string;
  label: string;
  evLow: number;
  evMid: number;
  evHigh: number;
}

export interface Player {
  name: string;
  team: string;
  isRookie: boolean;
  tier: string;
  evOverride?: number;
  evLow: number;
  evMid: number;
  evHigh: number;
  hobbySets: number;
  bdOnlySets: number;
  totalSets: number;
  insertOnly?: boolean;
}

export interface BreakConfig {
  hobbyCases: number;
  bdCases: number;
  hobbyCaseCost: number;
  bdCaseCost: number;
  breakerMargin: number;
  ebayFeeRate: number;
  shippingPerCard: number;
}

export interface SlotPricing {
  player: Player;
  hobbyWeight: number;
  bdWeight: number;
  hobbySlotCost: number;
  bdSlotCost: number;
  totalCost: number;
  hobbyPerCase: number;
  bdPerCase: number;
  maxPay: number;
}

export interface BreakerComparison {
  player: Player;
  pricing: SlotPricing;
  breakerAsk: number;
  valuePct: number;
  signal: 'BUY' | 'WATCH' | 'PASS';
}

export const TIER_TABLE: TierConfig[] = [
  { tier: "S🔥", label: "S Hot", evLow: 7000, evMid: 21000, evHigh: 35000 },
  { tier: "S", label: "S", evLow: 5000, evMid: 13500, evHigh: 22000 },
  { tier: "A+", label: "A+", evLow: 3000, evMid: 7500, evHigh: 12000 },
  { tier: "A", label: "A", evLow: 2000, evMid: 5000, evHigh: 8000 },
  { tier: "A-", label: "A-", evLow: 1200, evMid: 3100, evHigh: 5000 },
  { tier: "B+", label: "B+", evLow: 700, evMid: 1850, evHigh: 3000 },
  { tier: "B", label: "B", evLow: 400, evMid: 950, evHigh: 1500 },
  { tier: "C", label: "C", evLow: 150, evMid: 375, evHigh: 600 },
];

// Sample player data based on 2025-26 Topps Finest Basketball
export const PLAYERS: Player[] = [
  { name: "Cooper Flagg", team: "Dallas Mavericks", isRookie: true, tier: "S🔥", evLow: 7000, evMid: 21000, evHigh: 35000, hobbySets: 2, bdOnlySets: 2, totalSets: 4 },
  { name: "Kon Knueppel", team: "Los Angeles Lakers", isRookie: true, tier: "A+", evOverride: 12000, evLow: 3000, evMid: 12000, evHigh: 20000, hobbySets: 2, bdOnlySets: 2, totalSets: 4 },
  { name: "Dylan Harper", team: "New Jersey Nets", isRookie: true, tier: "A+", evLow: 3000, evMid: 7500, evHigh: 12000, hobbySets: 2, bdOnlySets: 2, totalSets: 4 },
  { name: "Ace Bailey", team: "Houston Rockets", isRookie: true, tier: "A+", evLow: 3000, evMid: 7500, evHigh: 12000, hobbySets: 2, bdOnlySets: 2, totalSets: 4 },
  { name: "Nolan Traore", team: "Cleveland Cavaliers", isRookie: true, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 2, bdOnlySets: 2, totalSets: 4 },
  { name: "Zaccharie Risacher", team: "Atlanta Hawks", isRookie: true, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 2, bdOnlySets: 1, totalSets: 3 },
  { name: "Alex Sarr", team: "Washington Wizards", isRookie: true, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 2, bdOnlySets: 1, totalSets: 3 },
  { name: "Stephon Castle", team: "San Antonio Spurs", isRookie: true, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 2, bdOnlySets: 1, totalSets: 3 },
  { name: "Dalton Knecht", team: "Los Angeles Lakers", isRookie: true, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 2, bdOnlySets: 1, totalSets: 3 },
  { name: "Matas Buzelis", team: "Chicago Bulls", isRookie: true, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 2, bdOnlySets: 0, totalSets: 2 },
  { name: "Reed Sheppard", team: "Houston Rockets", isRookie: true, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 2, bdOnlySets: 0, totalSets: 2 },
  { name: "Nikola Jovic", team: "Miami Heat", isRookie: false, tier: "B+", evLow: 700, evMid: 1850, evHigh: 3000, hobbySets: 1, bdOnlySets: 1, totalSets: 2 },
  { name: "Jalen Williams", team: "Oklahoma City Thunder", isRookie: false, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Anthony Edwards", team: "Minnesota Timberwolves", isRookie: false, tier: "S", evLow: 5000, evMid: 13500, evHigh: 22000, hobbySets: 1, bdOnlySets: 1, totalSets: 2 },
  { name: "Luka Doncic", team: "Dallas Mavericks", isRookie: false, tier: "S", evLow: 5000, evMid: 13500, evHigh: 22000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Victor Wembanyama", team: "San Antonio Spurs", isRookie: false, tier: "S", evLow: 5000, evMid: 13500, evHigh: 22000, hobbySets: 1, bdOnlySets: 1, totalSets: 2 },
  { name: "Ja Morant", team: "Memphis Grizzlies", isRookie: false, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Chet Holmgren", team: "Oklahoma City Thunder", isRookie: false, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Jayson Tatum", team: "Boston Celtics", isRookie: false, tier: "A", evLow: 2000, evMid: 5000, evHigh: 8000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "LeBron James", team: "Los Angeles Lakers", isRookie: false, tier: "S", evLow: 5000, evMid: 13500, evHigh: 22000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Tyrese Maxey", team: "Philadelphia 76ers", isRookie: false, tier: "B+", evLow: 700, evMid: 1850, evHigh: 3000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Paolo Banchero", team: "Orlando Magic", isRookie: false, tier: "A-", evLow: 1200, evMid: 3100, evHigh: 5000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Brandon Miller", team: "Charlotte Hornets", isRookie: false, tier: "B+", evLow: 700, evMid: 1850, evHigh: 3000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "Dereck Lively II", team: "Dallas Mavericks", isRookie: false, tier: "B+", evLow: 700, evMid: 1850, evHigh: 3000, hobbySets: 1, bdOnlySets: 0, totalSets: 1 },
  { name: "VJ Edgecombe", team: "Indiana Pacers", isRookie: true, tier: "B", evLow: 400, evMid: 950, evHigh: 1500, hobbySets: 0, bdOnlySets: 0, totalSets: 0, insertOnly: true },
];

export const DEFAULT_BREAK_CONFIG: BreakConfig = {
  hobbyCases: 10,
  bdCases: 10,
  hobbyCaseCost: 3840,
  bdCaseCost: 11500,
  breakerMargin: 0.25,
  ebayFeeRate: 0.13,
  shippingPerCard: 6,
};
