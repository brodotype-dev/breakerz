'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import PlayerTable from '@/components/breakiq/PlayerTable';
import TeamSlotsTable from '@/components/breakiq/TeamSlotsTable';
import TopMoversWidget from '@/components/breakiq/TopMoversWidget';
import ChaseCardsPanel from '@/components/breakiq/ChaseCardsPanel';
import PlayerDetailDrawer from '@/components/breakiq/PlayerDetailDrawer';
import { SegmentedControl, CounterInput } from '@/components/breakiq/ds';
import { computeSlotPricing, computeTeamSlotPricing, formatCurrency } from '@/lib/engine';
import type { BreakConfig, ChaseCard, PlayerWithPricing, Product, Sport } from '@/lib/types';

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

  const [chaseCards, setChaseCards] = useState<ChaseCard[]>([]);
  const [activePlayerProductId, setActivePlayerProductId] = useState<string | null>(null);
  const [breakType, setBreakType] = useState<'hobby' | 'bd'>('hobby');
  const [activeTab, setActiveTab] = useState<'teams' | 'players'>('teams');

  const [config, setConfig] = useState<BreakConfig>({
    hobbyCases: 10,
    bdCases: 10,
    hobbyCaseCost: 0,
    bdCaseCost: 0,
  });
  const [hobbyMsrp, setHobbyMsrp] = useState<number | null>(null);
  const [hobbyAmPrice, setHobbyAmPrice] = useState<number | null>(null);
  const [bdMsrp, setBdMsrp] = useState<number | null>(null);
  const [bdAmPrice, setBdAmPrice] = useState<number | null>(null);

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
        setConfig(prev => ({
          ...prev,
          hobbyCaseCost: prod.hobby_am_case_cost ?? prod.hobby_case_cost ?? prev.hobbyCaseCost,
          bdCaseCost: prod.bd_am_case_cost ?? prod.bd_case_cost ?? prev.bdCaseCost,
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
        setRawPlayers(playerList);
        setChaseCards((chaseRes.data ?? []) as ChaseCard[]);

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

        <div className="relative px-6 py-6">
          {/* Back nav */}
          <Link href="/">
            <button
              className="flex items-center gap-2 text-xs font-semibold mb-5 px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
              style={{ color: 'white', backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Products
            </button>
          </Link>

          <div className="flex items-start justify-between flex-wrap gap-5">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg backdrop-blur-sm"
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', letterSpacing: '0.06em' }}
                >
                  {product.sport?.name}
                </span>
                <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{product.year}</span>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{product.manufacturer}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-white mb-3">{product.name}</h1>
              <div className="flex items-center gap-3 flex-wrap">
                {hasPricing && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg backdrop-blur-sm" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-white inline-block" />
                    <span className="text-xs font-semibold text-white">{pricedCount}/{players.length} priced</span>
                  </div>
                )}
                {!product.has_odds && (
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg backdrop-blur-sm" style={{ backgroundColor: 'rgba(245,158,11,0.3)' }}>
                    <span className="text-xs font-medium" style={{ color: '#fef3c7' }}>No odds · EV-only weighting</span>
                    <OddsTooltip />
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em' }}>
                  Break Type
                </div>
                <SegmentedControl
                  value={breakType}
                  onChange={v => setBreakType(v as 'hobby' | 'bd')}
                  options={[
                    { value: 'hobby', label: 'Hobby' },
                    { value: 'bd',    label: "Breaker's Delight" },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info banners */}
      {isPreRelease && product.release_date && (
        <div className="border-b px-6 py-3" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(59,130,246,0.08)' }}>
          <p className="text-xs font-semibold" style={{ color: '#93c5fd' }}>
            Pre-release · {product.name} launches {formatReleaseDate(product.release_date)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
            Slot values are approximations from historical comps. Prices update once the market establishes real sales.
          </p>
        </div>
      )}
      {!isPreRelease && estimatedCount > 0 && (
        <div className="border-b px-6 py-2.5 flex items-center gap-2" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(245,158,11,0.06)' }}>
          <span className="text-[10px]" style={{ color: '#f59e0b' }}>▲</span>
          <p className="text-xs" style={{ color: 'var(--text-t-secondary)' }}>
            {estimatedCount} player{estimatedCount !== 1 ? 's' : ''} using estimated pricing — approximations based on historical comps.
          </p>
        </div>
      )}
      {!isPreRelease && hasPricing && (
        <div className="border-b px-6 py-2 flex items-center gap-2" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(148,163,184,0.05)' }}>
          <span className="text-[10px]" style={{ color: 'var(--text-t-tertiary)' }}>◎</span>
          <p className="text-[11px]" style={{ color: 'var(--text-t-tertiary)' }}>
            EV values reflect <strong>raw</strong> card sale prices. Graded (PSA 9 / PSA 10) comps are not included — per-player graded drilldown coming soon.
          </p>
        </div>
      )}

      <main className="px-4 md:px-6 py-6 space-y-5 max-w-[1400px] mx-auto">
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

        {/* Cases counter + cost summary */}
        <div
          className="flex items-center gap-4 flex-wrap px-4 py-2.5 rounded-lg"
          style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              {breakType === 'hobby' ? 'Hobby Cases' : 'BD Cases'}
            </span>
            <CounterInput
              value={breakType === 'hobby' ? config.hobbyCases : config.bdCases}
              onChange={v => setConfig(prev => breakType === 'hobby' ? { ...prev, hobbyCases: v } : { ...prev, bdCases: v })}
              min={1}
            />
          </div>
          {(() => {
            const cases = breakType === 'hobby' ? config.hobbyCases : config.bdCases;
            const cost = breakType === 'hobby' ? config.hobbyCaseCost : config.bdCaseCost;
            const amPrice = breakType === 'hobby' ? hobbyAmPrice : bdAmPrice;
            const msrp = breakType === 'hobby' ? hobbyMsrp : bdMsrp;
            const priceLabel = amPrice != null ? 'market' : msrp != null ? 'MSRP' : null;
            if (cost <= 0) return null;
            return (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(cases * cost)}
                </span>
                {priceLabel && (
                  <span className="text-[10px]" style={{ color: amPrice != null ? 'var(--accent-orange)' : 'var(--text-disabled)' }}>
                    ({priceLabel})
                  </span>
                )}
              </div>
            );
          })()}
        </div>

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
          {activeTab === 'teams' && <TeamSlotsTable teams={teamSlots} breakType={breakType} riskFlagMap={riskFlagMap} />}
          {activeTab === 'players' && (
            <PlayerTable
              players={players}
              breakType={breakType}
              riskFlagMap={riskFlagMap}
              onPlayerClick={id => setActivePlayerProductId(id)}
            />
          )}
        </div>
      </main>

      <PlayerDetailDrawer
        playerProductId={activePlayerProductId}
        onClose={() => setActivePlayerProductId(null)}
      />
    </div>
  );
}
