import type { PlayerWithPricing, BreakConfig, Signal, TeamSlot } from './types';

// Exported for use in UI components that need to display buzz signals
export function computeEffectiveScore(
  buzzScore: number | null | undefined,
  breakerzScore: number | null | undefined,
  isIcon: boolean
): number {
  if (isIcon) return 0;
  return Math.max(-0.9, Math.min(1.0, (buzzScore ?? 0) + (breakerzScore ?? 0)));
}

export function computeSlotPricing(
  players: PlayerWithPricing[],
  config: BreakConfig
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
      : Math.max(-0.9, Math.min(1.0, (p.buzz_score ?? 0) + (p.breakerz_score ?? 0)));
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

  return eligible.map(player => {
    const hobbyWeight = hobbyWeightFor(player);
    const jumboWeight = jumboWeightFor(player);
    const bdWeight = player.evMid;

    const hobbySlotCost =
      totalHobbyWeight > 0 ? hobbyBreakCost * (hobbyWeight / totalHobbyWeight) : 0;
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
