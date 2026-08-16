'use client';

import { use, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Search, Plus, X } from 'lucide-react';
import posthog from 'posthog-js';
import PlayerTable from '@/components/breakiq/PlayerTable';
import TeamSlotsTable from '@/components/breakiq/TeamSlotsTable';
import TopMoversWidget from '@/components/breakiq/TopMoversWidget';
import ChaseCardsPanel from '@/components/breakiq/ChaseCardsPanel';
import PlayerDetailDrawer from '@/components/breakiq/PlayerDetailDrawer';
import PreReleaseLayout from '@/components/breakiq/PreReleaseLayout';
import TeamChip from '@/components/breakiq/TeamChip';
import AnalysisResultPanel from '@/components/breakiq/AnalysisResultPanel';
import { SegmentedControl, CounterInput, LargeCTAButton, InfoTip } from '@/components/breakiq/ds';
import { computeSlotPricing, computeTeamSlotPricing, formatCurrency } from '@/lib/engine';
import { computePlayerPyp } from '@/lib/player-pyp-pricing';
import { getMarketMarkup } from '@/lib/market-markup';
import { PH_EVENTS } from '@/lib/posthog-events';
import type { AnalysisResult as AnalysisResultShape } from '@/lib/analysis';
import type { AskingPriceObsRow, BreakConfig, BreakFormat } from '@/lib/types';
import type { BreakPageData, ProductWithSport } from '@/lib/break-page-data';

const FORMAT_DEFS: Array<{ key: BreakFormat; label: string; short: string }> = [
  { key: 'hobby', label: 'Hobby',              short: 'Hobby' },
  { key: 'jumbo', label: 'Jumbo',              short: 'Jumbo' },
  { key: 'bd',    label: "Breaker's Delight",  short: 'BD' },
];

interface BreakPageClientProps {
  product: ProductWithSport;
  dataPromise: Promise<BreakPageData>;
  // Compression exponent (flag-gated, server-resolved). undefined = off →
  // slot tables apply the flat markup unchanged. See
  // docs/plans/2026-08-14-market-compression-markup.md.
  compressionGamma?: number;
}

