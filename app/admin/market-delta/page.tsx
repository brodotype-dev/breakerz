import { supabaseAdmin } from '@/lib/supabase';
import { Activity, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import VerdictContextToggle from './VerdictContextToggle';
import { getTeamFairValuesForProducts } from '@/lib/team-fair-value';

// Market Delta Watch — admin-only thesis validation surface.
//
// Pulls every user_breaks row that has both an observed ask_price and a
// frozen snapshot_fair_value. Each row is one (breaker ask) vs. (our number)
// data point. The thesis we are validating: live-breaker pricing herds and is
// systematically mispriced in both directions. If the distribution is
// centered near zero with thin tails, BreakIQ is a CardHedger wrapper and the
// strategic moat doesn't exist yet. If the distribution is wide / bimodal /
// skewed, we have something to say.
//
// One row = one bundle ask, not per-slot. That's fine for v1: we're asking
// "does the breaker market consistently disagree with our number?", not
// "which slot is most mispriced." Per-slot delta is queued for v2 once we
// capture slot-level asks alongside bundle asks.

export const dynamic = 'force-dynamic';

type DeltaRow = {
  id: string;
  created_at: string;
  ask_price: number;
  fair_value: number;
  delta_pct: number;
  abs_delta: number;
  product_name: string;
  product_slug: string;
  product_lifecycle: string;
  teams: string[];
  platform: string;
  outcome: string | null;
};

// Buckets (% delta = (ask - fair) / fair × 100):
//   < -40   steal+
//   -40..-20 steal
//   -20..-5  near-fair (low)
//   -5..+5   fair
//   +5..+20  near-fair (high)
//   +20..+40 overcharge
//   > +40    overcharge+
const BUCKETS: Array<{ key: string; label: string; min: number; max: number; color: string }> = [
  { key: 'steal_plus',    label: 'Steal+',       min: -Infinity, max: -40, color: '#16a34a' },
  { key: 'steal',         label: 'Steal',        min: -40,       max: -20, color: '#22c55e' },
  { key: 'near_low',      label: 'Near (low)',   min: -20,       max: -5,  color: '#86efac' },
  { key: 'fair',          label: 'Fair',         min: -5,        max:  5,  color: 'var(--text-secondary)' },
  { key: 'near_high',     label: 'Near (high)',  min:  5,        max:  20, color: '#fca5a5' },
  { key: 'overcharge',    label: 'Overcharge',   min:  20,       max:  40, color: '#f97316' },
  { key: 'overcharge_plus', label: 'Overcharge+', min:  40,      max:  Infinity, color: '#ef4444' },
];

function bucketFor(deltaPct: number): typeof BUCKETS[number] {
  return BUCKETS.find(b => deltaPct >= b.min && deltaPct < b.max) ?? BUCKETS[3];
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Aggregate stats shared by the bundle thesis (Section 1, from user_breaks)
// and the slot thesis (Section 2, from market_observations /break-price
// captures). Pure — takes any row shape that exposes delta_pct, plus a
// per-product grouping key/name pair. Returns everything the verdict +
// stat grid + distribution + per-product breakdown components need.
interface AggregateRow {
  delta_pct: number;
  product_key: string;     // grouping key (slug or product_id)
  product_name: string;
  product_lifecycle?: string;
}
interface Aggregates {
  total: number;
  meanDelta: number;
  medianDelta: number;
  overchargeCount: number;
  stealCount: number;
  fairCount: number;
  overchargePct: number;
  stealPct: number;
  fairPct: number;
  p90: number;
  dist: Array<typeof BUCKETS[number] & { count: number }>;
  distMax: number;
  productRows: Array<{
    key: string;
    name: string;
    lifecycle: string;
    n: number;
    mean: number;
    median: number;
    overcharge: number;
    steal: number;
  }>;
}
function aggregate(rows: AggregateRow[]): Aggregates {
  const total = rows.length;
  const meanDelta = total > 0 ? rows.reduce((s, r) => s + r.delta_pct, 0) / total : 0;
  const medianDelta = median(rows.map(r => r.delta_pct));
  const overchargeCount = rows.filter(r => r.delta_pct > 20).length;
  const stealCount = rows.filter(r => r.delta_pct < -20).length;
  const fairCount = rows.filter(r => Math.abs(r.delta_pct) <= 20).length;
  const overchargePct = total > 0 ? (overchargeCount / total) * 100 : 0;
  const stealPct = total > 0 ? (stealCount / total) * 100 : 0;
  const fairPct = total > 0 ? (fairCount / total) * 100 : 0;
  const sortedAbs = rows.map(r => Math.abs(r.delta_pct)).sort((a, b) => a - b);
  const p90 = sortedAbs.length > 0 ? sortedAbs[Math.floor(sortedAbs.length * 0.9)] : 0;
  const dist = BUCKETS.map(b => ({
    ...b,
    count: rows.filter(r => r.delta_pct >= b.min && r.delta_pct < b.max).length,
  }));
  const distMax = Math.max(1, ...dist.map(d => d.count));
  const byProduct = new Map<string, { name: string; lifecycle: string; rows: AggregateRow[] }>();
  for (const r of rows) {
    if (!byProduct.has(r.product_key)) {
      byProduct.set(r.product_key, { name: r.product_name, lifecycle: r.product_lifecycle ?? '', rows: [] });
    }
    byProduct.get(r.product_key)!.rows.push(r);
  }
  const productRows = Array.from(byProduct.entries())
    .map(([key, p]) => {
      const ds = p.rows.map(r => r.delta_pct);
      return {
        key,
        name: p.name,
        lifecycle: p.lifecycle,
        n: p.rows.length,
        mean: ds.reduce((s, d) => s + d, 0) / ds.length,
        median: median(ds),
        overcharge: p.rows.filter(r => r.delta_pct > 20).length,
        steal: p.rows.filter(r => r.delta_pct < -20).length,
      };
    })
    .sort((a, b) => b.n - a.n);
  return {
    total, meanDelta, medianDelta, overchargeCount, stealCount, fairCount,
    overchargePct, stealPct, fairPct, p90, dist, distMax, productRows,
  };
}

// Thesis verdict from aggregate p90 + total. Same thresholds across both
// data sources so the directional read is consistent.
function verdictFor(agg: Aggregates): { label: string; color: string; detail: string } {
  if (agg.total < 10) {
    return { label: 'Sample too thin', color: 'var(--text-tertiary)', detail: `Need at least 10 paired observations to interpret. Currently at ${agg.total}.` };
  }
  if (agg.p90 < 15) {
    return { label: 'Herd is tight — thesis weak', color: '#f97316', detail: `90% of observed asks fall within ±${agg.p90.toFixed(0)}% of our number. If this holds, BreakIQ is close to a CardHedger wrapper.` };
  }
  if (agg.p90 < 30) {
    return { label: 'Material spread — thesis plausible', color: 'var(--accent-blue)', detail: `90% of asks fall within ±${agg.p90.toFixed(0)}% of our number. Worth investing in side-by-side surfacing.` };
  }
  return { label: 'Wide spread — thesis confirmed', color: '#22c55e', detail: `90% of asks fall within ±${agg.p90.toFixed(0)}% of our number. Breaker market is systematically mispriced. Ship the comparison UI.` };
}

type CompositionMap = Partial<Record<'hobby' | 'bd' | 'jumbo', number | null>>;

type BreakPriceCapture = {
  id: string;
  observed_at: string;
  product_id: string | null;
  product_name: string;
  scope_type: string;
  scope_label: string;
  composition: CompositionMap;
  compositionLabel: string;
  isMixed: boolean;
  source: string;
  source_type: 'competitor_listing' | 'breaker_estimate' | 'historical_sale' | null;
  price_low: number;
  price_high: number;
  narrative: string;
  // Slice B — delta vs. our per-team fair value for this capture's scope.
  // null when we can't compute (no product_id, scope isn't a team, no
  // pricing_cache, or composition is mixed/unknown). Reference unit is
  // 1-case-equivalent; see lib/team-fair-value.ts.
  delta_pct: number | null;
  fair_value: number | null;
};

function renderComposition(comp: CompositionMap): string {
  const ORDER: Array<'hobby' | 'bd' | 'jumbo'> = ['hobby', 'bd', 'jumbo'];
  const present = ORDER.filter(k => comp[k] !== undefined);
  if (present.length === 0) return '—';
  if (present.length === 1) {
    const k = present[0];
    const v = comp[k];
    return v == null ? k : `${k} ×${v}`;
  }
  return present.map(k => {
    const v = comp[k];
    return v == null ? k : `${k} ${v}`;
  }).join(' + ');
}

function parseCompositionFromPayload(payload: Record<string, unknown>): CompositionMap {
  // Prefer new shape; fall back to legacy `format` for rows that haven't
  // been backfilled yet so the admin panel doesn't render "—" on stale data.
  const composition = payload.composition as Record<string, unknown> | undefined;
  if (composition && typeof composition === 'object') {
    const out: CompositionMap = {};
    for (const k of ['hobby', 'bd', 'jumbo'] as const) {
      if (k in composition) {
        const v = composition[k];
        out[k] = v == null ? null : Number(v);
      }
    }
    return out;
  }
  const legacy = payload.format as string | undefined;
  if (legacy === 'hobby' || legacy === 'bd' || legacy === 'jumbo') {
    return { [legacy]: null };
  }
  return {};
}

type SourceTypeFilter = 'all' | 'competitor_listing' | 'breaker_estimate' | 'historical_sale';

export default async function MarketDeltaPage({
  searchParams,
}: {
  searchParams: Promise<{ source_type?: string }>;
}) {
  const params = await searchParams;
  const rawFilter = params.source_type;
  const sourceTypeFilter: SourceTypeFilter =
    rawFilter === 'competitor_listing' || rawFilter === 'breaker_estimate' || rawFilter === 'historical_sale'
      ? rawFilter
      : 'all';

  // Slice 2b — feature flag for verdict observation enrichment.
  // Read server-side so the toggle hydrates with the current state.
  const { data: flagRow } = await supabaseAdmin
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'verdict_observation_context_enabled')
    .maybeSingle();
  const verdictEnrichmentEnabled = !!flagRow?.enabled;
  const { data: rows } = await supabaseAdmin
    .from('user_breaks')
    .select(`
      id, created_at, ask_price, snapshot_fair_value, teams, platform, outcome, status,
      product:products(name, slug, lifecycle_status)
    `)
    .not('snapshot_fair_value', 'is', null)
    .not('ask_price', 'is', null)
    .neq('status', 'abandoned')
    .gt('snapshot_fair_value', 0)
    .order('created_at', { ascending: false })
    .limit(2000);

  const deltas: DeltaRow[] = (rows ?? [])
    .map((r: any) => {
      const fair = Number(r.snapshot_fair_value);
      const ask = Number(r.ask_price);
      if (!fair || !ask) return null;
      const delta_pct = ((ask - fair) / fair) * 100;
      return {
        id: r.id,
        created_at: r.created_at,
        ask_price: ask,
        fair_value: fair,
        delta_pct,
        abs_delta: ask - fair,
        product_name: r.product?.name ?? 'Unknown',
        product_slug: r.product?.slug ?? '',
        product_lifecycle: r.product?.lifecycle_status ?? 'live',
        teams: r.teams ?? [],
        platform: r.platform ?? 'other',
        outcome: r.outcome,
      } as DeltaRow;
    })
    .filter((r): r is DeltaRow => r !== null);

  // /break-price captures — recent asking_price observations from
  // market_observations (live capture path, parallel to user_breaks).
  // Pulling player names separately because Postgres doesn't auto-join
  // when scope_id can be either a player or null.
  const { data: obsRows } = await supabaseAdmin
    .from('market_observations')
    .select(`
      id, observed_at, product_id, scope_type, scope_id, scope_team, payload, source_narrative,
      product:products(name)
    `)
    .eq('observation_type', 'asking_price')
    .is('superseded_at', null)
    .order('observed_at', { ascending: false })
    .limit(50);

  // Slice B — batch-fetch per-team fair values for every distinct product
  // referenced in the captures list. Dedupes by product_id; one
  // `pricing_cache` query per product (chunked internally for large
  // rosters). Avoids N+1 over the captures map below.
  const captureProductIds = Array.from(
    new Set(((obsRows ?? []).map((r: any) => r.product_id).filter(Boolean) as string[])),
  );
  const fairValuesByProduct = await getTeamFairValuesForProducts(captureProductIds);

  const playerScopeIds = Array.from(
    new Set(
      (obsRows ?? [])
        .filter((r: any) => (r.scope_type === 'player' || r.scope_type === 'variant') && r.scope_id)
        .map((r: any) => r.scope_id as string),
    ),
  );
  const playerNameById = new Map<string, string>();
  if (playerScopeIds.length > 0) {
    const { data: playerRows } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', playerScopeIds);
    for (const p of playerRows ?? []) playerNameById.set(p.id, p.name);
  }

  const allCaptures: BreakPriceCapture[] = (obsRows ?? []).map((r: any) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    let scopeLabel = '—';
    if (r.scope_type === 'team') scopeLabel = r.scope_team ?? '—';
    else if (r.scope_type === 'player') scopeLabel = playerNameById.get(r.scope_id) ?? '(player)';
    else if (r.scope_type === 'variant') scopeLabel = `${playerNameById.get(r.scope_id) ?? '(player)'} · ${payload.variant_name ?? 'variant'}`;
    else if (r.scope_type === 'product') scopeLabel = '(entire product)';

    const composition = parseCompositionFromPayload(payload);
    const compositionLabel = renderComposition(composition);
    const isMixed = Object.keys(composition).length > 1;
    const rawSourceType = payload.source_type as string | undefined;
    const source_type =
      rawSourceType === 'competitor_listing' || rawSourceType === 'breaker_estimate' || rawSourceType === 'historical_sale'
        ? rawSourceType
        : null; // legacy rows without source_type render as "—"

    const price_low = Number(payload.price_low) || 0;
    const price_high = Number(payload.price_high) || 0;

    // Slice B — delta vs. our per-team fair value. Only computed for
    // team-scoped, single-format captures with a snapshot for the product.
    // Mixed compositions are out of scope for the 1-case-equivalent
    // reference (engine would need a custom case mix); player/variant/
    // product scopes don't have a per-team comparable; legacy rows
    // without composition/format get skipped.
    let delta_pct: number | null = null;
    let fair_value: number | null = null;
    if (
      r.scope_type === 'team'
      && r.scope_team
      && r.product_id
      && !isMixed
      && Object.keys(composition).length === 1
    ) {
      const snapshot = fairValuesByProduct.get(r.product_id);
      const teamFv = snapshot?.teams.get(r.scope_team);
      const fmt = Object.keys(composition)[0] as 'hobby' | 'bd' | 'jumbo';
      const teamRef = teamFv
        ? (fmt === 'hobby' ? teamFv.marketHobby : fmt === 'bd' ? teamFv.marketBd : teamFv.marketJumbo)
        : 0;
      if (teamRef > 0) {
        const askMid = (price_low + price_high) / 2;
        fair_value = teamRef;
        delta_pct = ((askMid - teamRef) / teamRef) * 100;
      }
    }

    return {
      id: r.id,
      observed_at: r.observed_at,
      product_id: (r.product_id as string | null) ?? null,
      product_name: r.product?.name ?? 'Unknown',
      scope_type: r.scope_type,
      scope_label: scopeLabel,
      composition,
      compositionLabel,
      isMixed,
      source: (payload.source as string) ?? '—',
      source_type,
      price_low,
      price_high,
      narrative: r.source_narrative ?? '',
      delta_pct,
      fair_value,
    };
  });

  // Distribution counter — computed before filtering so the user sees the
  // full denominator. Filter dropdown narrows the list, not the totals.
  const totalCaptures = allCaptures.length;
  const pureFormatCount = allCaptures.filter(c => !c.isMixed).length;
  const mixedCount = allCaptures.filter(c => c.isMixed).length;
  const listingCount = allCaptures.filter(c => c.source_type === 'competitor_listing').length;
  const estimateCount = allCaptures.filter(c => c.source_type === 'breaker_estimate').length;
  const saleCount = allCaptures.filter(c => c.source_type === 'historical_sale').length;

  const captures =
    sourceTypeFilter === 'all'
      ? allCaptures
      : allCaptures.filter(c => c.source_type === sourceTypeFilter);

  // Section 1 — Logged-breaks thesis (user-submitted bundle asks via My Breaks).
  const bundleAgg = aggregate(deltas.map(r => ({
    delta_pct: r.delta_pct,
    product_key: r.product_slug || r.product_name,
    product_name: r.product_name,
    product_lifecycle: r.product_lifecycle,
  })));
  const bundleVerdict = verdictFor(bundleAgg);

  // Section 2 — Observed slot-pricing thesis (Discord /break-price captures).
  // Filter to team-scoped captures with a computable delta_pct (single-format,
  // product has the relevant SKU). Mixed/legacy captures excluded from the
  // aggregates; the table below still shows them with "—" delta.
  const slotDeltaRows = allCaptures
    .filter(c => c.delta_pct !== null && c.product_id)
    .map(c => ({
      delta_pct: c.delta_pct as number,
      product_key: c.product_id ?? c.product_name,
      product_name: c.product_name,
      product_lifecycle: '',
    }));
  const slotAgg = aggregate(slotDeltaRows);
  const slotVerdict = verdictFor(slotAgg);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl p-8"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div
          className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
        />
        <div className="relative">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Market Delta Watch</h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Two thesis views, each at a different unit of measure. <span style={{ color: 'var(--text-primary)' }}>Logged breaks</span> = bundle asks from My Breaks (one row = one whole-break ask vs. our number). <span style={{ color: 'var(--text-primary)' }}>Observed break pricing</span> = slot asks from Discord <code>/break-price</code> captures (one row = one team-slot ask vs. our model). Both validate the herd-mispricing thesis at their own scale.
              </p>
            </div>
          </div>

          {/* Section 1 banner */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-blue)' }}>
              Section 1 · Logged breaks
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              user-submitted bundle asks via /my-breaks
            </span>
          </div>

          {/* Verdict (bundle) */}
          <div
            className="rounded-xl p-4 mb-4"
            style={{
              backgroundColor: 'rgba(19, 24, 32, 0.6)',
              border: `1px solid ${bundleVerdict.color}`,
              boxShadow: `0 0 24px ${bundleVerdict.color}22`,
            }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Thesis verdict — bundle asks
            </div>
            <div className="text-lg font-bold mb-1" style={{ color: bundleVerdict.color }}>
              {bundleVerdict.label}
            </div>
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {bundleVerdict.detail}
            </div>
          </div>

          {/* Stat grid (bundle) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Observations" value={String(bundleAgg.total)} sub={`since 2026-04-09`} />
            <StatCard label="Mean delta" value={`${bundleAgg.meanDelta >= 0 ? '+' : ''}${bundleAgg.meanDelta.toFixed(1)}%`} sub={`median ${bundleAgg.medianDelta >= 0 ? '+' : ''}${bundleAgg.medianDelta.toFixed(1)}%`} />
            <StatCard label="Overcharge" value={`${bundleAgg.overchargePct.toFixed(0)}%`} sub={`${bundleAgg.overchargeCount} of ${bundleAgg.total}`} color="#f97316" icon={TrendingUp} />
            <StatCard label="Steal" value={`${bundleAgg.stealPct.toFixed(0)}%`} sub={`${bundleAgg.stealCount} of ${bundleAgg.total}`} color="#22c55e" icon={TrendingDown} />
          </div>
        </div>
      </div>

      {/* Distribution (bundle) */}
      <Section title="Bundle delta distribution" subtitle="How logged-break asks distribute against our number">
        <div className="space-y-2 px-1">
          {bundleAgg.dist.map(b => (
            <div key={b.key} className="flex items-center gap-3">
              <div className="w-28 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{b.label}</div>
              <div className="flex-1 h-6 rounded overflow-hidden" style={{ backgroundColor: 'var(--terminal-bg)' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${(b.count / bundleAgg.distMax) * 100}%`,
                    backgroundColor: b.color,
                    minWidth: b.count > 0 ? '2px' : '0',
                  }}
                />
              </div>
              <div className="w-16 text-right text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{b.count}</div>
              <div className="w-12 text-right text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                {bundleAgg.total > 0 ? `${((b.count / bundleAgg.total) * 100).toFixed(0)}%` : '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 px-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Fair = within ±5% · Near = within ±20% · Overcharge/Steal = ±20–40% · ± = {'>'}40%. {bundleAgg.fairPct.toFixed(0)}% of asks fall inside ±20% of our number.
        </div>
      </Section>

      {/* Per-product (bundle) */}
      {bundleAgg.productRows.length > 0 && (
        <Section title="Bundle per-product breakdown" subtitle="Where the spread is concentrated across logged breaks">
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
            <div
              className="grid grid-cols-12 gap-4 px-6 py-3 border-b text-[10px] font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}
            >
              <div className="col-span-5">Product</div>
              <div className="col-span-1 text-right">N</div>
              <div className="col-span-2 text-right">Mean Δ</div>
              <div className="col-span-2 text-right">Median Δ</div>
              <div className="col-span-1 text-right" style={{ color: '#f97316' }}>O</div>
              <div className="col-span-1 text-right" style={{ color: '#22c55e' }}>S</div>
            </div>
            {bundleAgg.productRows.map(p => (
              <div
                key={p.key}
                className="grid grid-cols-12 gap-4 px-6 py-3 border-b last:border-b-0 items-center"
                style={{ borderColor: 'var(--terminal-border)' }}
              >
                <div className="col-span-5">
                  <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{p.lifecycle}</p>
                </div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{p.n}</div>
                <div className="col-span-2 text-right font-mono text-sm" style={{ color: p.mean > 5 ? '#f97316' : p.mean < -5 ? '#22c55e' : 'var(--text-primary)' }}>
                  {p.mean >= 0 ? '+' : ''}{p.mean.toFixed(1)}%
                </div>
                <div className="col-span-2 text-right font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {p.median >= 0 ? '+' : ''}{p.median.toFixed(1)}%
                </div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: '#f97316' }}>{p.overcharge}</div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: '#22c55e' }}>{p.steal}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 px-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            O = overcharges (delta &gt; +20%) · S = steals (delta &lt; −20%). Ordered by observation count.
          </div>
        </Section>
      )}

      {/* Recent rows (bundle) */}
      {deltas.length > 0 && (
        <Section title="Recent bundle observations" subtitle="Most recent 50 paired bundle asks from My Breaks">
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
            <div
              className="grid grid-cols-12 gap-3 px-4 py-2 border-b text-[10px] font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}
            >
              <div className="col-span-2">When</div>
              <div className="col-span-3">Product</div>
              <div className="col-span-2">Teams</div>
              <div className="col-span-1 text-right">Ask</div>
              <div className="col-span-2 text-right">Our fair</div>
              <div className="col-span-1 text-right">Δ %</div>
              <div className="col-span-1 text-right">Bucket</div>
            </div>
            {deltas.slice(0, 50).map(r => {
              const b = bucketFor(r.delta_pct);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-12 gap-3 px-4 py-2 border-b last:border-b-0 items-center text-xs"
                  style={{ borderColor: 'var(--terminal-border)' }}
                >
                  <div className="col-span-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div className="col-span-3 truncate" style={{ color: 'var(--text-secondary)' }}>{r.product_name}</div>
                  <div className="col-span-2 truncate" style={{ color: 'var(--text-secondary)' }}>{r.teams.join(', ') || '—'}</div>
                  <div className="col-span-1 text-right font-mono" style={{ color: 'var(--text-primary)' }}>${r.ask_price.toFixed(0)}</div>
                  <div className="col-span-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>${r.fair_value.toFixed(0)}</div>
                  <div className="col-span-1 text-right font-mono font-bold" style={{ color: b.color }}>
                    {r.delta_pct >= 0 ? '+' : ''}{r.delta_pct.toFixed(0)}%
                  </div>
                  <div className="col-span-1 text-right text-[10px] font-bold uppercase" style={{ color: b.color }}>{b.label}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ─── Section 2 — Observed break pricing (slot-level captures) ─── */}

      {/* Section 2 banner — visually divides the two thesis views so the
          unit of measure is obvious at a glance. */}
      <div
        className="rounded-2xl px-6 py-5"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent-orange)' }}>
            Section 2 · Observed break pricing
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            Discord /break-price slot captures · per-team-slot ask vs. our model
          </span>
        </div>

        {/* Verdict (slot) */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            backgroundColor: 'rgba(19, 24, 32, 0.6)',
            border: `1px solid ${slotVerdict.color}`,
            boxShadow: `0 0 24px ${slotVerdict.color}22`,
          }}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Thesis verdict — slot captures
          </div>
          <div className="text-lg font-bold mb-1" style={{ color: slotVerdict.color }}>
            {slotVerdict.label}
          </div>
          <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {slotVerdict.detail}
            {slotAgg.total < totalCaptures && (
              <span style={{ color: 'var(--text-tertiary)' }}>
                {' '}({totalCaptures - slotAgg.total} of {totalCaptures} captures excluded — mixed composition or missing per-team fair value.)
              </span>
            )}
          </div>
        </div>

        {/* Stat grid (slot) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Captures with Δ" value={String(slotAgg.total)} sub={`of ${totalCaptures} total`} />
          <StatCard label="Mean delta" value={`${slotAgg.meanDelta >= 0 ? '+' : ''}${slotAgg.meanDelta.toFixed(1)}%`} sub={`median ${slotAgg.medianDelta >= 0 ? '+' : ''}${slotAgg.medianDelta.toFixed(1)}%`} />
          <StatCard label="Overcharge" value={`${slotAgg.overchargePct.toFixed(0)}%`} sub={`${slotAgg.overchargeCount} of ${slotAgg.total}`} color="#f97316" icon={TrendingUp} />
          <StatCard label="Steal" value={`${slotAgg.stealPct.toFixed(0)}%`} sub={`${slotAgg.stealCount} of ${slotAgg.total}`} color="#22c55e" icon={TrendingDown} />
        </div>
      </div>

      {/* Distribution (slot) */}
      {slotAgg.total > 0 && (
        <Section title="Slot delta distribution" subtitle="How /break-price slot asks distribute against our model">
          <div className="space-y-2 px-1">
            {slotAgg.dist.map(b => (
              <div key={b.key} className="flex items-center gap-3">
                <div className="w-28 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{b.label}</div>
                <div className="flex-1 h-6 rounded overflow-hidden" style={{ backgroundColor: 'var(--terminal-bg)' }}>
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(b.count / slotAgg.distMax) * 100}%`,
                      backgroundColor: b.color,
                      minWidth: b.count > 0 ? '2px' : '0',
                    }}
                  />
                </div>
                <div className="w-16 text-right text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{b.count}</div>
                <div className="w-12 text-right text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  {slotAgg.total > 0 ? `${((b.count / slotAgg.total) * 100).toFixed(0)}%` : '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 px-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Same bucket boundaries as the bundle distribution above. {slotAgg.fairPct.toFixed(0)}% of slot asks fall inside ±20% of our model.
          </div>
        </Section>
      )}

      {/* Per-product (slot) */}
      {slotAgg.productRows.length > 0 && (
        <Section title="Slot per-product breakdown" subtitle="Where the spread is concentrated across /break-price captures">
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
            <div
              className="grid grid-cols-12 gap-4 px-6 py-3 border-b text-[10px] font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}
            >
              <div className="col-span-5">Product</div>
              <div className="col-span-1 text-right">N</div>
              <div className="col-span-2 text-right">Mean Δ</div>
              <div className="col-span-2 text-right">Median Δ</div>
              <div className="col-span-1 text-right" style={{ color: '#f97316' }}>O</div>
              <div className="col-span-1 text-right" style={{ color: '#22c55e' }}>S</div>
            </div>
            {slotAgg.productRows.map(p => (
              <div
                key={p.key}
                className="grid grid-cols-12 gap-4 px-6 py-3 border-b last:border-b-0 items-center"
                style={{ borderColor: 'var(--terminal-border)' }}
              >
                <div className="col-span-5">
                  <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                </div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{p.n}</div>
                <div className="col-span-2 text-right font-mono text-sm" style={{ color: p.mean > 5 ? '#f97316' : p.mean < -5 ? '#22c55e' : 'var(--text-primary)' }}>
                  {p.mean >= 0 ? '+' : ''}{p.mean.toFixed(1)}%
                </div>
                <div className="col-span-2 text-right font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {p.median >= 0 ? '+' : ''}{p.median.toFixed(1)}%
                </div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: '#f97316' }}>{p.overcharge}</div>
                <div className="col-span-1 text-right font-mono text-sm" style={{ color: '#22c55e' }}>{p.steal}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Slice 2b — admin toggle for verdict observation enrichment.
          Lives inside Section 2 because /break-price captures are exactly
          the data this toggle plumbs into the AI verdict prompt. */}
      <VerdictContextToggle initialEnabled={verdictEnrichmentEnabled} />

      {/* Recent slot captures — observations from the Discord capture path.
          Same data as Section 2 aggregates above but rendered as a row-by-row
          table for spot-checking individual captures. */}
      {totalCaptures > 0 && (
        <Section title="Recent slot captures" subtitle={`${totalCaptures} most recent /break-price observations`}>
          {/* Distribution counter — shows composition + source-type split
              for the unfiltered set so filter doesn't lie about volume. */}
          <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-1 rounded font-mono" style={{ backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}>
              {pureFormatCount} pure-format · {mixedCount} mixed
            </span>
            <span className="px-2 py-1 rounded font-mono" style={{ backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)', border: '1px solid var(--terminal-border)' }}>
              {listingCount} listings · {estimateCount} estimates · {saleCount} sales
            </span>
          </div>

          {/* Filter — anchor tags so the page stays server-rendered.
              Selected pill highlighted blue. */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              { v: 'all', label: 'All' },
              { v: 'competitor_listing', label: 'Listings' },
              { v: 'breaker_estimate', label: 'Estimates' },
              { v: 'historical_sale', label: 'Sales' },
            ] as Array<{ v: SourceTypeFilter; label: string }>).map(opt => {
              const selected = sourceTypeFilter === opt.v;
              const href = opt.v === 'all' ? '/admin/market-delta' : `/admin/market-delta?source_type=${opt.v}`;
              return (
                <a
                  key={opt.v}
                  href={href}
                  className="text-[11px] px-2.5 py-1 rounded font-semibold transition-colors"
                  style={{
                    backgroundColor: selected ? 'rgba(59,130,246,0.15)' : 'var(--terminal-surface)',
                    color: selected ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--terminal-border)'}`,
                  }}
                >
                  {opt.label}
                </a>
              );
            })}
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
            <div
              className="grid grid-cols-13 gap-3 px-4 py-2 border-b text-[10px] font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)', gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}
            >
              <div className="col-span-2">When</div>
              <div className="col-span-3">Product</div>
              <div className="col-span-3">Scope</div>
              <div className="col-span-1 text-center">Comp</div>
              <div className="col-span-2 text-right">Ask</div>
              <div className="col-span-1 text-right">Δ vs model</div>
              <div className="col-span-1 text-right">Kind</div>
            </div>
            {captures.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No captures match the current filter.
              </div>
            ) : captures.map(c => {
              const deltaColor = c.delta_pct === null
                ? 'var(--text-tertiary)'
                : c.delta_pct >= 20 ? '#ef4444'
                : c.delta_pct <= -20 ? '#22c55e'
                : 'var(--text-secondary)';
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-13 gap-3 px-4 py-2 border-b last:border-b-0 items-center text-xs"
                  style={{ borderColor: 'var(--terminal-border)', gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}
                >
                  <div className="col-span-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(c.observed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                  <div className="col-span-3 truncate" style={{ color: 'var(--text-secondary)' }}>{c.product_name}</div>
                  <div className="col-span-3 truncate" style={{ color: 'var(--text-primary)' }}>
                    <span className="text-[9px] uppercase tracking-widest mr-1.5" style={{ color: 'var(--text-tertiary)' }}>{c.scope_type}</span>
                    {c.scope_label}
                  </div>
                  <div className="col-span-1 text-center text-[10px] font-mono font-bold" style={{ color: c.isMixed ? 'var(--accent-orange)' : 'var(--accent-blue)' }}>
                    {c.compositionLabel}
                  </div>
                  <div className="col-span-2 text-right font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                    {c.price_low === c.price_high
                      ? `$${c.price_low.toLocaleString()}`
                      : `$${c.price_low.toLocaleString()}–${c.price_high.toLocaleString()}`}
                  </div>
                  <div
                    className="col-span-1 text-right font-mono"
                    style={{ color: deltaColor }}
                    title={c.fair_value !== null ? `Model: $${Math.round(c.fair_value).toLocaleString()} (1-case ref)` : c.isMixed ? 'Mixed composition — skipped' : 'No team fair value available'}
                  >
                    {c.delta_pct === null ? '—' : `${c.delta_pct >= 0 ? '+' : ''}${c.delta_pct.toFixed(0)}%`}
                  </div>
                  <div className="col-span-1 text-right text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {c.source_type === 'competitor_listing' ? 'listing'
                      : c.source_type === 'breaker_estimate' ? 'estimate'
                      : c.source_type === 'historical_sale' ? 'sale'
                      : '—'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 px-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Δ vs model uses a 1-case-equivalent per-team fair value (matches the consumer page math; applies lifecycle-aware market markup). Mixed-composition captures show "—" until per-mix engine reference math ships.
          </div>
        </Section>
      )}

      {bundleAgg.total === 0 && totalCaptures === 0 && (
        <div className="rounded-xl border p-8 text-center" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
          <Scale className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No paired observations yet. Bundle asks land when consumers log a break through My Breaks. Slot captures land when contributors fire /break-price in Discord.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color = 'var(--text-primary)',
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ElementType;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 backdrop-blur-sm"
      style={{ backgroundColor: 'rgba(19, 24, 32, 0.6)', border: '1px solid var(--terminal-border-hover)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
        <div className="terminal-label-muted">{label}</div>
      </div>
      <div className="text-2xl font-bold font-mono leading-tight" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          {subtitle && <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
