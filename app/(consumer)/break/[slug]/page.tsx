'use client';

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
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
import BetaBanner from '@/components/breakiq/BetaBanner';
import { SegmentedControl, CounterInput, LargeCTAButton, InfoTip } from '@/components/breakiq/ds';
import { computeSlotPricing, computeTeamSlotPricing, formatCurrency } from '@/lib/engine';
import { getMarketMarkup } from '@/lib/market-markup';
import { computeRiskAdjustment, computeHypeAdjustment, type HypeObservation } from '@/lib/score-modulation';
import { computeProspectAdjustment } from '@/lib/prospect-score';
import {
  computeCascadeAdjustment,
  filterObservationsForPlayer,
  type CascadeObservation,
} from '@/lib/cascading-sentiment';
import { PH_EVENTS } from '@/lib/posthog-events';
import type { AnalysisResult as AnalysisResultShape } from '@/lib/analysis';
import type { AskingPriceObsRow, BreakConfig, BreakFormat, ChaseCard, HypeObsRow, PlayerWithPricing, PlayerRiskFlag, Product, Sport } from '@/lib/types';

const FORMAT_DEFS: Array<{ key: BreakFormat; label: string; short: string }> = [
  { key: 'hobby', label: 'Hobby',              short: 'Hobby' },
  { key: 'jumbo', label: 'Jumbo',              short: 'Jumbo' },
  { key: 'bd',    label: "Breaker's Delight",  short: 'BD' },
];


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function OddsTooltip() {
  return (
    <div className="relative group ml-auto shrink-0">
      <button
        className="flex items-center justify-center w-4 h-4 rounded-full border border-amber-400 text-amber-600 text-[10px] font-bold leading-none hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        aria-label="How slot costs are calculated without odds"
      >
        ?
      </button>
      <div className="absolute right-0 top-6 z-20 w-64 rounded border border-amber-200 bg-white dark:bg-zinc-900 dark:border-amber-800 shadow-lg p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed hidden group-hover:block">
        <p className="font-semibold mb-1">No odds available</p>
        <p>
          When pull-rate odds aren{"'"}t published, slot costs are weighted by each player{"'"}s market value (EV) only — not by how likely you are to pull their card. Once odds are imported, weighting automatically accounts for actual pull rates.
        </p>
      </div>
    </div>
  );
}

