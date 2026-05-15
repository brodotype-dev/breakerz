'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import posthog from 'posthog-js';
import { formatCurrency, computeSignal, formatPct, computeEffectiveScore } from '@/lib/engine';
import SignalBadge from '@/components/breakiq/SignalBadge';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import PricingFeedback from '@/components/breakiq/PricingFeedback';
import { compositionSimilarity, recencyWeight, renderComposition } from '@/lib/observation-ranking';
import { PH_EVENTS } from '@/lib/posthog-events';
import type { AskingPriceObsRow, BreakFormat, SlotComposition, TeamSlot } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  teams: TeamSlot[];
  viewFormat: BreakFormat;
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
  productId?: string | null;
  // Plan B: lifecycle-aware market markup applied to slot cost at display.
  // 1 = no markup. computeSignal is run against the market-adjusted number.
  marketMarkup?: number;
  // Step #3 — side-by-side comparison. Map keyed by team name to the raw
  // asking-price observations for this product. Each row gets ranked
  // against `targetComposition` and renders a sub-line under the team row
  // when ≥1 ranked observation survives the composition/recency filter.
  askObservations?: Map<string, AskingPriceObsRow[]>;
  // Active break-config composition used to rank observations. Pass the
  // result of `configToComposition({hobby, bd, jumbo})` from the page.
  targetComposition?: SlotComposition;
}

// Top-N ranked observations to fold into the displayed range. Beyond 5,
// the range stops moving meaningfully and the row text starts wrapping.
const MAX_DISPLAYED_OBSERVATIONS = 5;

// Pure: rank + filter observations for one team. Returns null when no
// observation survives (composition mismatch / aged out / empty input).
function rankObservations(
  rows: AskingPriceObsRow[],
  target: SlotComposition,
  now: Date = new Date(),
) {
  const ranked = rows
    .map(r => {
      const sim = compositionSimilarity(target, r.payload.composition);
      const rec = recencyWeight(r.observed_at, now);
      return { row: r, similarity: sim, recency: rec, score: sim * rec };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const top = ranked.slice(0, MAX_DISPLAYED_OBSERVATIONS);
  const prices = top.flatMap(t => [t.row.payload.price_low, t.row.payload.price_high]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Median price = midpoint of the top-ranked observation. Used for the
  // "Use $X" prefill pill — the highest-confidence single number we can
  // surface without faking precision.
  const topRow = top[0].row;
  const prefillPrice = Math.round((topRow.payload.price_low + topRow.payload.price_high) / 2);
  const listings = top.filter(t => t.row.payload.source_type === 'competitor_listing').length;
  const estimates = top.filter(t => t.row.payload.source_type === 'breaker_estimate').length;
  const sales = top.filter(t => t.row.payload.source_type === 'historical_sale').length;
  const mostRecent = top[0].row.observed_at;
  const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(mostRecent)) / 86_400_000));
  // Distinct composition labels surface when observations span a mix.
  const compLabels = Array.from(new Set(top.map(t => renderComposition(t.row.payload.composition))));
  return {
    count: top.length,
    min,
    max,
    prefillPrice,
    listings,
    estimates,
    sales,
    ageDays,
    compLabels,
    topSourceType: topRow.payload.source_type,
  };
}

// `minmax(140px, 1fr)` keeps the Team column from collapsing to 0 when the
// fixed columns + gaps exceed the viewport (was happening on iPhone 16 Pro,
// leaving only the chevron visible). The outer overflow-x-auto wrapper then
// scrolls the full grid horizontally instead.
const COL = 'grid-cols-[36px_minmax(140px,1fr)_160px_72px_56px_104px_88px_88px_64px]';

function pickSlot(t: TeamSlot, fmt: BreakFormat) {
  return fmt === 'hobby' ? { slot: t.hobbySlotCost, perCase: t.hobbyPerCase }
    : fmt === 'bd'       ? { slot: t.bdSlotCost,    perCase: t.bdPerCase }
    :                      { slot: t.jumboSlotCost, perCase: t.jumboPerCase };
}

