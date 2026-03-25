'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { formatCurrency } from '@/lib/engine';
import type { Signal } from '@/lib/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Product {
  id: string;
  name: string;
  year: string;
  sport: { name: string };
  hobby_case_cost: number | null;
  bd_case_cost: number | null;
}

const FLAG_LABELS: Record<string, string> = {
  injury: 'Injury', suspension: 'Suspension', legal: 'Legal',
  trade: 'Trade', retirement: 'Retirement', off_field: 'Off-field',
};

interface AnalysisResult {
  signal: Signal;
  valuePct: number;
  fairValue: number;
  askPrice: number;
  analysis: string;
  topPlayers: Array<{ name: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }>;
  teamName: string;
  productName: string;
  riskFlags: Array<{ playerName: string; flagType: string; note: string }>;
  hvPlayers: string[];
}

const signalStyles: Record<Signal, { bg: string; text: string; border: string; label: string }> = {
  BUY:   { bg: 'bg-green-50 dark:bg-green-950/30',  text: 'text-green-800 dark:text-green-300',  border: 'border-green-300 dark:border-green-700',  label: 'BUY' },
  WATCH: { bg: 'bg-amber-50 dark:bg-amber-950/30',  text: 'text-amber-800 dark:text-amber-300',  border: 'border-amber-300 dark:border-amber-700',  label: 'WATCH' },
  PASS:  { bg: 'bg-red-50 dark:bg-red-950/30',      text: 'text-red-800 dark:text-red-300',      border: 'border-red-300 dark:border-red-700',      label: 'PASS' },
};

