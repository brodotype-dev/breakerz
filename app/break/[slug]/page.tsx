'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createClient } from '@supabase/supabase-js';
import DashboardConfig from '@/components/breakerz/DashboardConfig';
import PlayerTable from '@/components/breakerz/PlayerTable';
import BreakerComparison from '@/components/breakerz/BreakerComparison';
import { computeSlotPricing } from '@/lib/engine';
import type { BreakConfig, PlayerWithPricing, Product, Sport } from '@/lib/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function BreakPage() {
  const { slug } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<(Product & { sport: Sport }) | null>(null);
  const [rawPlayers, setRawPlayers] = useState<PlayerWithPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<BreakConfig>({
    hobbyCases: 10,
    bdCases: 10,
    hobbyCaseCost: 0,
    bdCaseCost: 0,
    breakerMargin: 0.25,
    ebayFeeRate: 0.13,
    shippingPerCard: 6,
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
        const { players } = await res.json();
        setRawPlayers(players ?? []);
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
  const pricedCount = players.filter(p => p.pricingSource !== 'none').length;
  const hasPricing = pricedCount > 0;

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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <DashboardConfig config={config} onChange={setConfig} />

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

        <Tabs defaultValue="players">
          <TabsList className="bg-secondary">
            <TabsTrigger value="players">
              Player Slots
              <span className="ml-1.5 text-[10px] font-mono bg-background px-1.5 py-0.5 rounded-full">
                {players.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="comparison">Breaker Compare</TabsTrigger>
          </TabsList>

          <TabsContent value="players" className="mt-4">
            <PlayerTable players={players} fetching={fetching} />
          </TabsContent>
          <TabsContent value="comparison" className="mt-4">
            <BreakerComparison players={players} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
