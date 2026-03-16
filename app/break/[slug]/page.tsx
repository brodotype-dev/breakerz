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

  // Load product + cached pricing on mount (fast — no CardHedger calls)
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

  // Fetch live pricing from CardHedger on demand
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error ?? 'Product not found.'}</p>
        <Link href="/" className="text-sm text-primary underline">← Back</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">CB</span>
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">← Products</span>
          </Link>
          <div className="flex items-center gap-4">
            {/* Pricing status + fetch button */}
            <div className="flex items-center gap-3">
              {hasPricing ? (
                <span className="text-xs text-muted-foreground">
                  {pricedCount}/{players.length} priced
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No live pricing</span>
              )}
              <button
                onClick={fetchLivePricing}
                disabled={fetching}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {fetching ? 'Fetching…' : hasPricing ? 'Refresh Pricing' : 'Fetch Live Pricing'}
              </button>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{product.name}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                {product.sport?.name} · {product.year}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <DashboardConfig config={config} onChange={setConfig} />

        {!hasPricing && !fetching && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-medium mb-1">No pricing data yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Fetch live data from CardHedger to see slot pricing and EV signals.
            </p>
            <button
              onClick={fetchLivePricing}
              className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              Fetch Live Pricing
            </button>
          </div>
        )}

        {fetching && (
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            <p className="text-sm">Searching CardHedger for {players.length} players…</p>
            <p className="text-xs mt-1">This takes ~10–20 seconds on first load, then caches for 24hrs.</p>
          </div>
        )}

        {hasPricing && (
          <Tabs defaultValue="players">
            <TabsList>
              <TabsTrigger value="players">
                Player Slots
                <span className="ml-2 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded-full">
                  {players.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="comparison">Breaker Compare</TabsTrigger>
            </TabsList>
            <TabsContent value="players" className="mt-4">
              <PlayerTable players={players} />
            </TabsContent>
            <TabsContent value="comparison" className="mt-4">
              <BreakerComparison players={players} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
