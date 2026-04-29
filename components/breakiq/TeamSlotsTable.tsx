'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency, computeSignal, formatPct, computeEffectiveScore } from '@/lib/engine';
import SignalBadge from '@/components/breakiq/SignalBadge';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import type { BreakFormat, TeamSlot } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  teams: TeamSlot[];
  viewFormat: BreakFormat;
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
}

const COL = 'grid-cols-[36px_1fr_160px_72px_56px_104px_88px_88px]';

function pickSlot(t: TeamSlot, fmt: BreakFormat) {
  return fmt === 'hobby' ? { slot: t.hobbySlotCost, perCase: t.hobbyPerCase }
    : fmt === 'bd'       ? { slot: t.bdSlotCost,    perCase: t.bdPerCase }
    :                      { slot: t.jumboSlotCost, perCase: t.jumboPerCase };
}

export default function TeamSlotsTable({ teams, viewFormat, riskFlagMap = new Map() }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [askPrices, setAskPrices] = useState<Record<string, string>>({});

  if (teams.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-t-secondary)' }}>
        No team data available. Fetch pricing first.
      </div>
    );
  }

  const toggle = (team: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(team) ? next.delete(team) : next.add(team);
      return next;
    });
  };

  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="overflow-x-auto">
        {/* Header */}
        <div
          className={`grid ${COL} gap-3 px-4 py-2.5 border-b`}
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          {['#', 'Team', 'Break Price / Signal', 'Players', 'RC', 'Slot Cost', '/Case', 'Max Pay'].map(h => (
            <div key={h} className="terminal-label">{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div>
          {teams.map((row, i) => {
            const isOpen = expanded.has(row.team);
            const { slot: slotCost, perCase } = pickSlot(row, viewFormat);
            const askRaw = askPrices[row.team] ?? '';
            const askNum = parseFloat(askRaw);
            const dealCheck = askRaw && !isNaN(askNum) && slotCost > 0
              ? computeSignal(slotCost, askNum)
              : null;

            const teamScores = row.players.map(p =>
              computeEffectiveScore(p.buzz_score, p.breakerz_score, p.player?.is_icon ?? false)
            );
            const maxScore = Math.max(...teamScores);
            const minScore = Math.min(...teamScores);
            const hasIcon    = row.players.some(p => p.player?.is_icon);
            const hasBullish = maxScore > 0.1;
            const hasBearish = minScore < -0.1;
            const hasHV      = row.players.some(p => p.is_high_volatility);
            const teamFlags  = row.players.flatMap(p => riskFlagMap.get(p.id) ?? []);

            return (
              <div key={row.team}>
                {/* Team row */}
                <div
                  className={`grid ${COL} gap-3 px-4 py-2.5 border-b cursor-pointer transition-colors`}
                  style={{ borderColor: 'var(--terminal-border)' }}
                  onClick={() => toggle(row.team)}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--terminal-surface-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                >
                  {/* Rank */}
                  <div className="flex items-center">
                    <span className="font-mono text-xs" style={{ color: 'var(--text-t-tertiary)' }}>{i + 1}</span>
                  </div>

                  {/* Team */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isOpen
                      ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-t-tertiary)' }} />
                      : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-t-tertiary)' }} />
                    }
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-t-primary)' }}>{row.team}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {hasIcon    && <IconPlayerBadge />}
                      {hasBullish && <BullishBadge />}
                      {hasBearish && <BearishBadge />}
                      {hasHV      && <HighVolatilityBadge />}
                      {teamFlags.length > 0 && <RiskFlagBadge type={teamFlags[0].flagType} note={teamFlags.map(f => f.note).join(' · ')} />}
                    </div>
                  </div>

                  {/* Price input + signal */}
                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-mono" style={{ color: 'var(--text-t-tertiary)' }}>$</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={askRaw}
                        onChange={e => setAskPrices(prev => ({ ...prev, [row.team]: e.target.value }))}
                        className="w-full pl-5 pr-2 py-1 text-xs font-mono rounded border focus:outline-none"
                        style={{
                          backgroundColor: 'var(--terminal-bg)',
                          borderColor: 'var(--terminal-border-hover)',
                          color: 'var(--text-t-primary)',
                        }}
                        onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
                        onBlur={e => (e.target.style.borderColor = 'var(--terminal-border-hover)')}
                      />
                    </div>
                    {dealCheck && <SignalBadge signal={dealCheck.signal} size="sm" valuePct={dealCheck.valuePct} />}
                  </div>

                  {/* Players */}
                  <div className="flex items-center">
                    <span className="font-mono text-sm" style={{ color: 'var(--text-t-primary)' }}>{row.playerCount}</span>
                  </div>

                  {/* RC count */}
                  <div className="flex items-center">
                    {row.rookieCount > 0 && (
                      <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}>
                        {row.rookieCount}
                      </span>
                    )}
                  </div>

                  {/* Slot cost */}
                  <div className="flex items-center">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-t-primary)' }}>
                      {formatCurrency(slotCost)}
                    </span>
                  </div>

                  {/* /Case */}
                  <div className="flex items-center">
                    <span className="font-mono text-xs" style={{ color: 'var(--text-t-secondary)' }}>
                      {formatCurrency(perCase)}
                    </span>
                  </div>

                  {/* Max pay */}
                  <div className="flex items-center">
                    <span className="font-mono text-sm" style={{ color: '#22c55e' }}>
                      {formatCurrency(row.maxPay)}
                    </span>
                  </div>
                </div>

                {/* Expanded player rows */}
                {isOpen && row.players.map(p => {
                  const playerFlags = riskFlagMap.get(p.id) ?? [];
                  const score = computeEffectiveScore(p.buzz_score, p.breakerz_score, p.player?.is_icon ?? false);
                  return (
                    <div
                      key={p.id}
                      className={`grid ${COL} gap-3 px-4 py-2 border-b`}
                      style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)' }}
                    >
                      <div />
                      <div className="flex items-center gap-1.5 pl-5 min-w-0">
                        <span className="text-xs truncate" style={{ color: 'var(--text-t-secondary)' }}>{p.player.name}</span>
                        {p.player.is_rookie && (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}>RC</span>
                        )}
                        {p.player.is_icon    && <IconPlayerBadge />}
                        {score > 0.1         && <BullishBadge />}
                        {score < -0.1        && <BearishBadge />}
                        {p.is_high_volatility && <HighVolatilityBadge />}
                        {playerFlags.map((f, fi) => (
                          <RiskFlagBadge key={fi} type={f.flagType} note={f.note} />
                        ))}
                      </div>
                      <div />
                      <div />
                      <div />
                      {/* Slot cost for this player */}
                      <div className="flex items-center">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-t-tertiary)' }}>
                          {formatCurrency(viewFormat === 'hobby' ? p.hobbySlotCost : viewFormat === 'bd' ? p.bdSlotCost : p.jumboSlotCost)}
                        </span>
                      </div>
                      <div />
                      <div />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
