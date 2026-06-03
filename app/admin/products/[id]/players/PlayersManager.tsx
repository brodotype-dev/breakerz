'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Product roster (read-only). Player-global attributes — icon tier,
// high-volatility, risk flags — moved to /admin/players in the 2026-06-02
// re-model, so this view is just "who's in this product".

export interface PlayerRow {
  playerProductId: string;
  playerId: string;
  name: string;
  team: string;
  isRookie: boolean;
  hobbySets: number;
  bdOnlySets: number;
  insertOnly: boolean;
}

interface Props {
  players: PlayerRow[];
}

export default function PlayersManager({ players }: Props) {
  const [search, setSearch] = useState('');
  const [showInsertOnly, setShowInsertOnly] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter(p => {
      if (!showInsertOnly && p.insertOnly) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q);
    });
  }, [players, search, showInsertOnly]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-[240px] h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by player or team…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <label
          className="flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium cursor-pointer select-none"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <input
            type="checkbox"
            checked={showInsertOnly}
            onChange={e => setShowInsertOnly(e.target.checked)}
            className="cursor-pointer"
          />
          Include insert-only
        </label>

        <div
          className="flex items-baseline gap-1.5 h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <span className="font-mono text-sm font-bold">{filtered.length}</span>
          <span className="text-xs text-muted-foreground">of {players.length}</span>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center text-sm"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)' }}
        >
          {players.length === 0 ? 'No players added yet.' : 'No players match your search.'}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[120px]">Team</TableHead>
                <TableHead className="w-[70px] text-center">Hobby</TableHead>
                <TableHead className="w-[60px] text-center">BD</TableHead>
                <TableHead className="w-[70px] text-center">Insert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => (
                <TableRow key={p.playerProductId}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{p.name}</span>
                      {p.isRookie && (
                        <span
                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                          style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
                          title="Rookie card"
                        >
                          RC
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.team || '—'}</TableCell>
                  <TableCell className="text-center font-mono text-sm">{p.hobbySets}</TableCell>
                  <TableCell className="text-center font-mono text-sm">{p.bdOnlySets}</TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {p.insertOnly ? '✓' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