export default function AnalysisPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  const [productId, setProductId] = useState('');
  const [team, setTeam] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const [breakType, setBreakType] = useState<'hobby' | 'bd'>('hobby');
  const [numCases, setNumCases] = useState('10');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/analysis')
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []));
  }, []);

  useEffect(() => {
    if (!productId) { setTeams([]); setTeam(''); return; }
    setTeam('');
    supabase
      .from('player_products')
      .select('player:players(team)')
      .eq('product_id', productId)
      .then(({ data }) => {
        const uniqueTeams = Array.from(
          new Set((data ?? []).map((r: any) => r.player?.team).filter(Boolean))
        ).sort() as string[];
        setTeams(uniqueTeams);
      });
  }, [productId]);

  async function runAnalysis() {
    if (!productId || !team || !askPrice) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, team, askPrice: parseFloat(askPrice), breakType, numCases: parseInt(numCases) || 10 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }

  const selectedProduct = products.find(p => p.id === productId);
  const hasBD = selectedProduct?.bd_case_cost != null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-[oklch(0.28_0.08_250)] text-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-xs font-medium">Products</span>
          </Link>
          <div className="flex-1 text-center">
            <p className="text-sm font-bold">Breakerz Sayz</p>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">Break Slot Analysis</p>
          </div>
          <div className="w-20" />
        </div>
        <div className="h-0.5 bg-[var(--topps-red)]" />
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Intro */}
        <div>
          <h1 className="text-xl font-black mb-1">Breakerz Sayz</h1>
          <p className="text-sm text-muted-foreground">
            Select a product, pick your team, enter what the breaker is charging — we{"'"}ll tell you if it{"'"}s a good deal.
          </p>
        </div>

        {/* Input form */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="h-1 bg-[oklch(0.28_0.08_250)]" />
          <div className="p-5 space-y-4">
            {/* Product */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                Product
              </label>
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
              >
                <option value="">Select a product…</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Break type toggle */}
            {productId && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                  Break Type
                </label>
                <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
                  <button
                    onClick={() => setBreakType('hobby')}
                    className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                      breakType === 'hobby' ? 'bg-[oklch(0.28_0.08_250)] text-white' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Hobby
                  </button>
                  {hasBD && (
                    <button
                      onClick={() => setBreakType('bd')}
                      className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                        breakType === 'bd' ? 'bg-[oklch(0.28_0.08_250)] text-white' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Breakers Delight
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Cases in the break */}
            {productId && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                  Cases in the break
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={numCases}
                    onChange={e => setNumCases(e.target.value)}
                    className="w-24 text-sm font-mono px-3 py-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                  />
                  <span className="text-xs text-muted-foreground">
                    {parseInt(numCases) === 1 ? 'single case break' : `case group break`}
                  </span>
                </div>
              </div>
            )}

            {/* Team */}
            {teams.length > 0 && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                  Your Team
                </label>
                <select
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                >
                  <option value="">Select a team…</option>
                  {teams.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Ask price */}
            {team && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                  What the breaker is charging
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={askPrice}
                    onChange={e => setAskPrice(e.target.value)}
                    className="w-full text-sm font-mono pl-7 pr-4 py-2 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-[oklch(0.28_0.08_250)]"
                  />
                </div>
              </div>
            )}

            {/* Run button */}
            <button
              onClick={runAnalysis}
              disabled={!productId || !team || !askPrice || running}
              className="w-full py-2.5 rounded bg-[oklch(0.28_0.08_250)] text-white text-sm font-bold uppercase tracking-wider hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {running ? 'Analyzing…' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {/* Running state */}
        {running && (
          <div className="bg-card border rounded-lg p-6 text-center space-y-2">
            <p className="text-sm font-medium">Checking the numbers…</p>
            <p className="text-xs text-muted-foreground">Pulling player data and running analysis</p>
            <div className="mt-3 h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-[oklch(0.28_0.08_250)] animate-pulse w-full" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-950/20 p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Analysis result */}
        {result && !running && (() => {
          const style = signalStyles[result.signal];
          const aboveBelow = result.valuePct >= 0 ? 'below fair value' : 'above fair value';
          return (
            <div className={`border rounded-lg overflow-hidden ${style.border}`}>
              {/* Signal header */}
              <div className={`${style.bg} ${style.border} border-b px-5 py-4 flex items-center justify-between`}>
                <div>
                  <span className={`text-2xl font-black ${style.text}`}>{style.label}</span>
                  <p className={`text-xs mt-0.5 ${style.text} opacity-80`}>
                    {result.productName} · {result.teamName}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-medium ${style.text}`}>
                    {Math.abs(result.valuePct).toFixed(1)}% {aboveBelow}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fair value: {formatCurrency(result.fairValue)}
                  </p>
                </div>
              </div>

              {/* AI analysis */}
              <div className="bg-card px-5 py-4 space-y-4">
                <p className="text-sm leading-relaxed">{result.analysis}</p>

                {/* Top players */}
                {result.topPlayers.length > 0 && (
                  <div className="border-t pt-4">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
                      Key Players on {result.teamName}
                    </p>
                    <div className="space-y-1.5">
                      {result.topPlayers.map(p => (
                        <div key={p.name} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            {p.isRookie && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-[var(--topps-red)] text-white uppercase tracking-wider">
                                RC
                              </span>
                            )}
                            {p.isIcon && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-600 text-white uppercase tracking-wider">
                                ★ Icon
                              </span>
                            )}
                          </div>
                          <div className="text-right font-mono text-xs text-muted-foreground">
                            <span>EV {formatCurrency(p.evMid)}</span>
                            <span className="ml-2 text-green-600 dark:text-green-400">↑ {formatCurrency(p.evHigh)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* High Volatility advisory */}
                {result.hvPlayers?.length > 0 && (
                  <div className="border-t pt-4">
                    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 flex items-start gap-2">
                      <span className="text-amber-500 mt-px">⚡</span>
                      <div>
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">High Volatility</p>
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                          {result.hvPlayers.join(', ')} — market pricing is unusually uncertain for {result.hvPlayers.length === 1 ? 'this player' : 'these players'}. EVs may shift significantly.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Risk flags */}
                {result.riskFlags?.length > 0 && (
                  <div className="border-t pt-4 space-y-2">
                    {result.riskFlags.map((flag, i) => (
                      <div key={i} className="rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 flex items-start gap-2">
                        <span className="text-red-500 mt-px text-xs font-bold">⚑</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-red-800 dark:text-red-300">{flag.playerName}</span>
                            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-200 dark:bg-red-900/60 text-red-700 dark:text-red-400 uppercase">
                              {FLAG_LABELS[flag.flagType] ?? flag.flagType}
                            </span>
                          </div>
                          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{flag.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* View full break */}
                <div className="border-t pt-3">
                  <Link
                    href={`/break/${products.find(p => p.id === productId)?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? ''}`}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    View full break analysis →
                  </Link>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
