import type { PlayerWithPricing, BreakConfig, Signal, TeamSlot } from './types';

export function computeSlotPricing(
  players: PlayerWithPricing[],
  config: BreakConfig
): PlayerWithPricing[] {
  const eligible = players.filter(p => !p.insert_only);

  const totalHobbyWeight = eligible.reduce((sum, p) => sum + p.evMid * p.hobby_sets, 0);
  const totalBdWeight = eligible.reduce(
    (sum, p) => sum + p.evMid * (p.hobby_sets + p.bd_only_sets),
    0
  );

  const hobbyBreakCost = config.hobbyCases * config.hobbyCaseCost * (1 + config.breakerMargin);
  const bdBreakCost = config.bdCases * config.bdCaseCost * (1 + config.breakerMargin);

  return eligible.map(player => {
    const hobbyWeight = player.evMid * player.hobby_sets;
    const bdWeight = player.evMid * (player.hobby_sets + player.bd_only_sets);

    const hobbySlotCost =
      totalHobbyWeight > 0 ? hobbyBreakCost * (hobbyWeight / totalHobbyWeight) : 0;
    const bdSlotCost =
      totalBdWeight > 0 ? bdBreakCost * (bdWeight / totalBdWeight) : 0;
    const totalCost = hobbySlotCost + bdSlotCost;

    return {
      ...player,
      hobbyWeight,
      bdWeight,
      hobbySlotCost,
      bdSlotCost,
      totalCost,
      hobbyPerCase: config.hobbyCases > 0 ? hobbySlotCost / config.hobbyCases : 0,
      bdPerCase: config.bdCases > 0 ? bdSlotCost / config.bdCases : 0,
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
    const totalCost = hobbySlotCost + bdSlotCost;
    return {
      team,
      playerCount: players.length,
      rookieCount: players.filter(p => p.player?.is_rookie).length,
      hobbySlotCost,
      bdSlotCost,
      totalCost,
      hobbyPerCase: config.hobbyCases > 0 ? hobbySlotCost / config.hobbyCases : 0,
      bdPerCase: config.bdCases > 0 ? bdSlotCost / config.bdCases : 0,
      maxPay: totalCost * 1.5,
      players: players.sort((a, b) => (a.player?.name ?? '').localeCompare(b.player?.name ?? '')),
    };
  }).sort((a, b) => a.team.localeCompare(b.team));
}
