'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, computeSignal, formatPct, computeEffectiveScore } from '@/lib/engine';
import type { TeamSlot } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

const FLAG_COLORS: Record<string, string> = {
  injury:     'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  suspension: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  legal:      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  trade:      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  retirement: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  off_field:  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
};
const FLAG_LABELS: Record<string, string> = {
  injury: 'Injury', suspension: 'Suspension', legal: 'Legal',
  trade: 'Trade', retirement: 'Retirement', off_field: 'Off-field',
};

interface Props {
  teams: TeamSlot[];
  breakType: 'hobby' | 'bd';
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
}

export default function TeamSlotsTable({ teams, breakType, riskFlagMap = new Map() }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [askPrices, setAskPrices] = useState<Record<string, string>>({});

  if (teams.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-muted-foreground">
        No team data available. Player pricing must be loaded first.
      </div>
    );
  }

  const toggle = (team: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  };

  const isHobby = breakType === 'hobby';

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {['#', 'Team', 'Current Break Price', 'Players', 'RC', 'Slot Cost', '/Case', 'Max Pay'].map(h => (
                <th
                  key={h}
                  className={`px-4 py-2.5 text-left text-xs uppercase tracking-wider font-medium whitespace-nowrap ${
                    h === 'Current Break Price'
                      ? 'text-[oklch(0.28_0.08_250)] bg-blue-50 dark:bg-blue-950/20'
                      : 'text-muted-foreground'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((row, i) => {
              const isOpen = expanded.has(row.team);
              const slotCost = isHobby ? row.hobbySlotCost : row.bdSlotCost;
              const perCase  = isHobby ? row.hobbyPerCase  : row.bdPerCase;
              const askRaw = askPrices[row.team] ?? '';
              const askNum = parseFloat(askRaw);
              const dealCheck = askRaw && !isNaN(askNum) && slotCost > 0
                ? computeSignal(slotCost, askNum)
                : null;
              const signalColors = {
                BUY: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300',
                WATCH: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300',
                PASS: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300',
              };

              // Compute team-level Social Currency signals
              const teamScores = row.players.map(p =>
                computeEffectiveScore(p.buzz_score, p.breakerz_score, p.player?.is_icon ?? false)
              );
              const maxScore = Math.max(...teamScores);
              const minScore = Math.min(...teamScores);
              const hasBullish = maxScore > 0.1;
              const hasBearish = minScore < -0.1;
              const hasIcon = row.players.some(p => p.player?.is_icon);
              const hasHV = row.players.some(p => p.is_high_volatility);
              const teamFlags = row.players.flatMap(p => riskFlagMap.get(p.id) ?? []);
              const hasFlags = teamFlags.length > 0;

              return (
                <>
                  <tr
                    key={row.team}
                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => toggle(row.team)}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="mr-1 text-muted-foreground text-xs">{isOpen ? '▼' : '▶'}</span>
                        <span>{row.team}</span>
                        {hasIcon && (
                          <span title="Icon-tier player on this team" className="text-[9px] font-black px-1 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 leading-none">★</span>
                        )}
                        {hasBullish && (
                          <span title={`Breakerz bullish (score: +${maxScore.toFixed(2)})`} className="text-[9px] font-black px-1 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 leading-none">↑</span>
                        )}
                        {hasBearish && (
                          <span title={`Breakerz bearish (score: ${minScore.toFixed(2)})`} className="text-[9px] font-black px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 leading-none">↓</span>
                        )}
                        {hasHV && (
                          <span title="High Volatility — EV may shift significantly" className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 leading-none">⚡</span>
                        )}
                        {hasFlags && (
                          <span title={teamFlags.map(f => `${FLAG_LABELS[f.flagType] ?? f.flagType}: ${f.note}`).join(' · ')} className="text-[9px] font-black px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 leading-none">⚑</span>
                        )}
                      </div>
                    </td>
                    {/* Current Break Price — highlighted column */}
                    <td className="px-4 py-2.5 bg-blue-50/50 dark:bg-blue-950/10" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs font-mono pointer-events-none select-none">$</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={askRaw}
                          onChange={e => setAskPrices(prev => ({ ...prev, [row.team]: e.target.value }))}
                          className="w-20 text-xs font-mono px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                        />
                        {dealCheck && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${signalColors[dealCheck.signal]}`}>
                            {dealCheck.signal} {formatPct(dealCheck.valuePct)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono">{row.playerCount}</td>
                    <td className="px-4 py-2.5 text-center">
                      {row.rookieCount > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-primary border-primary">
                          {row.rookieCount}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold">{formatCurrency(slotCost)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">{formatCurrency(perCase)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(row.maxPay)}</td>
                  </tr>
                  {isOpen && row.players.map(p => {
                    const playerFlags = riskFlagMap.get(p.id) ?? [];
                    const score = computeEffectiveScore(p.buzz_score, p.breakerz_score, p.player?.is_icon ?? false);
                    return (
                      <tr key={p.id} className="border-b bg-muted/20">
                        <td className="px-4 py-2 text-muted-foreground text-xs font-mono" />
                        <td className="px-4 py-2 pl-10 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{p.player.name}</span>
                            {p.player.is_rookie && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 text-primary border-primary">RC</Badge>
                            )}
                            {p.player.is_icon && (
                              <span title="Icon-tier player" className="text-[8px] font-black px-1 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 leading-none">★</span>
                            )}
                            {score > 0.1 && (
                              <span title={`Breakerz bullish (+${score.toFixed(2)})`} className="text-[8px] font-black px-1 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 leading-none">↑</span>
                            )}
                            {score < -0.1 && (
                              <span title={`Breakerz bearish (${score.toFixed(2)})`} className="text-[8px] font-black px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 leading-none">↓</span>
                            )}
                            {p.is_high_volatility && (
                              <span title="High Volatility" className="text-[8px] px-1 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400 leading-none">⚡</span>
                            )}
                            {playerFlags.map((f, fi) => (
                              <span key={fi} title={f.note} className={`text-[8px] font-bold px-1 py-0.5 rounded leading-none ${FLAG_COLORS[f.flagType] ?? 'bg-red-100 text-red-700'}`}>
                                {FLAG_LABELS[f.flagType] ?? f.flagType}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center font-mono text-xs text-muted-foreground">{p.total_sets}</td>
                        <td />
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {formatCurrency(isHobby ? p.hobbySlotCost : p.bdSlotCost)}
                        </td>
                        <td />
                        <td />
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
