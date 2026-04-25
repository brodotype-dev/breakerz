'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, X, Star, Zap } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  setPlayerIcon,
  setPlayerHighVolatility,
  addPlayerRiskFlag,
  clearPlayerRiskFlag,
} from '../../actions';

const FLAG_TYPES = [
  { value: 'injury', label: 'Injury', tone: 'amber' },
  { value: 'suspension', label: 'Suspension', tone: 'red' },
  { value: 'legal', label: 'Legal', tone: 'red' },
  { value: 'trade', label: 'Trade', tone: 'blue' },
  { value: 'retirement', label: 'Retirement', tone: 'gray' },
  { value: 'off_field', label: 'Off-field', tone: 'orange' },
] as const;

type FlagType = typeof FLAG_TYPES[number]['value'];

const flagToneStyles: Record<string, { bg: string; text: string }> = {
  amber: { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b' },
  red: { bg: 'rgba(239, 68, 68, 0.12)', text: '#ef4444' },
  blue: { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6' },
  gray: { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8' },
  orange: { bg: 'rgba(249, 115, 22, 0.12)', text: '#f97316' },
};

const flagLabelMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.label]));
const flagToneMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.tone]));

export interface PlayerRow {
  playerProductId: string;
  playerId: string;
  name: string;
  team: string;
  isRookie: boolean;
  hobbySets: number;
  bdOnlySets: number;
  insertOnly: boolean;
  isIcon: boolean;
  isHighVolatility: boolean;
  activeFlags: Array<{ id: string; flagType: string; note: string }>;
}

interface Props {
  productId: string;
  players: PlayerRow[];
}

export default function PlayersManager({ productId, players }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [showInsertOnly, setShowInsertOnly] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newFlagType, setNewFlagType] = useState<FlagType>('injury');
  const [newFlagNote, setNewFlagNote] = useState('');

  const refresh = () => startTransition(() => router.refresh());

  async function toggleIcon(playerId: string, current: boolean) {
    setBusyId(playerId + ':icon');
    await setPlayerIcon(productId, playerId, !current);
    setBusyId(null);
    refresh();
  }

  async function toggleHV(playerProductId: string, current: boolean) {
    setBusyId(playerProductId + ':hv');
    await setPlayerHighVolatility(productId, playerProductId, !current);
    setBusyId(null);
    refresh();
  }

  async function handleAddFlag(playerProductId: string) {
    if (!newFlagNote.trim()) return;
    setBusyId(playerProductId + ':flag');
    await addPlayerRiskFlag(productId, playerProductId, newFlagType, newFlagNote);
    setBusyId(null);
    setExpandedId(null);
    setNewFlagNote('');
    refresh();
  }

  async function handleClearFlag(flagId: string) {
    setBusyId(flagId);
    await clearPlayerRiskFlag(productId, flagId);
    setBusyId(null);
    refresh();
  }

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

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="inline-flex items-center gap-1">
          <Star className="w-3 h-3" style={{ color: '#a855f7' }} />
          Icon · skips buzz multiplier
        </span>
        <span className="inline-flex items-center gap-1">
          <Zap className="w-3 h-3" style={{ color: '#f59e0b' }} />
          High Volatility
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
          Risk Flag · consumer-visible
        </span>
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
                <TableHead className="w-[100px]">Team</TableHead>
                <TableHead className="w-[50px] text-center">RC</TableHead>
                <TableHead className="w-[60px] text-center">Hobby</TableHead>
                <TableHead className="w-[50px] text-center">BD</TableHead>
                <TableHead className="w-[60px] text-center">Insert</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="w-[60px] text-center">HV</TableHead>
                <TableHead className="w-[60px] text-center">Icon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => {
                const isExpanded = expandedId === p.playerProductId;
                return (
                  <Fragment key={p.playerProductId}>
                    <TableRow>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.team || '—'}</TableCell>
                      <TableCell className="text-center text-sm">{p.isRookie ? '✓' : ''}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.hobbySets}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{p.bdOnlySets}</TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {p.insertOnly ? '✓' : ''}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {p.activeFlags.map(flag => {
                            const tone = flagToneStyles[flagToneMap.get(flag.flagType) ?? 'gray'];
                            return (
                              <span
                                key={flag.id}
                                title={flag.note}
                                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
                                style={{ backgroundColor: tone.bg, color: tone.text }}
                              >
                                {flagLabelMap.get(flag.flagType) ?? flag.flagType}
                                <button
                                  onClick={() => handleClearFlag(flag.id)}
                                  disabled={busyId === flag.id}
                                  className="opacity-60 hover:opacity-100 leading-none"
                                  title="Clear flag"
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                          <button
                            onClick={() => {
                              const opening = !isExpanded;
                              setExpandedId(opening ? p.playerProductId : null);
                              setNewFlagNote('');
                              if (opening) setNewFlagType('injury');
                            }}
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors uppercase tracking-wide"
                          >
                            <Plus className="w-2.5 h-2.5" /> Flag
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => toggleHV(p.playerProductId, p.isHighVolatility)}
                          disabled={busyId === p.playerProductId + ':hv'}
                          title={p.isHighVolatility ? 'High Volatility on — click to remove' : 'Mark as High Volatility'}
                          className="inline-flex items-center justify-center w-7 h-7 rounded transition-colors"
                          style={{
                            backgroundColor: p.isHighVolatility ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                            color: p.isHighVolatility ? '#f59e0b' : 'var(--text-disabled)',
                          }}
                        >
                          <Zap className="w-4 h-4" fill={p.isHighVolatility ? 'currentColor' : 'none'} />
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => toggleIcon(p.playerId, p.isIcon)}
                          disabled={busyId === p.playerId + ':icon'}
                          title={p.isIcon ? 'Icon-tier — click to remove' : 'Mark as icon-tier (skips buzz multiplier)'}
                          className="inline-flex items-center justify-center w-7 h-7 rounded transition-colors"
                          style={{
                            backgroundColor: p.isIcon ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                            color: p.isIcon ? '#a855f7' : 'var(--text-disabled)',
                          }}
                        >
                          <Star className="w-4 h-4" fill={p.isIcon ? 'currentColor' : 'none'} />
                        </button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/20">
                          <div className="flex flex-col gap-2 py-1">
                            <div className="flex gap-2">
                              <select
                                value={newFlagType}
                                onChange={e => setNewFlagType(e.target.value as FlagType)}
                                className="text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)] shrink-0"
                              >
                                {FLAG_TYPES.map(f => (
                                  <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="Consumer note — factual, past tense, source + date"
                                value={newFlagNote}
                                onChange={e => setNewFlagNote(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddFlag(p.playerProductId)}
                                className="flex-1 text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                              />
                              <button
                                onClick={() => handleAddFlag(p.playerProductId)}
                                disabled={!newFlagNote.trim() || busyId === p.playerProductId + ':flag'}
                                className="text-xs font-bold px-3 py-1.5 rounded text-white disabled:opacity-30"
                                style={{ background: 'var(--gradient-blue)' }}
                              >
                                {busyId === p.playerProductId + ':flag' ? '…' : 'Add'}
                              </button>
                              <button
                                onClick={() => { setExpandedId(null); setNewFlagNote(''); }}
                                className="text-xs px-2 py-1.5 rounded border text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Example: "Torn ACL, out for season (ESPN, March 2026)"
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
