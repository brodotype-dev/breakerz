'use client';

import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/engine';
import type { PlayerWithPricing } from '@/lib/types';

interface Props {
  players: PlayerWithPricing[];
}

export default function PlayerTable({ players }: Props) {
  if (players.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-muted-foreground">
        No players found for this product. Add players via the Supabase dashboard.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {['#', 'Player', 'Team', 'Sets', 'EV Low', 'EV Mid', 'EV High', 'Hobby Slot', 'BD Slot', 'Total', 'Max Pay', 'Source'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((row, i) => (
              <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">{i + 1}</td>
                <td className="px-4 py-2.5 font-medium">
                  {row.player.name}
                  {row.player.is_rookie && (
                    <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 text-primary border-primary">RC</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{row.player.team}</td>
                <td className="px-4 py-2.5 text-center font-mono">{row.total_sets}</td>
                <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(row.evLow)}</td>
                <td className="px-4 py-2.5 font-mono font-semibold">{formatCurrency(row.evMid)}</td>
                <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(row.evHigh)}</td>
                <td className="px-4 py-2.5 font-mono">{formatCurrency(row.hobbySlotCost)}</td>
                <td className="px-4 py-2.5 font-mono">{formatCurrency(row.bdSlotCost)}</td>
                <td className="px-4 py-2.5 font-mono font-semibold">{formatCurrency(row.totalCost)}</td>
                <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatCurrency(row.maxPay)}</td>
                <td className="px-4 py-2.5">
                  <SourceBadge source={row.pricingSource} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: 'live' | 'cached' | 'none' }) {
  if (source === 'live') return <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px]">Live</Badge>;
  if (source === 'cached') return <Badge variant="secondary" className="text-[10px]">Cached</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">No data</Badge>;
}
