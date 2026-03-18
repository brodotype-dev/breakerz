'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/engine';
import type { TeamSlot } from '@/lib/types';

interface Props {
  teams: TeamSlot[];
}

export default function TeamSlotsTable({ teams }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {['#', 'Team', 'Players', 'RC', 'Hobby Slot', '/Case', 'BD Slot', '/Case', 'Total', 'Max Pay'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((row, i) => {
              const isOpen = expanded.has(row.team);
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
                    <td className="px-4 py-2.5 text-center font-mono">{row.playerCount}</td>
                    <td className="px-4 py-2.5 text-center">
                      {row.rookieCount > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-primary border-primary">
                          {row.rookieCount}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono">{formatCurrency(row.hobbySlotCost)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">{formatCurrency(row.hobbyPerCase)}</td>
                    <td className="px-4 py-2.5 font-mono">{formatCurrency(row.bdSlotCost)}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground text-xs">{formatCurrency(row.bdPerCase)}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold">{formatCurrency(row.totalCost)}</td>
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
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{formatCurrency(p.hobbySlotCost)}</td>
                      <td />
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{formatCurrency(p.bdSlotCost)}</td>
                      <td />
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{formatCurrency(p.totalCost)}</td>
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
