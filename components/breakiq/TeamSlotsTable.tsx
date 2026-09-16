'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency, computeEffectiveScore } from '@/lib/engine';
import { IconPlayerBadge, BullishBadge, BearishBadge, HighVolatilityBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import PricingFeedback from '@/components/breakiq/PricingFeedback';
import { ProspectRankChip, ProspectRankKey } from '@/components/breakiq/ds';
import { compositionSimilarity, recencyWeight, renderComposition } from '@/lib/observation-ranking';
import { compressionMarkups } from '@/lib/market-markup';
import type { AskingPriceObsRow, BreakFormat, SlotComposition, TeamSlot } from '@/lib/types';

type RiskFlagEntry = { flagType: string; note: string };

interface Props {
  teams: TeamSlot[];
  viewFormat: BreakFormat;
  riskFlagMap?: Map<string, RiskFlagEntry[]>;
  productId?: string | null;
  // Plan B: lifecycle-aware market markup. Model value × markup = the
  // market price a breaker should be charging. 1 = no markup.
  marketMarkup?: number;
  // Compression exponent (flag-gated). When set, the flat markup is
  // reallocated across teams (floor small, dampen big), conserving the total.
  // undefined = off. See docs/plans/2026-08-14-market-compression-markup.md.
  compressionGamma?: number;
  // Map keyed by team name to the raw asking-price observations for this
  // product. Each row is ranked against `targetComposition` and renders a
  // read-only sub-line under the team row — market context, not a deal check.
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
const COL = 'grid-cols-[36px_minmax(140px,1fr)_72px_56px_104px_104px_88px_88px_64px]';

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
  compressionGamma,
  askObservations,
  targetComposition,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Per-team compression markup (flag-gated). null = off → every row uses the
  // flat marketMarkup. Shares are over the current viewFormat's model slots;
  // the total is conserved so the break's overall ask is unchanged.
  const teamMarkups = compressionGamma != null
    ? compressionMarkups(teams.map(t => pickSlot(t, viewFormat).slot), marketMarkup, compressionGamma)
    : null;

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

  const hasProspects = teams.some(t => t.players.some(p => p.player?.prospect_rank != null && p.player.prospect_rank <= 100));

  return (
    <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      {hasProspects && (
        <div className="px-4 py-1.5 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
          <ProspectRankKey />
        </div>
      )}
      <div className="overflow-x-auto">
        {/* Header */}
        <div
          className={`grid ${COL} gap-3 px-4 py-2.5 border-b`}
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          {['#', 'Team', 'Players', 'RC', 'Model Value', 'Market Price', '/Case', 'Max Pay', ''].map((h, hi) => (
            <div key={hi} className="terminal-label">{h}</div>
          ))}
        </div>

        {/* Rows */}
        <div>
          {teams.map((row, i) => {
            const isOpen = expanded.has(row.team);
            const { slot: modelSlotCost, perCase: modelPerCase } = pickSlot(row, viewFormat);
            // Plan B: model value is the pure engine EV; market price is that
            // number with the breaker markup applied. rowMarkup is the per-team
            // compressed markup when the flag is on, else the flat one.
            const rowMarkup = teamMarkups ? teamMarkups[i] : marketMarkup;
            const slotCost = modelSlotCost * rowMarkup;
            const perCase  = modelPerCase  * rowMarkup;

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

            // Rank observed asks for this team against the active break-config
            // composition. Null when there are no observations or none survive
            // the composition/recency filter.
            const teamObs = askObservations?.get(row.team) ?? [];
            const ranked = (askObservations && targetComposition && teamObs.length > 0)
              ? rankObservations(teamObs, targetComposition)
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

                  {/* Players */}
                  <div className="flex items-center">
                    <span className="font-mono text-sm" style={{ color: 'var(--text-t-primary)' }}>{row.playerCount}</span>
                  </div>

                  {/* RC count */}
                  <div className="flex items-center">
                    {row.rookieCount > 0 && (
                      <span className="text-[10px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(127,168,201,0.15)', color: 'var(--accent-blue)' }}>
                        {row.rookieCount}
                      </span>
                    )}
                  </div>

                  {/* Model value — pure engine EV, before breaker markup */}
                  <div className="flex items-center">
                    <span className="font-mono text-sm" style={{ color: 'var(--text-t-secondary)' }}>
                      {formatCurrency(modelSlotCost)}
                    </span>
                  </div>

                  {/* Market price — what a breaker should be charging */}
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
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(127,168,201,0.15)', color: 'var(--accent-blue)' }}>RC</span>
                        )}
                        <ProspectRankChip
                          rank={p.player.prospect_rank}
                          source={p.player.prospect_rank_source}
                          updatedAt={p.player.prospect_rank_updated_at}
                        />
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
                      {/* Model value / market price for this player */}
                      <div className="flex items-center">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-t-tertiary)' }}>
                          {formatCurrency(viewFormat === 'hobby' ? p.hobbySlotCost : viewFormat === 'bd' ? p.bdSlotCost : p.jumboSlotCost)}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="font-mono text-xs" style={{ color: 'var(--text-t-secondary)' }}>
                          {formatCurrency((viewFormat === 'hobby' ? p.hobbySlotCost : viewFormat === 'bd' ? p.bdSlotCost : p.jumboSlotCost) * rowMarkup)}
                        </span>
                      </div>
                      {/* /Case, Max Pay, feedback — team-level only */}
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