export default function TeamSlotsTable({
  teams,
  viewFormat,
  riskFlagMap = new Map(),
  productId = null,
  marketMarkup = 1,
  askObservations,
  targetComposition,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [askPrices, setAskPrices] = useState<Record<string, string>>({});
  const showMarketMarkup = marketMarkup !== 1;

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
          {['#', 'Team', 'Break Price / Signal', 'Players', 'RC', 'Slot Cost', '/Case', 'Max Pay', ''].map((h, hi) => (
            <div key={hi} className="terminal-label">{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div>
          {teams.map((row, i) => {
            const isOpen = expanded.has(row.team);
            const { slot: modelSlotCost, perCase: modelPerCase } = pickSlot(row, viewFormat);
            // Plan B: market-adjusted slot drives display + signal; model EV
            // is shown beneath as a sub-line for transparency.
            const slotCost = modelSlotCost * marketMarkup;
            const perCase  = modelPerCase  * marketMarkup;
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

            // Step #3 — rank observed asks for this team against the
            // active break-config composition. Null when there are no
            // observations or none survive the composition/recency filter.
            const teamObs = askObservations?.get(row.team) ?? [];
            const ranked = (askObservations && targetComposition && teamObs.length > 0)
              ? rankObservations(teamObs, targetComposition)
              : null;
            const herdDelta = (ranked && askRaw && !isNaN(askNum) && ranked.prefillPrice > 0)
              ? ((askNum - ranked.prefillPrice) / ranked.prefillPrice) * 100
              : null;

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

                  {/* Slot cost (market-adjusted; model EV below) */}
                  <div className="flex flex-col justify-center leading-tight">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-t-primary)' }}>
                      {formatCurrency(slotCost)}
                    </span>
                    {showMarketMarkup && modelSlotCost > 0 && (
                      <span className="font-mono text-[10px]" style={{ color: 'var(--text-t-tertiary)' }}>
                        model {formatCurrency(modelSlotCost)}
                      </span>
                    )}
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

                  {/* Pricing feedback */}
                  <div className="flex items-center justify-end" onClick={e => e.stopPropagation()}>
                    <PricingFeedback
                      surface="team_row"
                      entityType="team"
                      entityId={row.team}
                      productId={productId}
                    />
                  </div>
                </div>

                {/* Step #3 — observed-asks sub-row. Only rendered when at
                    least one observation matched the target composition and
                    is within the lookback window. Spans the grid; indented
                    so it visually nests under the team cell. */}
                {ranked && (
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b text-[11px] font-mono"
                    style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-bg)', color: 'var(--text-t-tertiary)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <span style={{ color: 'var(--text-t-secondary)' }}>
                      Breakers asked{' '}
                      <span style={{ color: 'var(--text-t-primary)' }}>
                        {ranked.min === ranked.max
                          ? formatCurrency(ranked.min)
                          : `${formatCurrency(ranked.min)}–${formatCurrency(ranked.max)}`}
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      {ranked.count} {ranked.count === 1 ? 'obs' : 'obs'}
                      {(ranked.listings + ranked.estimates + ranked.sales) > 0 && (
                        <span style={{ color: 'var(--text-t-tertiary)' }}>
                          {' '}({[
                            ranked.listings > 0 ? `${ranked.listings} listing${ranked.listings === 1 ? '' : 's'}` : null,
                            ranked.estimates > 0 ? `${ranked.estimates} estimate${ranked.estimates === 1 ? '' : 's'}` : null,
                            ranked.sales > 0 ? `${ranked.sales} sale${ranked.sales === 1 ? '' : 's'}` : null,
                          ].filter(Boolean).join(', ')})
                        </span>
                      )}
                    </span>
                    <span>·</span>
                    <span>{ranked.ageDays === 0 ? 'today' : ranked.ageDays === 1 ? '1d ago' : `${ranked.ageDays}d ago`}</span>
                    {ranked.compLabels.length > 0 && ranked.compLabels.some(l => l.includes('+')) && (
                      <>
                        <span>·</span>
                        <span style={{ color: 'var(--text-t-tertiary)' }}>{ranked.compLabels.join(' / ')}</span>
                      </>
                    )}
                    {/* "Use $X" pre-fill pill — fires PostHog + sets the
                        team's ask input to the top-ranked observation's
                        median price. */}
                    <button
                      type="button"
                      onClick={() => {
                        setAskPrices(prev => ({ ...prev, [row.team]: String(ranked.prefillPrice) }));
                        try {
                          posthog.capture(PH_EVENTS.observed_ask_prefilled, {
                            product_id: productId,
                            team: row.team,
                            prefilled_price: ranked.prefillPrice,
                            observation_count: ranked.count,
                            source_type: ranked.topSourceType,
                          });
                        } catch { /* posthog optional */ }
                      }}
                      className="ml-auto px-2 py-0.5 rounded border text-[11px] font-mono transition-colors"
                      style={{
                        borderColor: 'var(--terminal-border-hover)',
                        backgroundColor: 'var(--terminal-surface)',
                        color: 'var(--accent-blue)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--terminal-surface-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--terminal-surface)')}
                    >
                      Use {formatCurrency(ranked.prefillPrice)}
                    </button>
                    {herdDelta !== null && (
                      <span
                        className="px-1.5 py-0.5 rounded"
                        style={{
                          color: Math.abs(herdDelta) < 5 ? 'var(--text-t-tertiary)'
                            : herdDelta > 0 ? '#ef4444' : '#22c55e',
                          backgroundColor: 'var(--terminal-surface)',
                        }}
                        title="Your typed ask vs. herd median"
                      >
                        vs herd: {formatPct(herdDelta)}
                      </span>
                    )}
                  </div>
                )}

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
                      {/* Slot cost for this player (market-adjusted) */}
                      <div className="flex items-center">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-t-tertiary)' }}>
                          {formatCurrency((viewFormat === 'hobby' ? p.hobbySlotCost : viewFormat === 'bd' ? p.bdSlotCost : p.jumboSlotCost) * marketMarkup)}
                        </span>
                      </div>
                      <div />
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