export default function BreakPage() {
  const { slug } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<(Product & { sport: Sport }) | null>(null);
  const [rawPlayers, setRawPlayers] = useState<PlayerWithPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // player_product_id → active risk flags
  const [riskFlagMap, setRiskFlagMap] = useState<Map<string, Array<{ flagType: string; note: string }>>>(new Map());

  // Raw market_observations rows for chip rendering on the pre-release layout.
  // The live-page engine reads its own subset of this data via score-modulation;
  // here we keep the rows themselves so the pre-release UI can render chips
  // without re-fetching.
  const [hypeObsRows, setHypeObsRows] = useState<HypeObsRow[]>([]);
  const [askingPriceObsRows, setAskingPriceObsRows] = useState<AskingPriceObsRow[]>([]);

  const [chaseCards, setChaseCards] = useState<ChaseCard[]>([]);
  const [activePlayerProductId, setActivePlayerProductId] = useState<string | null>(null);
  const [drawerTop, setDrawerTop] = useState(48);
  const mainRef = useRef<HTMLElement>(null);
  const [viewFormat, setViewFormat] = useState<BreakFormat>('hobby');
  const [activeTab, setActiveTab] = useState<'teams' | 'players'>('teams');

  const [config, setConfig] = useState<BreakConfig>({
    hobbyCases: 10,
    bdCases: 0,
    jumboCases: 0,
    hobbyCaseCost: 0,
    bdCaseCost: 0,
    jumboCaseCost: 0,
  });
  const [hobbyMsrp, setHobbyMsrp] = useState<number | null>(null);
  const [hobbyAmPrice, setHobbyAmPrice] = useState<number | null>(null);
  const [bdMsrp, setBdMsrp] = useState<number | null>(null);
  const [bdAmPrice, setBdAmPrice] = useState<number | null>(null);
  const [jumboMsrp, setJumboMsrp] = useState<number | null>(null);
  const [jumboAmPrice, setJumboAmPrice] = useState<number | null>(null);

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

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: prod } = await supabase
          .from('products')
          .select('*, sport:sports(*)')
          .eq('slug', slug)
          .single();

        if (!prod) { setError('Product not found.'); return; }

        setProduct(prod);
        setHobbyMsrp(prod.hobby_case_cost ?? null);
        setHobbyAmPrice(prod.hobby_am_case_cost ?? null);
        setBdMsrp(prod.bd_case_cost ?? null);
        setBdAmPrice(prod.bd_am_case_cost ?? null);
        setJumboMsrp(prod.jumbo_case_cost ?? null);
        setJumboAmPrice(prod.jumbo_am_case_cost ?? null);
        setConfig(prev => ({
          ...prev,
          hobbyCaseCost: prod.hobby_am_case_cost ?? prod.hobby_case_cost ?? prev.hobbyCaseCost,
          bdCaseCost: prod.bd_am_case_cost ?? prod.bd_case_cost ?? prev.bdCaseCost,
          jumboCaseCost: prod.jumbo_am_case_cost ?? prod.jumbo_case_cost ?? prev.jumboCaseCost,
        }));

        const [pricingRes, chaseRes] = await Promise.all([
          fetch(`/api/pricing?productId=${prod.id}`),
          supabase
            .from('product_chase_cards')
            .select('*, player_product:player_products(*, player:players(*))')
            .eq('product_id', prod.id)
            .order('display_order', { ascending: true }),
        ]);
        const { players: fetchedPlayers } = await pricingRes.json();
        const playerList: PlayerWithPricing[] = fetchedPlayers ?? [];
        setChaseCards((chaseRes.data ?? []) as ChaseCard[]);

        // Fetch active risk flags + active hype-tag observations in parallel.
        // Both feed into per-player score adjustments (lib/score-modulation.ts)
        // attached to playerList before setRawPlayers so the engine sees them
        // on first render. riskFlagMap stays as the UI display source.
        // Pre-release page renders asking-price chips alongside hype-tag chips,
        // so we fetch both observation types when in pre-release. Live/dormant
        // only need hype_tag (asking-price chips on /break stay deferred per
        // Phase 3c plan).
        const isPreReleaseProduct = prod.lifecycle_status === 'pre_release';

        if (playerList.length > 0) {
          const ppIds = playerList.map((p: PlayerWithPricing) => p.id);
          const nowIso = new Date().toISOString();
          const fetches: Array<PromiseLike<unknown>> = [
            supabase
              .from('player_risk_flags')
              .select('player_product_id, flag_type, note')
              .in('player_product_id', ppIds)
              .is('cleared_at', null),
            supabase
              .from('market_observations')
              .select('scope_type, scope_id, scope_team, payload, observed_at, source_narrative')
              .eq('product_id', prod.id)
              .eq('observation_type', 'hype_tag')
              .gt('expires_at', nowIso)
              .is('superseded_at', null),
            // Track B cascade: product-scoped sentiment types live with
            // product_id = prod.id; global team_sentiment rows live with
            // product_id IS NULL. Two queries because PostgREST can't OR a
            // null-check across an enum filter cleanly.
            supabase
              .from('market_observations')
              .select('observation_type, scope_team, product_id, payload, observed_at')
              .eq('product_id', prod.id)
              .in('observation_type', ['team_sentiment', 'product_sentiment', 'team_product_sentiment'])
              .gt('expires_at', nowIso)
              .is('superseded_at', null),
            supabase
              .from('market_observations')
              .select('observation_type, scope_team, product_id, payload, observed_at')
              .is('product_id', null)
              .eq('observation_type', 'team_sentiment')
              .gt('expires_at', nowIso)
              .is('superseded_at', null),
          ];
          // Step #3 — asking-price observations now fetch on every
          // lifecycle (was previously gated to pre-release). Live products
          // consume them via the side-by-side comparison in TeamSlotsTable;
          // pre-release continues to render them as hero chips.
          const askingIdx = fetches.length;
          fetches.push(
            supabase
              .from('market_observations')
              .select('scope_type, scope_id, scope_team, payload, observed_at, source_narrative')
              .eq('product_id', prod.id)
              .eq('observation_type', 'asking_price')
              .gt('expires_at', nowIso)
              .is('superseded_at', null),
          );
          const settled = (await Promise.all(fetches)) as Array<{ data: unknown[] | null }>;
          const flagsRes = settled[0] as { data: Array<{ player_product_id: string; flag_type: string; note: string }> | null };
          const obsRes = settled[1] as { data: HypeObsRow[] | null };
          const cascadeProductRes = settled[2] as { data: CascadeObservation[] | null };
          const cascadeGlobalRes = settled[3] as { data: CascadeObservation[] | null };
          const askRes = settled[askingIdx] as { data: AskingPriceObsRow[] | null };

          const fm = new Map<string, Array<{ flagType: string; note: string }>>();
          const riskAdjMap = new Map<string, number>();
          const flagsByPp = new Map<string, PlayerRiskFlag['flag_type'][]>();
          for (const f of flagsRes.data ?? []) {
            const arr = fm.get(f.player_product_id) ?? [];
            arr.push({ flagType: f.flag_type, note: f.note });
            fm.set(f.player_product_id, arr);
            const types = flagsByPp.get(f.player_product_id) ?? [];
            types.push(f.flag_type as PlayerRiskFlag['flag_type']);
            flagsByPp.set(f.player_product_id, types);
          }
          for (const [ppId, types] of flagsByPp) {
            riskAdjMap.set(ppId, computeRiskAdjustment(types.map(t => ({ flag_type: t }))));
          }
          setRiskFlagMap(fm);

          // Bucket hype observations by scope so we can map them to each
          // player_product. scope_id is the players.id (NOT player_product_id)
          // when scope_type='player'. scope_team is a string. scope_type='product'
          // applies to every player in the roster.
          const obsRows = obsRes.data ?? [];
          setHypeObsRows(obsRows);
          setAskingPriceObsRows(askRes?.data ?? []);
          const productScope: HypeObservation[] = [];
          const teamScope = new Map<string, HypeObservation[]>();
          const playerScope = new Map<string, HypeObservation[]>();
          for (const o of obsRows) {
            const obs: HypeObservation = {
              tag: o.payload.tag,
              strength: o.payload.strength,
              decay_days: o.payload.decay_days,
              observed_at: o.observed_at,
            };
            if (o.scope_type === 'product') productScope.push(obs);
            else if (o.scope_type === 'team' && o.scope_team) {
              const arr = teamScope.get(o.scope_team) ?? [];
              arr.push(obs);
              teamScope.set(o.scope_team, arr);
            } else if (o.scope_type === 'player' && o.scope_id) {
              const arr = playerScope.get(o.scope_id) ?? [];
              arr.push(obs);
              playerScope.set(o.scope_id, arr);
            }
          }

          const sportSlug = (prod.sport?.slug ?? '').toLowerCase();
          const cascadeAll: CascadeObservation[] = [
            ...(cascadeProductRes.data ?? []),
            ...(cascadeGlobalRes.data ?? []),
          ];
          const augmented: PlayerWithPricing[] = playerList.map(p => {
            const teamObs = teamScope.get(p.player?.team ?? '') ?? [];
            const playerObs = playerScope.get(p.player_id) ?? [];
            const all = [...productScope, ...teamObs, ...playerObs];
            const cascadeForPlayer = filterObservationsForPlayer(cascadeAll, p.player?.team);
            const cascade = computeCascadeAdjustment({
              observations: cascadeForPlayer,
              sportSlug,
            });
            return {
              ...p,
              risk_score_adj: riskAdjMap.get(p.id) ?? 0,
              hype_score_adj: computeHypeAdjustment(all),
              prospect_score_adj: computeProspectAdjustment({
                prospect_rank: p.player?.prospect_rank,
                prospect_status: p.player?.prospect_status,
                sportSlug,
              }),
              cascade_score_adj: cascade.adjustment,
            };
          });
          setRawPlayers(augmented);
        } else {
          setRawPlayers(playerList);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (slug) load();
  }, [slug]);

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

  const players = useMemo(() => computeSlotPricing(rawPlayers, config), [rawPlayers, config]);

  const teamSlots = useMemo(
    () => computeTeamSlotPricing(players, config),
    [players, config]
  );

  const pricedCount = players.filter(p => p.pricingSource !== 'none').length;
  const hasPricing = pricedCount > 0;
  const estimatedCount = players.filter(p =>
    p.pricingSource === 'search-fallback' || p.pricingSource === 'cross-product' || p.pricingSource === 'default'
  ).length;

  // Lifecycle drives layout. release_date is informational (countdown).
  // Default to 'live' for products that pre-date the lifecycle column.
  const lifecycle = (product?.lifecycle_status ?? 'live') as 'pre_release' | 'live' | 'dormant';
  const isPreRelease = lifecycle === 'pre_release';
  const isDormant = lifecycle === 'dormant';

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

  function formatReleaseDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  function getSportStyle(sportName: string) {
    const s = (sportName ?? '').toLowerCase();
    if (s === 'basketball') return { primary: '#f97316', gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' };
    if (s === 'football')   return { primary: '#22c55e', gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)' };
    return { primary: '#3b82f6', gradient: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' };
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <div className="text-center">
          <div
            className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }}
          />
          <p className="text-sm font-medium" style={{ color: 'var(--text-t-secondary)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ backgroundColor: 'var(--terminal-bg)' }}>
        <p className="text-sm" style={{ color: '#dc2626' }}>{error ?? 'Product not found.'}</p>
        <Link href="/" className="text-sm underline" style={{ color: 'var(--accent-blue)' }}>← Back to Products</Link>
      </div>
    );
  }

  const { primary, gradient } = getSportStyle(product.sport?.name ?? '');

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>

      {/* Hero header with sport gradient */}
      <div className="relative overflow-hidden border-b" style={{ background: gradient, borderColor: 'var(--terminal-border)' }}>
        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}
        />
        {/* Glow */}
        <div
          className="absolute top-0 right-0 w-80 h-80 blur-3xl opacity-25"
          style={{ background: `radial-gradient(circle, ${primary} 0%, transparent 70%)` }}
        />

        <div className="relative px-4 sm:px-6 py-4 sm:py-6">
          {/* Back nav */}
          <Link href="/">
            <button
              className="flex items-center gap-2 text-xs font-semibold mb-3 sm:mb-5 px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'white', backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Products
            </button>
          </Link>

          <div className="flex items-start justify-between flex-wrap gap-4 sm:gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5 sm:mb-2">
                <span
                  className="text-[10px] font-bold uppercase px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg backdrop-blur-sm"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', letterSpacing: '0.06em' }}
                >
                  {product.sport?.name}
                </span>
                <span className="text-xs sm:text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{product.year}</span>
                <span className="text-xs sm:text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{product.manufacturer}</span>
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white mb-2 sm:mb-3 break-words">{product.name}</h1>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                {hasPricing && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md sm:rounded-lg backdrop-blur-sm" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-white inline-block" />
                    <span className="text-[11px] sm:text-xs font-semibold text-white">{pricedCount}/{players.length} priced</span>
                  </div>
                )}
                {!product.has_odds && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 rounded-md sm:rounded-lg backdrop-blur-sm" style={{ backgroundColor: 'rgba(245,158,11,0.3)' }}>
                    <span className="text-[11px] sm:text-xs font-medium" style={{ color: '#fef3c7' }}>No odds · EV-only</span>
                    <OddsTooltip />
                  </div>
                )}
              </div>
            </div>

            {/* Controls — pick which format the slot tables display. Cases per
                format are configured below in the format-mix box. */}
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase mb-1.5 sm:mb-2" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em' }}>
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
          </div>
        </div>
      </div>

      {/* Info banners */}
      {isPreRelease && (
        <div className="border-b px-4 sm:px-6 py-3" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(168,85,247,0.08)' }}>
          <p className="text-xs font-semibold" style={{ color: '#c4b5fd' }}>
            Pre-release · {product.release_date ? `${product.name} launches ${formatReleaseDate(product.release_date)}` : `${product.name} hasn't launched yet`}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
            No live pricing yet — the secondary market hasn't established. Below: chase cards we're watching plus historical comps from these players' existing cards.
          </p>
        </div>
      )}
      {isDormant && (
        <div className="border-b px-4 sm:px-6 py-3" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(148,163,184,0.08)' }}>
          <p className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>
            Dormant · {product.name} is no longer actively tracked
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
            Pricing refreshes biweekly instead of nightly — values may lag the live market. Treat as historical reference, not a real-time read.
          </p>
        </div>
      )}
      {!isPreRelease && !isDormant && estimatedCount > 0 && (
        <div className="border-b px-4 sm:px-6 py-2.5 flex items-center gap-2" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(245,158,11,0.06)' }}>
          <span className="text-[10px]" style={{ color: '#f59e0b' }}>▲</span>
          <p className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>
            {estimatedCount} player{estimatedCount !== 1 ? 's' : ''} using estimated pricing — approximations based on historical comps.
          </p>
        </div>
      )}
      {!isPreRelease && !isDormant && hasPricing && (
        <div className="border-b px-4 sm:px-6 py-2 flex items-center gap-2" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(148,163,184,0.05)' }}>
          <span className="text-[10px]" style={{ color: 'var(--text-t-tertiary)' }}>◎</span>
          <p className="text-[11px]" style={{ color: 'var(--text-t-tertiary)' }}>
            EV values reflect <strong>raw</strong> card sale prices. Graded (PSA 9 / PSA 10) comps are not included — per-player graded drilldown coming soon.
          </p>
        </div>
      )}

      <main ref={mainRef} className="px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-5 max-w-[1400px] mx-auto">
        <BetaBanner surface="break_page" />
        {isPreRelease ? (
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
        ) : (
          <>
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
            if (!canRunAnalysis || !product) return;
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
              const data = await res.json();
              if (data.error) throw new Error(data.error);
              posthog.capture(PH_EVENTS.break_analysis_run, {
                product_id: product.id,
                teams: selectedAnalysisTeams,
                extra_player_count: selectedAnalysisPlayerIds.length,
                formats: { hobby: config.hobbyCases, bd: config.bdCases, jumbo: config.jumboCases },
                ask_price: askPriceNum,
                signal: data.signal,
                value_pct: data.valuePct,
                fair_value: data.fairValue,
                surface: 'break_page_inline',
              });
              setAnalysisResult(data as AnalysisResultShape);
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
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Teams</p>
                  <div className="flex flex-wrap gap-2">
                    {uniqueTeams.map(t => (
                      <TeamChip
                        key={t}
                        team={t}
                        sport={product?.sport?.name}
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
                  Specific player slots <span className="font-normal opacity-60">(optional)</span>
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
                  <AnalysisResultPanel result={analysisResult} productId={product?.id ?? ''} />
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
          {activeTab === 'teams' && <TeamSlotsTable teams={teamSlots} viewFormat={viewFormat} riskFlagMap={riskFlagMap} productId={product?.id ?? null} marketMarkup={getMarketMarkup(lifecycle)} askObservations={askObservationsByTeam} targetComposition={targetComposition} />}
          {activeTab === 'players' && (
            <PlayerTable
              players={players}
              viewFormat={viewFormat}
              riskFlagMap={riskFlagMap}
              onPlayerClick={id => setActivePlayerProductId(id)}
              productId={product?.id ?? null}
              marketMarkup={getMarketMarkup(lifecycle)}
            />
          )}
        </div>
          </>
        )}
      </main>

      <PlayerDetailDrawer
        playerProductId={activePlayerProductId}
        onClose={() => setActivePlayerProductId(null)}
        topOffset={drawerTop}
        audit={{
          row: activePlayerProductId
            ? players.find(p => p.id === activePlayerProductId) ?? null
            : null,
          productLifecycle: lifecycle,
          liveSince: product?.live_since ?? null,
          marketMarkup: getMarketMarkup(lifecycle),
          viewFormat,
          riskFlags: activePlayerProductId ? (riskFlagMap.get(activePlayerProductId) ?? []) : [],
        }}
      />
    </div>
  );
}
