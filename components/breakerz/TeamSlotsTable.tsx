'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, computeSignal, formatPct } from '@/lib/engine';
import type { TeamSlot } from '@/lib/types';

interface Props {
  teams: TeamSlot[];
  breakType: 'hobby' | 'bd';
}

export default function TeamSlotsTable({ teams, breakType }: Props) {
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
              return (
                <>
                  <tr
                    key={row.team}
                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => toggle(row.team)}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">
                      <span className="mr-2 text-muted-foreground text-xs">{isOpen ? '▼' : '▶'}</span>
                      {row.team}
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
                  {isOpen && row.players.map(p => (
                    <tr key={p.id} className="border-b bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground text-xs font-mono" />
                      <td className="px-4 py-2 pl-10 text-sm text-muted-foreground">
                        {p.player.name}
                        {p.player.is_rookie && (
                          <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-primary border-primary">RC</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center font-mono text-xs text-muted-foreground">{p.total_sets}</td>
                      <td />
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {formatCurrency(isHobby ? p.hobbySlotCost : p.bdSlotCost)}
                      </td>
                      <td />
                      <td />
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
