'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@supabase/supabase-js';
import DashboardConfig from '@/components/breakerz/DashboardConfig';
import PlayerTable from '@/components/breakerz/PlayerTable';
import TeamSlotsTable from '@/components/breakerz/TeamSlotsTable';
import BreakerComparison from '@/components/breakerz/BreakerComparison';
import { computeSlotPricing, computeTeamSlotPricing } from '@/lib/engine';
import type { BreakConfig, PlayerWithPricing, Product, Sport } from '@/lib/types';

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
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // player_product_id → active risk flags
  const [riskFlagMap, setRiskFlagMap] = useState<Map<string, Array<{ flagType: string; note: string }>>>(new Map());

  const [breakType, setBreakType] = useState<'hobby' | 'bd'>('hobby');

  const [config, setConfig] = useState<BreakConfig>({
    hobbyCases: 10,
    bdCases: 10,
    hobbyCaseCost: 0,
    bdCaseCost: 0,
  });

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
        setConfig(prev => ({
          ...prev,
          hobbyCaseCost: prod.hobby_case_cost ?? prev.hobbyCaseCost,
          bdCaseCost: prod.bd_case_cost ?? prev.bdCaseCost,
        }));

        const res = await fetch(`/api/pricing?productId=${prod.id}`);
        const { players: fetchedPlayers } = await res.json();
        const playerList: PlayerWithPricing[] = fetchedPlayers ?? [];
        setRawPlayers(playerList);

        // Fetch active risk flags for all players in this product
        if (playerList.length > 0) {
          const ppIds = playerList.map((p: PlayerWithPricing) => p.id);
          const { data: flags } = await supabase
            .from('player_risk_flags')
            .select('player_product_id, flag_type, note')
            .in('player_product_id', ppIds)
            .is('cleared_at', null);
          const fm = new Map<string, Array<{ flagType: string; note: string }>>();
          for (const f of flags ?? []) {
            const arr = fm.get(f.player_product_id) ?? [];
            arr.push({ flagType: f.flag_type, note: f.note });
            fm.set(f.player_product_id, arr);
          }
          setRiskFlagMap(fm);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    if (slug) load();
  }, [slug]);

  async function fetchLivePricing() {
    if (!product) return;
    setFetching(true);
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id }),
      });
      const { players } = await res.json();
      if (players) setRawPlayers(players);
    } finally {
      setFetching(false);
    }
  }

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

  const isPreRelease = product?.release_date
    ? new Date(product.release_date + 'T00:00:00') > new Date()
    : false;

  function formatReleaseDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-red-500">{error ?? 'Product not found.'}</p>
        <Link href="/" className="text-sm text-primary underline">← Back</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-[oklch(0.28_0.08_250)] text-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs font-medium">Products</span>
          </Link>

          <div className="flex-1 min-w-0 text-center">
            <p className="text-sm font-bold truncate">{product.name}</p>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">
              {product.sport?.name} · {product.year}
            </p>
          </div>

          {/* Pricing status + fetch */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/analysis" className="hidden sm:block text-[10px] text-white/50 hover:text-white font-medium transition-colors whitespace-nowrap">
              Breakerz Sayz →
            </Link>
            {hasPricing && !fetching && (
              <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
                {pricedCount}/{players.length} priced
              </span>
            )}
            <button
              onClick={fetchLivePricing}
              disabled={fetching}
              className="text-xs px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-white/20 whitespace-nowrap"
            >
              {fetching ? 'Fetching…' : hasPricing ? 'Refresh' : 'Fetch Pricing'}
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-[var(--topps-red)]" />
      </header>

      {/* Pre-release banner — takes priority over generic estimated pricing notice */}
      {isPreRelease && product.release_date ? (
        <div className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-start gap-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-blue-500 mt-0.5" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="11" r="0.75" fill="currentColor"/>
            </svg>
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                Pre-release · {product.name} launches {formatReleaseDate(product.release_date)}
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                This product hasn{"'"}t hit shelves yet — no sales data exists for these specific cards.
                Slot values shown are approximations based on historical comps for these players from prior sets.
                Prices will update automatically once the market establishes real sales.
              </p>
            </div>
          </div>
        </div>
      ) : estimatedCount > 0 ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-amber-500" aria-hidden="true">
              <path d="M7 1L13 13H1L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="7" cy="10.5" r="0.75" fill="currentColor"/>
            </svg>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {estimatedCount} player{estimatedCount !== 1 ? 's' : ''} using estimated pricing — no sales data yet for this product. Values are approximations based on historical comps.
            </p>
          </div>
        </div>
      ) : null}

      {/* No-odds warning banner */}
      {!product.has_odds && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-amber-500" aria-hidden="true">
              <path d="M7 1L13 13H1L7 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M7 5.5V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="7" cy="10.5" r="0.75" fill="currentColor"/>
            </svg>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Odds not yet available for this product — slot costs are estimated from card values only.
            </p>
            <OddsTooltip />
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* Break type toggle */}
        <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
          <button
            onClick={() => setBreakType('hobby')}
            className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
              breakType === 'hobby'
                ? 'bg-[oklch(0.28_0.08_250)] text-white'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Hobby Case
          </button>
          <button
            onClick={() => setBreakType('bd')}
            className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
              breakType === 'bd'
                ? 'bg-[oklch(0.28_0.08_250)] text-white'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Breakers Delight
          </button>
        </div>

        <DashboardConfig config={config} onChange={setConfig} breakType={breakType} />

        {/* Fetch banner — shown only before first fetch */}
        {!hasPricing && !fetching && (
          <div className="rounded border border-dashed bg-card p-6 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm mb-0.5">Live pricing not loaded</p>
              <p className="text-xs text-muted-foreground">
                Players are loaded — hit Fetch to pull EV data from CardHedger. Caches for 24 hrs.
              </p>
            </div>
            <button
              onClick={fetchLivePricing}
              className="shrink-0 text-sm px-4 py-2 rounded bg-[oklch(0.28_0.08_250)] text-white font-semibold hover:bg-[oklch(0.22_0.08_250)] transition-colors"
            >
              Fetch Pricing
            </button>
          </div>
        )}

        {fetching && (
          <div className="rounded border bg-card p-5 text-center">
            <p className="text-sm font-medium mb-1">Fetching live prices…</p>
            <p className="text-xs text-muted-foreground">
              Searching CardHedger for {players.length} players. First run takes ~15–20s, then caches for 24 hrs.
            </p>
            <div className="mt-3 h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-[oklch(0.28_0.08_250)] animate-pulse w-full" />
            </div>
          </div>
        )}

        <Tabs defaultValue="teams">
          <TabsList className="bg-secondary">
            <TabsTrigger value="teams">
              Team Slots
              <span className="ml-1.5 text-[10px] font-mono bg-background px-1.5 py-0.5 rounded-full">
                {teamSlots.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="players">
              Player Slots
              <span className="ml-1.5 text-[10px] font-mono bg-background px-1.5 py-0.5 rounded-full">
                {players.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="comparison">Breaker Compare</TabsTrigger>
          </TabsList>

          <TabsContent value="teams" className="mt-4">
            <TeamSlotsTable teams={teamSlots} breakType={breakType} riskFlagMap={riskFlagMap} />
          </TabsContent>

          <TabsContent value="players" className="mt-4">
            <PlayerTable players={players} fetching={fetching} breakType={breakType} riskFlagMap={riskFlagMap} />
          </TabsContent>
          <TabsContent value="comparison" className="mt-4">
            <BreakerComparison players={players} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
