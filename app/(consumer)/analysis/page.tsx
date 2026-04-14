'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { TrendingUp, Sparkles, Zap, ArrowLeft } from 'lucide-react';
import posthog from 'posthog-js';
import { formatCurrency } from '@/lib/engine';
import type { Signal } from '@/lib/types';
import {
  ElevatedCard,
  StepHeader,
  FormLabel,
  SegmentedControl,
  CounterInput,
  LargeCTAButton,
} from '@/components/breakiq/ds';

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

const signalConfig: Record<Signal, { borderColor: string; bgColor: string; textColor: string; label: string }> = {
  BUY:   { borderColor: 'var(--signal-buy)',   bgColor: 'rgba(34,197,94,0.08)',  textColor: 'var(--signal-buy)',   label: 'BUY' },
  WATCH: { borderColor: 'var(--signal-watch)', bgColor: 'rgba(234,179,8,0.08)', textColor: 'var(--signal-watch)', label: 'WATCH' },
  PASS:  { borderColor: 'var(--signal-pass)',  bgColor: 'rgba(239,68,68,0.08)', textColor: 'var(--signal-pass)',  label: 'PASS' },
};

export default function AnalysisPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  const [productId, setProductId] = useState('');
  const [team, setTeam] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const [breakType, setBreakType] = useState<'hobby' | 'bd'>('hobby');
  const [numCases, setNumCases] = useState(1);

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

  const selectedProduct = products.find(p => p.id === productId);
  const hasBD = selectedProduct?.bd_case_cost != null;
  const canAnalyze = productId && team && askPrice && !running;

  async function runAnalysis() {
    if (!productId || !team || !askPrice) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, team, askPrice: parseFloat(askPrice), breakType, numCases }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      posthog.capture('break_analysis_run', {
        product_id: productId,
        team,
        break_type: breakType,
        num_cases: numCases,
        ask_price: parseFloat(askPrice),
        signal: data.signal,
        value_pct: data.valuePct,
        fair_value: data.fairValue,
      });
      setResult(data);
    } catch (err) {
      posthog.captureException(err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }

  const breakTypeOptions = hasBD
    ? [{ value: 'hobby', label: 'Hobby' }, { value: 'bd', label: 'BD' }]
    : [{ value: 'hobby', label: 'Hobby' }];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Hero Header */}
      <div
        className="relative overflow-hidden border-b"
        style={{
          background: 'var(--gradient-hero)',
          borderColor: 'var(--terminal-border)',
        }}
      >
        {/* Dot pattern */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />
        {/* Ambient glows */}
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-96 h-96 blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, var(--badge-icon) 0%, transparent 70%)' }}
        />

        <div className="relative px-6 py-8 max-w-7xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold mb-6 px-3 py-1.5 rounded-lg backdrop-blur-sm hover:opacity-70 transition-opacity"
            style={{
              color: 'var(--text-primary)',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>

          <div className="flex items-center justify-center gap-4 mb-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <TrendingUp className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1
                  className="text-4xl font-bold"
                  style={{
                    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-blue) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  BreakIQ Sayz
                </h1>
                <Sparkles className="w-6 h-6 animate-pulse" style={{ color: 'var(--badge-icon)' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                AI-powered deal analysis with live market data
              </p>
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            {[
              { icon: <Zap className="w-4 h-4" style={{ color: 'var(--signal-buy)' }} />, label: 'Instant Analysis' },
              { icon: <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />, label: 'Market Intelligence' },
              { icon: <Sparkles className="w-4 h-4" style={{ color: 'var(--badge-icon)' }} />, label: 'Social Signals' },
            ].map(pill => (
              <div
                key={pill.label}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border backdrop-blur-sm"
                style={{
                  backgroundColor: 'rgba(19, 24, 32, 0.6)',
                  borderColor: 'var(--terminal-border-hover)',
                }}
              >
                {pill.icon}
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {pill.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">

          {/* Left — Configure */}
          <div>
            <StepHeader stepNumber={1} title="Configure Your Break" className="mb-6" />
            <ElevatedCard>
              <div className="space-y-6">
                {/* Product */}
                <div>
                  <FormLabel>Product</FormLabel>
                  <select
                    value={productId}
                    onChange={e => setProductId(e.target.value)}
                    className="w-full h-12 text-base font-medium rounded-lg border-2 px-4 focus:outline-none transition-all"
                    style={{
                      backgroundColor: 'var(--terminal-bg)',
                      borderColor: productId ? 'var(--accent-blue)' : 'var(--terminal-border)',
                      color: productId ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Break type + cases */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FormLabel>Break Type</FormLabel>
                    <SegmentedControl
                      options={breakTypeOptions}
                      value={breakType}
                      onChange={v => setBreakType(v as 'hobby' | 'bd')}
                    />
                  </div>
                  <div>
                    <FormLabel>Cases</FormLabel>
                    <CounterInput value={numCases} onChange={setNumCases} min={1} max={50} />
                  </div>
                </div>

                {/* Team */}
                <div>
                  <FormLabel>Team</FormLabel>
                  <select
                    value={team}
                    onChange={e => setTeam(e.target.value)}
                    disabled={teams.length === 0}
                    className="w-full h-12 text-base font-medium rounded-lg border-2 px-4 focus:outline-none transition-all disabled:opacity-40"
                    style={{
                      backgroundColor: 'var(--terminal-bg)',
                      borderColor: team ? 'var(--accent-blue)' : 'var(--terminal-border)',
                      color: team ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    <option value="">{productId ? 'Select team…' : 'Select a product first'}</option>
                    {teams.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* Asking price */}
                <div>
                  <FormLabel>Asking Price</FormLabel>
                  <div className="relative">
                    <span
                      className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl font-mono font-bold pointer-events-none"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      placeholder="0"
                      value={askPrice}
                      onChange={e => setAskPrice(e.target.value)}
                      disabled={!team}
                      className="w-full h-16 text-2xl font-mono font-bold rounded-lg border-2 pl-10 pr-4 focus:outline-none transition-all disabled:opacity-40"
                      style={{
                        backgroundColor: 'var(--terminal-bg)',
                        borderColor: askPrice ? 'var(--accent-blue)' : 'var(--terminal-border)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                </div>

                {/* CTA */}
                <LargeCTAButton
                  onClick={runAnalysis}
                  disabled={!canAnalyze}
                  loading={running}
                >
                  {running ? (
                    'Analyzing Deal…'
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Analyze Deal
                    </>
                  )}
                </LargeCTAButton>
              </div>
            </ElevatedCard>
          </div>

          {/* Right — Analysis Result */}
          <div>
            <StepHeader stepNumber={2} title="AI Analysis" className="mb-6" />
            <ElevatedCard>
              {error && (
                <div
                  className="rounded-lg p-4 text-sm mb-4"
                  style={{
                    backgroundColor: 'rgba(239,68,68,0.08)',
                    border: '1px solid var(--signal-pass)',
                    color: 'var(--signal-pass)',
                  }}
                >
                  {error}
                </div>
              )}

              {result && !running ? (
                <AnalysisResultPanel result={result} products={products} productId={productId} />
              ) : (
                <div
                  className="rounded-lg p-12 flex items-center justify-center border"
                  style={{ borderColor: 'var(--terminal-border)' }}
                >
                  <div className="text-center">
                    <Sparkles
                      className="w-12 h-12 mx-auto mb-4 opacity-20"
                      style={{ color: 'var(--text-secondary)' }}
                    />
                    <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      Configure your break and enter a price to get started
                    </p>
                  </div>
                </div>
              )}
            </ElevatedCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisResultPanel({
  result,
  products,
  productId,
}: {
  result: AnalysisResult;
  products: Product[];
  productId: string;
}) {
  const cfg = signalConfig[result.signal];
  const aboveBelow = result.valuePct >= 0 ? 'below fair value' : 'above fair value';
  const slug = products.find(p => p.id === productId)?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? '';

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <div
        className="rounded-lg p-6 border-2"
        style={{ backgroundColor: cfg.bgColor, borderColor: cfg.borderColor }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-3xl font-black" style={{ color: cfg.textColor }}>
            {cfg.label}
          </span>
          <div className="text-right">
            <p className="text-sm font-semibold font-mono" style={{ color: cfg.textColor }}>
              {Math.abs(result.valuePct).toFixed(1)}% {aboveBelow}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="terminal-label mb-1">Fair Value</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(result.fairValue)}
            </p>
          </div>
          <div>
            <p className="terminal-label mb-1">You&apos;re Paying</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(result.askPrice)}
            </p>
          </div>
        </div>

        <div
          className="pl-4 border-l-2 py-1"
          style={{ borderColor: 'var(--accent-blue)' }}
        >
          <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>
            {result.analysis}
          </p>
        </div>
      </div>

      {/* Key players */}
      {result.topPlayers.length > 0 && (
        <div
          className="rounded-lg p-5 border"
          style={{
            backgroundColor: 'var(--terminal-bg)',
            borderColor: 'var(--terminal-border)',
          }}
        >
          <p className="terminal-label mb-3">Key Players — {result.teamName}</p>
          <div className="space-y-3">
            {result.topPlayers.map(p => (
              <div
                key={p.name}
                className="flex items-center justify-between py-2 border-b last:border-b-0"
                style={{ borderColor: 'var(--terminal-border)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                  {p.isRookie && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}
                    >
                      RC
                    </span>
                  )}
                  {p.isIcon && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                      style={{ backgroundColor: 'var(--badge-icon)', color: 'var(--terminal-bg)' }}
                    >
                      ★ Icon
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 font-mono text-xs">
                  <div>
                    <span className="terminal-label mr-1">EV</span>
                    <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(p.evMid)}</span>
                  </div>
                  <div>
                    <span className="terminal-label mr-1">↑</span>
                    <span style={{ color: 'var(--signal-buy)' }}>{formatCurrency(p.evHigh)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HV advisory */}
      {result.hvPlayers?.length > 0 && (
        <div
          className="rounded-lg p-4 border flex items-start gap-3"
          style={{
            backgroundColor: 'rgba(234,179,8,0.08)',
            borderColor: 'var(--signal-watch)',
          }}
        >
          <span className="text-lg">⚡</span>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--signal-watch)' }}>
              High Volatility Advisory
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {result.hvPlayers.join(', ')} — market pricing is unusually uncertain. EVs may shift significantly.
            </p>
          </div>
        </div>
      )}

      {/* Risk flags */}
      {result.riskFlags?.length > 0 && (
        <div className="space-y-2">
          {result.riskFlags.map((flag, i) => (
            <div
              key={i}
              className="rounded-lg p-4 border flex items-start gap-3"
              style={{
                backgroundColor: 'rgba(239,68,68,0.05)',
                borderColor: 'var(--signal-pass)',
              }}
            >
              <span className="text-sm font-bold opacity-60" style={{ color: 'var(--signal-pass)' }}>⚑</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {flag.playerName}
                  </span>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                    style={{ backgroundColor: 'var(--signal-pass)', color: 'white' }}
                  >
                    {FLAG_LABELS[flag.flagType] ?? flag.flagType}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{flag.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View full break */}
      <div className="pt-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
        <Link
          href={`/break/${slug}`}
          className="text-xs font-medium hover:underline"
          style={{ color: 'var(--accent-blue)' }}
        >
          View full break analysis →
        </Link>
      </div>
    </div>
  );
}