export default function BreakPageClient({ product, dataPromise, compressionGamma }: BreakPageClientProps) {
  // ─── Suspense unwrap ───────────────────────────────────────────────────
  // React 19's `use()` hook: throws while the promise is pending (which
  // surfaces the parent <Suspense>'s fallback), resolves to the data
  // when settled. The cached server function in lib/break-page-data.ts
  // means second visits in the same 60s window are near-instant.
  const data = use(dataPromise);
  const { rawPlayers, chaseCards, riskFlagRecord, hypeObsRows, askingPriceObsRows, variantsByPlayerProductId } = data;

  // riskFlagMap as an actual Map (children expect Map; record is for
  // JSON serialization across the server/client boundary)
  const riskFlagMap = useMemo(() => new Map(Object.entries(riskFlagRecord)), [riskFlagRecord]);

  // ─── Product-derived constants (stable across the page lifetime) ───────
  const hobbyMsrp   = product.hobby_case_cost ?? null;
  const hobbyAmPrice = product.hobby_am_case_cost ?? null;
  const bdMsrp      = product.bd_case_cost ?? null;
  const bdAmPrice   = product.bd_am_case_cost ?? null;
  const jumboMsrp   = product.jumbo_case_cost ?? null;
  const jumboAmPrice = product.jumbo_am_case_cost ?? null;

  // ─── Interactive state ─────────────────────────────────────────────────
  const [config, setConfig] = useState<BreakConfig>(() => ({
    hobbyCases: 10,
    bdCases: 0,
    jumboCases: 0,
    hobbyCaseCost: hobbyAmPrice ?? hobbyMsrp ?? 0,
    bdCaseCost: bdAmPrice ?? bdMsrp ?? 0,
    jumboCaseCost: jumboAmPrice ?? jumboMsrp ?? 0,
  }));

  const [viewFormat, setViewFormat] = useState<BreakFormat>('hobby');
  const [activeTab, setActiveTab] = useState<'teams' | 'players'>('teams');
  const [activePlayerProductId, setActivePlayerProductId] = useState<string | null>(null);
  const [drawerTop, setDrawerTop] = useState(48);
  const mainRef = useRef<HTMLDivElement>(null);

  // Inline analysis block state — mirrors /analysis page. Format counters
  // reuse the existing `config` state since it also drives the slot tables
  // below; selecting "1 Hobby + 0 BD" here is the same as selecting "1
  // Hobby" on /analysis.
  const [selectedAnalysisTeams, setSelectedAnalysisTeams] = useState<string[]>([]);
  const [selectedAnalysisPlayerIds, setSelectedAnalysisPlayerIds] = useState<string[]>([]);
  const [analysisAskPrice, setAnalysisAskPrice] = useState('');
  const [analysisPlayerSearch, setAnalysisPlayerSearch] = useState('');
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResultShape | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // ─── Drawer scroll-offset tracking (browser-only) ─────────────────────
  useLayoutEffect(() => {
    const NAV_H = 48;
    function update() {
      if (mainRef.current) {
        const top = mainRef.current.getBoundingClientRect().top;
        setDrawerTop(Math.max(NAV_H, top));
      }
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // ─── Engine computations ──────────────────────────────────────────────
  const players = useMemo(() => computeSlotPricing(rawPlayers, config), [rawPlayers, config]);
  const teamSlots = useMemo(() => computeTeamSlotPricing(players, config), [players, config]);

  const pricedCount = players.filter(p => p.pricingSource !== 'none').length;
  const hasPricing = pricedCount > 0;
  const estimatedCount = players.filter(p =>
    p.pricingSource === 'search-fallback' || p.pricingSource === 'cross-product' || p.pricingSource === 'default'
  ).length;

  // Lifecycle drives layout. release_date is informational (countdown).
  // Default to 'live' for products that pre-date the lifecycle column.
  const lifecycle = (product.lifecycle_status ?? 'live') as 'pre_release' | 'live' | 'dormant';
  const isPreRelease = lifecycle === 'pre_release';
  const isDormant = lifecycle === 'dormant';

  // PYP (Pick Your Player) prediction. Fair-value EV model — see
  // lib/player-pyp-pricing.ts. Column only renders when the product
  // publishes per-variant hobby_odds densely enough that the model has
  // signal; Panini / odds-less products skip it cleanly. Recomputes
  // reactively as the user changes hobby case count.
  const variantsMap = useMemo(() => {
    const m = new Map<string, Array<{ hobby_odds: number | null }>>();
    for (const [ppId, variants] of Object.entries(variantsByPlayerProductId)) m.set(ppId, variants);
    return m;
  }, [variantsByPlayerProductId]);
  const pypTable = useMemo(
    () => computePlayerPyp(rawPlayers, variantsMap, config, product.hobby_autos_per_case ?? null, lifecycle),
    [rawPlayers, variantsMap, config, product.hobby_autos_per_case, lifecycle],
  );

  // Step #3 — side-by-side comparison. Bucket the team-scoped asking-price
  // observations so TeamSlotsTable can render them next to each row, and
  // distill the active break-config into a composition vector so the
  // observations get ranked correctly when the user is configuring a mixed
  // bundle (e.g. 10 hobby + 5 bd matches "delight/hobby" captures more
  // strongly than pure-hobby ones).
  const askObservationsByTeam = useMemo(() => {
    const m = new Map<string, AskingPriceObsRow[]>();
    for (const o of askingPriceObsRows) {
      if (o.scope_type !== 'team' || !o.scope_team) continue;
      const arr = m.get(o.scope_team) ?? [];
      arr.push(o);
      m.set(o.scope_team, arr);
    }
    return m;
  }, [askingPriceObsRows]);

  const targetComposition = useMemo(() => {
    const out: Partial<Record<BreakFormat, number | null>> = {};
    if (config.hobbyCases > 0) out.hobby = config.hobbyCases;
    if (config.bdCases > 0)    out.bd    = config.bdCases;
    if (config.jumboCases > 0) out.jumbo = config.jumboCases;
    return out;
  }, [config.hobbyCases, config.bdCases, config.jumboCases]);

  // Sport gradient for pre-release layout chips (re-derived here so we
  // don't pass another prop down — pure function of product.sport.name)
  const sportName = product.sport?.name ?? '';
  const { primary, gradient } = useMemo(() => getSportStyle(sportName), [sportName]);

  // Reset selected analysis state when active tab changes? No — keep state
  // sticky across tab switches (matches existing behavior).

  // ─── PRE-RELEASE PATH ─────────────────────────────────────────────────
  if (isPreRelease) {
    // Phase 2: when a baseline exists (players sourced from pre_release_base_ev),
    // render a projected slot board ALONGSIDE the chase/hype layout. Sentiment
    // (via computeSlotPricing) + market markup + compression all apply. No
    // baseline → just the chase layout, exactly as before (self-gating).
    const hasBoard = players.some(p => p.pricingSource === 'pre_release_baseline');
    return (
      <div className="space-y-5">
        <PreReleaseLayout
          product={product}
          chaseCards={chaseCards}
          players={rawPlayers}
          riskFlagMap={riskFlagMap}
          hypeObs={hypeObsRows}
          askingPriceObs={askingPriceObsRows}
          sportPrimary={primary}
          sportGradient={gradient}
        />

        {hasBoard && (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Projected Slot Pricing</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
                Estimated from last cycle + our read — there are no live sales yet. Refines to real pricing the moment the product releases. Our sentiment and market shaping are already baked in.
              </p>
            </div>
            <div className="flex gap-1">
              {(['teams', 'players'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={
                    activeTab === tab
                      ? { backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }
                      : { color: 'var(--text-t-secondary)', border: '1px solid var(--terminal-border)' }
                  }
                >
                  {tab === 'teams' ? 'Teams' : 'Players'}
                </button>
              ))}
            </div>
            {activeTab === 'teams' ? (
              <TeamSlotsTable
                teams={teamSlots}
                viewFormat={viewFormat}
                riskFlagMap={riskFlagMap}
                productId={product.id}
                marketMarkup={getMarketMarkup(lifecycle)}
                compressionGamma={compressionGamma}
                askObservations={askObservationsByTeam}
                targetComposition={targetComposition}
              />
            ) : (
              <PlayerTable
                players={players}
                viewFormat={viewFormat}
                riskFlagMap={riskFlagMap}
                productId={product.id}
                marketMarkup={getMarketMarkup(lifecycle)}
                compressionGamma={compressionGamma}
                pypByPlayerProductId={pypTable.byPlayerProductId}
                showPyp={pypTable.oddsCoverageOk}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── LIVE / DORMANT PATH ──────────────────────────────────────────────
  return (
    <div ref={mainRef} className="space-y-5">
      {/* Data-driven status banners — moved from the hero so the hero can
          stay server-rendered. Live/dormant content depends on pricing
          data (estimated count, has-pricing) so these live in the client. */}
      {estimatedCount > 0 && (
        <div className="px-3 sm:px-4 py-2 flex items-center gap-2 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <span className="text-[10px]" style={{ color: '#f59e0b' }}>▲</span>
          <p className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>
            {estimatedCount} player{estimatedCount !== 1 ? 's' : ''} using estimated pricing — approximations based on historical comps.
          </p>
        </div>
      )}
      {hasPricing && (
        <div className="px-3 sm:px-4 py-2 flex items-center gap-2 rounded" style={{ backgroundColor: 'rgba(148,163,184,0.05)', border: '1px solid var(--terminal-border)' }}>
          <span className="text-[10px]" style={{ color: 'var(--text-t-tertiary)' }}>◎</span>
          <p className="text-[11px]" style={{ color: 'var(--text-t-tertiary)' }}>
            EV values reflect <strong>raw</strong> card sale prices. Graded (PSA 9 / PSA 10) comps are not included — per-player graded drilldown coming soon.
          </p>
        </div>
      )}

      {/* Summary bar — priced count + view format toggle. Moved here from
          the hero so it appears only once pricing data has streamed in. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {hasPricing && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
              <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ backgroundColor: 'var(--signal-buy)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{pricedCount}/{players.length} priced</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>
            View Format
          </div>
          <SegmentedControl
            value={viewFormat}
            onChange={v => setViewFormat(v as BreakFormat)}
            options={FORMAT_DEFS
              .filter(f => (f.key === 'hobby' ? hobbyMsrp != null : f.key === 'bd' ? bdMsrp != null : jumboMsrp != null))
              .map(f => ({ value: f.key, label: f.short }))}
          />
        </div>
      </div>

      <ChaseCardsPanel chaseCards={chaseCards} />
      <TopMoversWidget players={rawPlayers} />

      {!hasPricing && (
        <div
          className="rounded-lg border border-dashed p-6"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <p className="font-semibold text-sm mb-0.5" style={{ color: 'var(--text-t-primary)' }}>
            Pricing not yet available
          </p>
          <p className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>
            This product was hydrated recently. Pricing refreshes nightly at 4&nbsp;AM UTC — check back shortly.
          </p>
        </div>
      )}

      {/* Break Analysis — configure format mix + teams + player slots, set
          an ask price, run the same bundle analysis as /analysis without
          leaving the product. The format counters here also drive the
          slot tables below (single source of truth on `config`). */}
      {!isDormant && (() => {
        const formatMeta: Record<BreakFormat, { cases: number; setCases: (v: number) => void; cost: number; amPrice: number | null; msrp: number | null }> = {
          hobby: {
            cases: config.hobbyCases,
            setCases: v => setConfig(prev => ({ ...prev, hobbyCases: v })),
            cost: config.hobbyCaseCost,
            amPrice: hobbyAmPrice,
            msrp: hobbyMsrp,
          },
          bd: {
            cases: config.bdCases,
            setCases: v => setConfig(prev => ({ ...prev, bdCases: v })),
            cost: config.bdCaseCost,
            amPrice: bdAmPrice,
            msrp: bdMsrp,
          },
          jumbo: {
            cases: config.jumboCases,
            setCases: v => setConfig(prev => ({ ...prev, jumboCases: v })),
            cost: config.jumboCaseCost,
            amPrice: jumboAmPrice,
            msrp: jumboMsrp,
          },
        };
        const availableFormats = FORMAT_DEFS.filter(f => formatMeta[f.key].msrp != null || formatMeta[f.key].amPrice != null);
        if (availableFormats.length === 0) return null;
        const totalBreakCost = availableFormats.reduce((sum, f) => sum + formatMeta[f.key].cases * formatMeta[f.key].cost, 0);

        // Team list comes from the loaded roster — same source the team slot
        // table below uses, so the user sees only teams that exist in this
        // product.
        const uniqueTeams = Array.from(new Set(rawPlayers.map(p => p.player?.team).filter(Boolean))).sort() as string[];

        // Filter players for the picker: hide already-selected, hide teams
        // already covered by a selected team (avoid double-counting), apply
        // free-text search, cap to 8 visible.
        const q = analysisPlayerSearch.trim().toLowerCase();
        const selectedTeamSet = new Set(selectedAnalysisTeams);
        const filteredPlayers = rawPlayers
          .filter(p => !selectedAnalysisPlayerIds.includes(p.id))
          .filter(p => !selectedTeamSet.has(p.player?.team ?? ''))
          .filter(p => !q || p.player?.name.toLowerCase().includes(q) || p.player?.team.toLowerCase().includes(q))
          .slice(0, 8);

        const totalCases = config.hobbyCases + config.bdCases + config.jumboCases;
        const hasSelection = selectedAnalysisTeams.length > 0 || selectedAnalysisPlayerIds.length > 0;
        const askPriceNum = parseFloat(analysisAskPrice);
        const askPriceValid = !Number.isNaN(askPriceNum) && askPriceNum > 0;
        const canRunAnalysis = hasSelection && askPriceValid && totalCases > 0 && !analysisRunning;

        function toggleTeam(t: string) {
          setSelectedAnalysisTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
        }
        function addPlayer(id: string) {
          setSelectedAnalysisPlayerIds(prev => prev.includes(id) ? prev : [...prev, id]);
          setAnalysisPlayerSearch('');
        }
        function removePlayer(id: string) {
          setSelectedAnalysisPlayerIds(prev => prev.filter(x => x !== id));
        }

        async function runAnalysis() {
          if (!canRunAnalysis) return;
          setAnalysisRunning(true);
          setAnalysisResult(null);
          setAnalysisError(null);
          try {
            const res = await fetch('/api/analysis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                productId: product.id,
                teams: selectedAnalysisTeams,
                extraPlayerProductIds: selectedAnalysisPlayerIds,
                formats: { hobby: config.hobbyCases, bd: config.bdCases, jumbo: config.jumboCases },
                askPrice: askPriceNum,
              }),
            });
            const dataResp = await res.json();
            if (dataResp.error) throw new Error(dataResp.error);
            posthog.capture(PH_EVENTS.break_analysis_run, {
              product_id: product.id,
              teams: selectedAnalysisTeams,
              extra_player_count: selectedAnalysisPlayerIds.length,
              formats: { hobby: config.hobbyCases, bd: config.bdCases, jumbo: config.jumboCases },
              ask_price: askPriceNum,
              signal: dataResp.signal,
              value_pct: dataResp.valuePct,
              fair_value: dataResp.fairValue,
              surface: 'break_page_inline',
            });
            setAnalysisResult(dataResp as AnalysisResultShape);
          } catch (err) {
            posthog.captureException(err);
            setAnalysisError(err instanceof Error ? err.message : 'Unknown error');
          } finally {
            setAnalysisRunning(false);
          }
        }

        return (
          <div
            className="px-4 py-4 rounded-lg space-y-5"
            style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
                <span className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  Break Analysis
                </span>
              </div>
              {totalBreakCost > 0 && (
                <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  Break cost: {formatCurrency(totalBreakCost)}
                </span>
              )}
            </div>

            {/* Format mix */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Format mix
                <InfoTip text="How many cases of each break type (Hobby / Jumbo / Breaker's Delight)." />
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {availableFormats.map(({ key, short }) => {
                  const m = formatMeta[key];
                  const priceLabel = m.amPrice != null ? 'market' : m.msrp != null ? 'MSRP' : null;
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 px-3 py-2 rounded border" style={{ borderColor: 'var(--terminal-border)' }}>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--text-tertiary)' }}>{short}</span>
                        {m.cost > 0 && (
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                            {formatCurrency(m.cost)}{priceLabel ? ` (${priceLabel})` : ''}
                          </span>
                        )}
                      </div>
                      <CounterInput value={m.cases} onChange={m.setCases} min={0} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Teams */}
            {uniqueTeams.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Teams / PYT</p>
                <div className="flex flex-wrap gap-2">
                  {uniqueTeams.map(t => (
                    <TeamChip
                      key={t}
                      team={t}
                      sport={sportName}
                      selected={selectedAnalysisTeams.includes(t)}
                      onClick={() => toggleTeam(t)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Specific player slots */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Player Slots - PTP <span className="font-normal opacity-60">(Optional)</span>
              </p>
              {selectedAnalysisPlayerIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedAnalysisPlayerIds.map(id => {
                    const p = rawPlayers.find(x => x.id === id);
                    if (!p) return null;
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-semibold border"
                        style={{
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          color: 'var(--text-primary)',
                          borderColor: 'rgba(59, 130, 246, 0.4)',
                        }}
                      >
                        {p.player.name}
                        <span className="opacity-60 text-[10px] font-normal">{p.player.team}</span>
                        <button
                          onClick={() => removePlayer(id)}
                          className="w-4 h-4 inline-flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                          aria-label="Remove player"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Search by player name or team…"
                  value={analysisPlayerSearch}
                  onChange={e => setAnalysisPlayerSearch(e.target.value)}
                  className="w-full h-10 text-sm rounded-lg border pl-9 pr-3 focus:outline-none"
                  style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                />
              </div>
              {q.length > 0 && filteredPlayers.length > 0 && (
                <div className="mt-2 border rounded-lg overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
                  {filteredPlayers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => addPlayer(p.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:opacity-80 transition-opacity border-b last:border-b-0"
                      style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                    >
                      <span className="flex items-center gap-2">
                        <Plus className="w-3 h-3 opacity-60" />
                        <span>{p.player.name}</span>
                        {p.player.is_rookie && (
                          <span className="text-[9px] px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>RC</span>
                        )}
                      </span>
                      <span className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>{p.player.team}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Ask price */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Total ask price</p>
              <div className="relative max-w-xs">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-mono font-bold pointer-events-none" style={{ color: 'var(--text-secondary)' }}>$</span>
                <input
                  type="number"
                  placeholder="0"
                  value={analysisAskPrice}
                  onChange={e => setAnalysisAskPrice(e.target.value)}
                  disabled={!hasSelection}
                  className="w-full h-12 text-xl font-mono font-bold rounded-lg border-2 pl-9 pr-3 focus:outline-none transition-all disabled:opacity-40"
                  style={{ backgroundColor: 'var(--terminal-bg)', borderColor: analysisAskPrice ? 'var(--accent-blue)' : 'var(--terminal-border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Run */}
            <LargeCTAButton onClick={runAnalysis} disabled={!canRunAnalysis} loading={analysisRunning}>
              {analysisRunning ? 'Reading the comps…' : <><Sparkles className="w-5 h-5" /> Run the check</>}
            </LargeCTAButton>

            {/* Inline result */}
            {analysisError && (
              <div className="rounded-lg p-4 text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid var(--signal-pass)', color: 'var(--signal-pass)' }}>
                {analysisError}
              </div>
            )}
            {analysisResult && !analysisRunning && (
              <div className="pt-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
                <AnalysisResultPanel result={analysisResult} productId={product.id} />
              </div>
            )}
          </div>
        );
      })()}

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
        {(['teams', 'players'] as const).map(tab => {
          const label = tab === 'teams' ? 'Team Slots' : 'Player Slots';
          const count = tab === 'teams' ? teamSlots.length : players.length;
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold transition-all"
              style={{
                backgroundColor: active ? 'var(--terminal-surface-hover)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: active ? '1px solid var(--terminal-border-hover)' : '1px solid transparent',
              }}
            >
              {label}
              {count !== null && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: active ? 'var(--accent-blue)' : 'var(--terminal-border)',
                    color: active ? 'white' : 'var(--text-tertiary)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === 'teams' && (
          <TeamSlotsTable
            teams={teamSlots}
            viewFormat={viewFormat}
            riskFlagMap={riskFlagMap}
            productId={product.id}
            marketMarkup={getMarketMarkup(lifecycle)}
            compressionGamma={compressionGamma}
            askObservations={askObservationsByTeam}
            targetComposition={targetComposition}
          />
        )}
        {activeTab === 'players' && (
          <PlayerTable
            players={players}
            viewFormat={viewFormat}
            riskFlagMap={riskFlagMap}
            onPlayerClick={id => setActivePlayerProductId(id)}
            productId={product.id}
            marketMarkup={getMarketMarkup(lifecycle)}
            compressionGamma={compressionGamma}
            pypByPlayerProductId={pypTable.byPlayerProductId}
            showPyp={pypTable.oddsCoverageOk}
          />
        )}
      </div>

      <PlayerDetailDrawer
        playerProductId={activePlayerProductId}
        onClose={() => setActivePlayerProductId(null)}
        topOffset={drawerTop}
        audit={{
          row: activePlayerProductId
            ? players.find(p => p.id === activePlayerProductId) ?? null
            : null,
          productLifecycle: lifecycle,
          liveSince: product.live_since ?? null,
          marketMarkup: getMarketMarkup(lifecycle),
          viewFormat,
          riskFlags: activePlayerProductId ? (riskFlagMap.get(activePlayerProductId) ?? []) : [],
        }}
      />
    </div>
  );
}

function getSportStyle(sportName: string) {
  const s = (sportName ?? '').toLowerCase();
  if (s === 'basketball') return { primary: '#f97316', gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' };
  if (s === 'football')   return { primary: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)' };
  return { primary: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' };
}
