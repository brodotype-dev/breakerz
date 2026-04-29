'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { TrendingUp, Sparkles, Zap, ArrowLeft, X, Plus, Search } from 'lucide-react';
import posthog from 'posthog-js';
import { formatCurrency } from '@/lib/engine';
import type { Signal, BreakFormat } from '@/lib/types';
import {
  ElevatedCard,
  StepHeader,
  FormLabel,
  CounterInput,
  LargeCTAButton,
} from '@/components/breakiq/ds';
import TeamChip from '@/components/breakiq/TeamChip';

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
  jumbo_case_cost: number | null;
  hobby_am_case_cost: number | null;
  bd_am_case_cost: number | null;
  jumbo_am_case_cost: number | null;
}

interface PlayerOption {
  id: string;          // player_product_id
  name: string;
  team: string;
  is_rookie: boolean;
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
  topPlayers: Array<{ name: string; team: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }>;
  teams: string[];
  extraPlayerNames: string[];
  productName: string;
  formats: { hobby: number; bd: number; jumbo: number };
  riskFlags: Array<{ playerName: string; flagType: string; note: string }>;
  hvPlayers: string[];
}

const signalConfig: Record<Signal, { borderColor: string; bgColor: string; textColor: string; label: string }> = {
  BUY:   { borderColor: 'var(--signal-buy)',   bgColor: 'rgba(34,197,94,0.08)',  textColor: 'var(--signal-buy)',   label: 'BUY' },
  WATCH: { borderColor: 'var(--signal-watch)', bgColor: 'rgba(234,179,8,0.08)', textColor: 'var(--signal-watch)', label: 'WATCH' },
  PASS:  { borderColor: 'var(--signal-pass)',  bgColor: 'rgba(239,68,68,0.08)', textColor: 'var(--signal-pass)',  label: 'PASS' },
};

const FORMAT_DEFS: Array<{ key: BreakFormat; label: string }> = [
  { key: 'hobby', label: 'Hobby' },
  { key: 'jumbo', label: 'Jumbo' },
  { key: 'bd',    label: "Breaker's Delight" },
];

function effectiveCaseCost(p: Product, fmt: BreakFormat): number | null {
  if (fmt === 'hobby') return p.hobby_am_case_cost ?? p.hobby_case_cost ?? null;
  if (fmt === 'bd')    return p.bd_am_case_cost ?? p.bd_case_cost ?? null;
  return p.jumbo_am_case_cost ?? p.jumbo_case_cost ?? null;
}

