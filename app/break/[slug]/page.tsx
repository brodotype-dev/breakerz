'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DashboardConfig from '@/components/breakerz/DashboardConfig';
import PlayerTable from '@/components/breakerz/PlayerTable';
import BreakerComparison from '@/components/breakerz/BreakerComparison';
import { computeSlotPricing } from '@/lib/engine';
import type { BreakConfig, PlayerWithPricing, Product, Sport } from '@/lib/types';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function BreakPage() {
  const { slug } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<(Product & { sport: Sport }) | null>(null);
  const [rawPlayers, setRawPlayers] = useState<PlayerWithPricing[]>([]);
  const [loading, setLoading] = useState(true);
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
        // Load product
        const { data: prod, error: prodErr } = await supabase
          .from('products')
          .select('*, sport:sports(*)')
          .eq('slug', slug)
          .single();

        if (prodErr || !prod) {
          setError('Product not found.');
          return;
        }

        setProduct(prod);
        setConfig(prev => ({
          ...prev,
          hobbyCaseCost: prod.hobby_case_cost ?? prev.hobbyCaseCost,
          bdCaseCost: prod.bd_case_cost ?? prev.bdCaseCost,
        }));

        // Load players + live pricing from our API route
        const res = await fetch(`/api/pricing?productId=${prod.id}`);
        if (!res.ok) throw new Error(`Failed to load pricing: ${res.status}`);
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

  // Re-compute slot pricing whenever config or raw players change
  const players = useMemo(
    () => computeSlotPricing(rawPlayers, config),
    [rawPlayers, config]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading pricing data…</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-500">{error ?? 'Product not found.'}</p>
        <Link href="/" className="text-sm text-primary underline">← Back to products</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">CB</span>
              </div>
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">← Products</span>
            </Link>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold">{product.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {product.sport?.name} · {product.year}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <DashboardConfig config={config} onChange={setConfig} />

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
      </main>
    </div>
  );
}
