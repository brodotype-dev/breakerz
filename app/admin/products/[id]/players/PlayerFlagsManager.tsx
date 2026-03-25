'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setPlayerIcon,
  setPlayerHighVolatility,
  addPlayerRiskFlag,
  clearPlayerRiskFlag,
} from '../../actions';

const FLAG_TYPES = [
  { value: 'injury',     label: 'Injury',     color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'suspension', label: 'Suspension', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  { value: 'legal',      label: 'Legal',      color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  { value: 'trade',      label: 'Trade',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  { value: 'retirement', label: 'Retirement', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  { value: 'off_field',  label: 'Off-field',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
] as const;

type FlagType = typeof FLAG_TYPES[number]['value'];

export interface PlayerRow {
  playerProductId: string;
  playerId: string;
  name: string;
  team: string;
  isIcon: boolean;
  isHighVolatility: boolean;
  activeFlags: Array<{ id: string; flagType: string; note: string }>;
}

interface Props {
  productId: string;
  players: PlayerRow[];
}

const flagColorMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.color]));
const flagLabelMap = new Map<string, string>(FLAG_TYPES.map(f => [f.value, f.label]));

export default function PlayerFlagsManager({ productId, players }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newFlagType, setNewFlagType] = useState<FlagType>('injury');
  const [newFlagNote, setNewFlagNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function toggleIcon(playerId: string, current: boolean) {
    setBusyId(playerId);
    await setPlayerIcon(productId, playerId, !current);
    setBusyId(null);
    refresh();
  }

  async function toggleHV(playerProductId: string, current: boolean) {
    setBusyId(playerProductId + '-hv');
    await setPlayerHighVolatility(productId, playerProductId, !current);
    setBusyId(null);
    refresh();
  }

  async function handleAddFlag(playerProductId: string) {
    if (!newFlagNote.trim()) return;
    setBusyId(playerProductId + '-flag');
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

  if (players.length === 0) return null;

  return (
    <div className="space-y-1">
      {players.map(pp => {
        const isExpanded = expandedId === pp.playerProductId;

        return (
          <div key={pp.playerProductId} className="rounded border bg-card overflow-hidden">
            <div className="px-3 py-2 flex items-center gap-2">

              {/* Name + team */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-sm font-medium truncate">{pp.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{pp.team}</span>
              </div>

              {/* Active flags */}
              <div className="flex items-center gap-1 flex-wrap">
                {pp.activeFlags.map(flag => (
                  <span
                    key={flag.id}
                    title={flag.note}
                    className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${flagColorMap.get(flag.flagType) ?? 'bg-gray-100 text-gray-700'}`}
                  >
                    {flagLabelMap.get(flag.flagType)}
                    <button
                      onClick={() => handleClearFlag(flag.id)}
                      disabled={busyId === flag.id}
                      className="opacity-60 hover:opacity-100 leading-none ml-0.5"
                      title="Clear flag"
                    >
                      ×
                    </button>
                  </span>
                ))}

                {/* Add flag toggle */}
                <button
                  onClick={() => {
                    setExpandedId(isExpanded ? null : pp.playerProductId);
                    setNewFlagNote('');
                  }}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground transition-colors uppercase tracking-wide"
                >
                  ⚑ Flag
                </button>
              </div>

              {/* HV toggle */}
              <button
                onClick={() => toggleHV(pp.playerProductId, pp.isHighVolatility)}
                disabled={busyId === pp.playerProductId + '-hv'}
                title={pp.isHighVolatility ? 'High Volatility on — click to remove' : 'Mark as High Volatility'}
                className={`text-base px-1.5 py-0.5 rounded transition-colors ${
                  pp.isHighVolatility
                    ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                    : 'text-muted-foreground/25 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20'
                }`}
              >
                ⚡
              </button>

              {/* Icon toggle */}
              <button
                onClick={() => toggleIcon(pp.playerId, pp.isIcon)}
                disabled={busyId === pp.playerId}
                title={pp.isIcon ? 'Icon-tier — click to remove' : 'Mark as icon-tier (skips buzz multiplier)'}
                className={`text-base px-1.5 py-0.5 rounded transition-colors ${
                  pp.isIcon
                    ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400'
                    : 'text-muted-foreground/25 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-950/20'
                }`}
              >
                ★
              </button>
            </div>

            {/* Inline add-flag form */}
            {isExpanded && (
              <div className="border-t px-3 py-2.5 bg-muted/30 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={newFlagType}
                    onChange={e => setNewFlagType(e.target.value as FlagType)}
                    className="text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)] shrink-0"
                  >
                    {FLAG_TYPES.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Consumer note — factual, past tense, include source + date"
                    value={newFlagNote}
                    onChange={e => setNewFlagNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddFlag(pp.playerProductId)}
                    className="flex-1 text-xs px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                  />
                  <button
                    onClick={() => handleAddFlag(pp.playerProductId)}
                    disabled={!newFlagNote.trim() || busyId === pp.playerProductId + '-flag'}
                    className="text-xs font-bold px-3 py-1.5 rounded bg-[oklch(0.28_0.08_250)] text-white disabled:opacity-30"
                  >
                    {busyId === pp.playerProductId + '-flag' ? '…' : 'Add'}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Example: "Torn ACL, out for season (ESPN, March 2026)"
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