export default function AnalysisPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [allPlayers, setAllPlayers] = useState<PlayerOption[]>([]);

  const [productId, setProductId] = useState('');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [cases, setCases] = useState<{ hobby: number; bd: number; jumbo: number }>({ hobby: 1, bd: 0, jumbo: 0 });
  const [askPrice, setAskPrice] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/analysis')
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []));
  }, []);

  useEffect(() => {
    setSelectedTeams([]);
    setSelectedPlayerIds([]);
    setAllPlayers([]);
    if (!productId) return;
    supabase
      .from('player_products')
      .select('id, player:players(name, team, is_rookie)')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .then(({ data }) => {
        const rows = (data ?? [])
          .map((r: any) => r.player ? { id: r.id, name: r.player.name, team: r.player.team, is_rookie: r.player.is_rookie } : null)
          .filter((r): r is PlayerOption => !!r && !!r.team);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setAllPlayers(rows);
      });
  }, [productId]);

  const selectedProduct = products.find(p => p.id === productId);

  const teams = useMemo(() => {
    return Array.from(new Set(allPlayers.map(p => p.team))).sort();
  }, [allPlayers]);

  const availableFormats = useMemo<BreakFormat[]>(() => {
    if (!selectedProduct) return [];
    return FORMAT_DEFS
      .map(f => f.key)
      .filter(k => effectiveCaseCost(selectedProduct, k) != null);
  }, [selectedProduct]);

  // When product changes, reset format counts to first available format = 1, others = 0.
  useEffect(() => {
    if (!availableFormats.length) {
      setCases({ hobby: 0, bd: 0, jumbo: 0 });
      return;
    }
    const fresh: { hobby: number; bd: number; jumbo: number } = { hobby: 0, bd: 0, jumbo: 0 };
    fresh[availableFormats[0]] = 1;
    setCases(fresh);
  }, [availableFormats.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    const selectedTeamSet = new Set(selectedTeams);
    return allPlayers
      .filter(p => !selectedPlayerIds.includes(p.id))
      .filter(p => !selectedTeamSet.has(p.team))            // hide players already covered by a selected team
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allPlayers, playerSearch, selectedPlayerIds, selectedTeams]);

  const totalCases = cases.hobby + cases.bd + cases.jumbo;
  const hasSelection = selectedTeams.length > 0 || selectedPlayerIds.length > 0;
  const canAnalyze = productId && hasSelection && askPrice && totalCases > 0 && !running;

  function toggleTeam(t: string) {
    setSelectedTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }

  function addPlayer(id: string) {
    setSelectedPlayerIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setPlayerSearch('');
  }

  function removePlayer(id: string) {
    setSelectedPlayerIds(prev => prev.filter(x => x !== id));
  }

  async function runAnalysis() {
    if (!canAnalyze) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          teams: selectedTeams,
          extraPlayerProductIds: selectedPlayerIds,
          formats: cases,
          askPrice: parseFloat(askPrice),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      posthog.capture('break_analysis_run', {
        product_id: productId,
        teams: selectedTeams,
        extra_player_count: selectedPlayerIds.length,
        formats: cases,
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Hero */}
      <div
        className="relative overflow-hidden border-b"
        style={{ background: 'var(--gradient-hero)', borderColor: 'var(--terminal-border)' }}
      >
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20" style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 left-0 w-96 h-96 blur-3xl opacity-20" style={{ background: 'radial-gradient(circle, var(--badge-icon) 0%, transparent 70%)' }} />
        <div className="relative px-6 py-8 max-w-7xl mx-auto">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold mb-6 px-3 py-1.5 rounded-lg backdrop-blur-sm hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-primary)', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}>
              <TrendingUp className="w-7 h-7 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-4xl font-bold" style={{ background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-blue) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  BreakIQ Sayz
                </h1>
                <Sparkles className="w-6 h-6 animate-pulse" style={{ color: 'var(--badge-icon)' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Bundle teams, players, and case formats — get a single deal verdict
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
            {[
              { icon: <Zap className="w-4 h-4" style={{ color: 'var(--signal-buy)' }} />, label: 'Mixed Format' },
              { icon: <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />, label: 'Multi-Team' },
              { icon: <Sparkles className="w-4 h-4" style={{ color: 'var(--badge-icon)' }} />, label: 'Player Slots' },
            ].map(pill => (
              <div key={pill.label} className="flex items-center gap-2 px-3 py-1.5 rounded-full border backdrop-blur-sm" style={{ backgroundColor: 'rgba(19, 24, 32, 0.6)', borderColor: 'var(--terminal-border-hover)' }}>
                {pill.icon}
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{pill.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-7xl mx-auto">
          {/* Configure */}
          <div>
            <StepHeader stepNumber={1} title="Configure Your Bundle" className="mb-6" />
            <ElevatedCard>
              <div className="space-y-6">
                {/* Product */}
                <div>
                  <FormLabel>Product</FormLabel>
                  <select
                    value={productId}
                    onChange={e => setProductId(e.target.value)}
                    className="w-full h-12 text-base font-medium rounded-lg border-2 px-4 focus:outline-none transition-all"
                    style={{ backgroundColor: 'var(--terminal-bg)', borderColor: productId ? 'var(--accent-blue)' : 'var(--terminal-border)', color: productId ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
                  >
                    <option value="">Select product…</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* Format mix */}
                {selectedProduct && (
                  <div>
                    <FormLabel>Format mix</FormLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {FORMAT_DEFS.map(({ key, label }) => {
                        const cost = effectiveCaseCost(selectedProduct, key);
                        const disabled = cost == null;
                        return (
                          <div
                            key={key}
                            className="rounded-lg border p-3"
                            style={{
                              backgroundColor: 'var(--terminal-bg)',
                              borderColor: 'var(--terminal-border)',
                              opacity: disabled ? 0.4 : 1,
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                              <span className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                {cost != null ? formatCurrency(cost) + '/case' : 'n/a'}
                              </span>
                            </div>
                            <CounterInput
                              value={cases[key]}
                              onChange={v => setCases(prev => ({ ...prev, [key]: disabled ? 0 : v }))}
                              min={0}
                              max={50}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Teams — logos when we can map them, text fallback otherwise.
                    Combined slots ("Pirates/White Sox") show both logos. */}
                {selectedProduct && (
                  <div>
                    <FormLabel>Teams</FormLabel>
                    {teams.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading teams…</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {teams.map(t => (
                          <TeamChip
                            key={t}
                            team={t}
                            sport={selectedProduct.sport?.name}
                            selected={selectedTeams.includes(t)}
                            onClick={() => toggleTeam(t)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Player slots */}
                {selectedProduct && (
                  <div>
                    <FormLabel>Specific player slots <span className="font-normal text-[10px] opacity-60">(optional)</span></FormLabel>
                    {selectedPlayerIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {selectedPlayerIds.map(id => {
                          const p = allPlayers.find(x => x.id === id);
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
                              {p.name}
                              <span className="opacity-60 text-[10px] font-normal">{p.team}</span>
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
                        value={playerSearch}
                        onChange={e => setPlayerSearch(e.target.value)}
                        className="w-full h-10 text-sm rounded-lg border pl-9 pr-3 focus:outline-none"
                        style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    {playerSearch.trim().length > 0 && filteredPlayers.length > 0 && (
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
                              <span>{p.name}</span>
                              {p.is_rookie && (
                                <span className="text-[9px] px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>RC</span>
                              )}
                            </span>
                            <span className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>{p.team}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Total cost */}
                <div>
                  <FormLabel>Total cost</FormLabel>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl font-mono font-bold pointer-events-none" style={{ color: 'var(--text-secondary)' }}>$</span>
                    <input
                      type="number"
                      placeholder="0"
                      value={askPrice}
                      onChange={e => setAskPrice(e.target.value)}
                      disabled={!hasSelection}
                      className="w-full h-16 text-2xl font-mono font-bold rounded-lg border-2 pl-10 pr-4 focus:outline-none transition-all disabled:opacity-40"
                      style={{ backgroundColor: 'var(--terminal-bg)', borderColor: askPrice ? 'var(--accent-blue)' : 'var(--terminal-border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    Total estimated price for this combination of teams, players, and cases.
                  </p>
                </div>

                <LargeCTAButton onClick={runAnalysis} disabled={!canAnalyze} loading={running}>
                  {running ? 'Analyzing Deal…' : <><Sparkles className="w-5 h-5" /> Analyze Bundle</>}
                </LargeCTAButton>
              </div>
            </ElevatedCard>
          </div>

          {/* Result */}
          <div>
            <StepHeader stepNumber={2} title="AI Analysis" className="mb-6" />
            <ElevatedCard>
              {error && (
                <div className="rounded-lg p-4 text-sm mb-4" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid var(--signal-pass)', color: 'var(--signal-pass)' }}>
                  {error}
                </div>
              )}
              {result && !running ? (
                <AnalysisResultPanel result={result} products={products} productId={productId} />
              ) : (
                <div className="rounded-lg p-12 flex items-center justify-center border" style={{ borderColor: 'var(--terminal-border)' }}>
                  <div className="text-center">
                    <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-20" style={{ color: 'var(--text-secondary)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      Pick a product, format mix, teams or players, and a bundle price to get a verdict.
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
  const formatLine = (['hobby', 'jumbo', 'bd'] as const)
    .filter(k => result.formats[k] > 0)
    .map(k => `${result.formats[k]} ${k === 'hobby' ? 'Hobby' : k === 'bd' ? 'BD' : 'Jumbo'}`)
    .join(' + ');

  const compositionLabel = [
    result.teams.length ? `${result.teams.length} team${result.teams.length === 1 ? '' : 's'}` : null,
    result.extraPlayerNames.length ? `${result.extraPlayerNames.length} player slot${result.extraPlayerNames.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' + ');

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-6 border-2" style={{ backgroundColor: cfg.bgColor, borderColor: cfg.borderColor }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-3xl font-black" style={{ color: cfg.textColor }}>{cfg.label}</span>
          <div className="text-right">
            <p className="text-sm font-semibold font-mono" style={{ color: cfg.textColor }}>
              {Math.abs(result.valuePct).toFixed(1)}% {aboveBelow}
            </p>
          </div>
        </div>

        <div className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {compositionLabel} · {formatLine || '0 cases'}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="terminal-label mb-1">Fair Value</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(result.fairValue)}</p>
          </div>
          <div>
            <p className="terminal-label mb-1">Total Cost</p>
            <p className="font-mono text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(result.askPrice)}</p>
          </div>
        </div>

        <div className="pl-4 border-l-2 py-1" style={{ borderColor: 'var(--accent-blue)' }}>
          <p className="text-sm leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>{result.analysis}</p>
        </div>
      </div>

      {(result.teams.length > 0 || result.extraPlayerNames.length > 0) && (
        <div className="rounded-lg p-4 border" style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)' }}>
          <p className="terminal-label mb-2">Bundle composition</p>
          <div className="flex flex-wrap gap-1.5">
            {result.teams.map(t => (
              <span key={t} className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>{t}</span>
            ))}
            {result.extraPlayerNames.map(n => (
              <span
                key={n}
                className="text-[10px] font-bold px-2 py-1 rounded-full border"
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                  color: 'var(--text-primary)',
                  borderColor: 'rgba(59, 130, 246, 0.4)',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {result.topPlayers.length > 0 && (
        <div className="rounded-lg p-5 border" style={{ backgroundColor: 'var(--terminal-bg)', borderColor: 'var(--terminal-border)' }}>
          <p className="terminal-label mb-3">Top players in bundle</p>
          <div className="space-y-3">
            {result.topPlayers.map(p => (
              <div key={`${p.team}-${p.name}`} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: 'var(--terminal-border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                  <span className="text-[10px] uppercase" style={{ color: 'var(--text-tertiary)' }}>{p.team}</span>
                  {p.isRookie && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--accent-blue)', color: 'white' }}>RC</span>}
                  {p.isIcon && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--badge-icon)', color: 'var(--terminal-bg)' }}>★ Icon</span>}
                </div>
                <div className="flex items-center gap-4 font-mono text-xs">
                  <div><span className="terminal-label mr-1">EV</span><span style={{ color: 'var(--text-primary)' }}>{formatCurrency(p.evMid)}</span></div>
                  <div><span className="terminal-label mr-1">↑</span><span style={{ color: 'var(--signal-buy)' }}>{formatCurrency(p.evHigh)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.hvPlayers?.length > 0 && (
        <div className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(234,179,8,0.08)', borderColor: 'var(--signal-watch)' }}>
          <span className="text-lg">⚡</span>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--signal-watch)' }}>High Volatility Advisory</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {result.hvPlayers.join(', ')} — market pricing is unusually uncertain. EVs may shift significantly.
            </p>
          </div>
        </div>
      )}

      {result.riskFlags?.length > 0 && (
        <div className="space-y-2">
          {result.riskFlags.map((flag, i) => (
            <div key={i} className="rounded-lg p-4 border flex items-start gap-3" style={{ backgroundColor: 'rgba(239,68,68,0.05)', borderColor: 'var(--signal-pass)' }}>
              <span className="text-sm font-bold opacity-60" style={{ color: 'var(--signal-pass)' }}>⚑</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{flag.playerName}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: 'var(--signal-pass)', color: 'white' }}>
                    {FLAG_LABELS[flag.flagType] ?? flag.flagType}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{flag.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
        <Link href={`/break/${slug}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent-blue)' }}>
          View full break analysis →
        </Link>
      </div>
    </div>
  );
}
