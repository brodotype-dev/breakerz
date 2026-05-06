'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, AlertCircle, MessageSquare, TrendingUp, TrendingDown } from 'lucide-react';
import ChaseHeartButton from '@/components/breakiq/ChaseHeartButton';
import { IconPlayerBadge, BullishBadge, BearishBadge, RiskFlagBadge } from '@/components/breakiq/SocialBadges';
import { computeEffectiveScore, formatCurrency } from '@/lib/engine';

type Lifecycle = 'pre_release' | 'live' | 'dormant';

type ProductEntry = {
  player_product_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  year: string | null;
  manufacturer: string | null;
  sport: string | null;
  lifecycle_status: Lifecycle;
  is_active: boolean;
  ev_mid: number | null;
  ev_low: number | null;
  ev_high: number | null;
  fetched_at: string | null;
  cardhedger_card_id: string | null;
  buzz_score: number;
  breakerz_score: number;
  breakerz_note: string | null;
};

type Comp = { sale_price: number; sale_date: string; grade: string; platform: string };

type RiskFlag = {
  flag_type: string;
  note: string | null;
  created_at: string;
  product: { name: string; slug: string } | null;
};

type SentimentRow = {
  id: string;
  prev_score: number | null;
  new_score: number | null;
  prev_note: string | null;
  new_note: string | null;
  source: string;
  source_narrative: string | null;
  created_at: string;
};

type ObsRow = {
  id: string;
  observation_type: string;
  scope_type: string;
  scope_id: string | null;
  payload: Record<string, unknown> | null;
  source_narrative: string | null;
  observed_at: string;
  expires_at: string | null;
  superseded_at: string | null;
  products: { name: string; slug: string } | null;
};

type ProfileResponse = {
  player: {
    id: string;
    name: string;
    team: string | null;
    sport: string | null;
    is_rookie: boolean;
    is_icon: boolean;
    buzz_score: number;
    breakerz_score: number;
    breakerz_note: string | null;
  };
  featured_market: {
    ev_low: number | null;
    ev_mid: number | null;
    ev_high: number | null;
    fetched_at: string | null;
    product_name: string;
    product_slug: string;
  } | null;
  products: ProductEntry[];
  recent_comps: Comp[];
  insights: {
    risk_flags: RiskFlag[];
    sentiment: SentimentRow[];
    observations: ObsRow[];
  };
};

const LIFECYCLE_LABELS: Record<Lifecycle, { text: string; bg: string; fg: string }> = {
  live: { text: 'LIVE', bg: 'rgba(34,197,94,0.14)', fg: '#22c55e' },
  pre_release: { text: 'PRE-RELEASE', bg: 'rgba(168,85,247,0.14)', fg: '#a855f7' },
  dormant: { text: 'DORMANT', bg: 'rgba(148,163,184,0.14)', fg: '#94a3b8' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/player-profile?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => { if (!cancelled) setError('Failed to load player profile'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading player…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm" style={{ color: '#ef4444' }}>{error ?? 'Player not found'}</p>
        <Link href="/chase" className="text-xs underline" style={{ color: 'var(--accent-blue)' }}>Back to chase</Link>
      </div>
    );
  }

  const score = computeEffectiveScore(data.player.buzz_score, data.player.breakerz_score, data.player.is_icon);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Hero */}
      <div
        className="relative overflow-hidden border-b"
        style={{ background: 'var(--gradient-hero)', borderColor: 'var(--terminal-border)' }}
      >
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, var(--accent-blue) 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="relative px-4 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto">
          <Link href="/chase" className="inline-flex items-center gap-1.5 text-xs font-medium mb-3 hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Chase
          </Link>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <ChaseHeartButton playerId={data.player.id} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {data.player.name}
                  </h1>
                  {data.player.is_rookie && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}>RC</span>
                  )}
                  {data.player.is_icon && <IconPlayerBadge />}
                  {score > 0.1 && <BullishBadge />}
                  {score < -0.1 && <BearishBadge />}
                </div>
                <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {[data.player.team, data.player.sport].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </div>

            {data.featured_market?.ev_mid != null && (
              <Link
                href={`/break/${data.featured_market.product_slug}`}
                className="rounded-lg px-3 py-2 transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                style={{ border: '1px solid var(--terminal-border)' }}
              >
                <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  Latest EV Mid
                </div>
                <div className="text-base font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                  {formatCurrency(data.featured_market.ev_mid)}
                </div>
                <div className="text-[10px] truncate max-w-[200px]" style={{ color: 'var(--text-tertiary)' }}>
                  {data.featured_market.product_name}
                </div>
              </Link>
            )}
          </div>
          {data.player.breakerz_note && (
            <p className="mt-3 text-xs sm:text-sm italic" style={{ color: 'var(--text-secondary)' }}>
              &ldquo;{data.player.breakerz_note}&rdquo;
            </p>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto space-y-5">
        {/* ── Section: BreakIQ Insights — top of page, prominent ────────── */}
        <Section
          title="BreakIQ Insights"
          subtitle="Risk flags, sentiment shifts, and market observations"
          count={
            data.insights.risk_flags.length +
            data.insights.sentiment.length +
            data.insights.observations.length
          }
          empty={
            data.insights.risk_flags.length === 0 &&
            data.insights.sentiment.length === 0 &&
            data.insights.observations.length === 0
          }
          emptyText="No insights logged for this player yet."
        >
          <div className="space-y-2.5">
            {data.insights.risk_flags.map((f, i) => (
              <div key={`f-${i}`} className="rounded-lg border px-3 py-2.5 flex items-start gap-2.5" style={{ borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.05)' }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <RiskFlagBadge type={f.flag_type} note={f.note ?? ''} />
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{formatShortDate(f.created_at)}</span>
                    {f.product && (
                      <Link href={`/break/${f.product.slug}`} className="text-[10px] underline" style={{ color: 'var(--text-tertiary)' }}>
                        {f.product.name}
                      </Link>
                    )}
                  </div>
                  {f.note && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{f.note}</p>}
                </div>
              </div>
            ))}

            {data.insights.sentiment.map(s => {
              const delta = (s.new_score ?? 0) - (s.prev_score ?? 0);
              return (
                <div key={s.id} className="rounded-lg border px-3 py-2.5 flex items-start gap-2.5" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
                  {delta >= 0
                    ? <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
                    : <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
                  }
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Breakerz score{' '}
                        <span className="font-mono">{(s.prev_score ?? 0).toFixed(2)}</span>
                        {' → '}
                        <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                          {(s.new_score ?? 0).toFixed(2)}
                        </span>
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{formatDate(s.created_at)}</span>
                    </div>
                    {s.new_note && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{s.new_note}</p>}
                    {s.source_narrative && (
                      <p className="text-[10px] mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
                        via {s.source} — &ldquo;{s.source_narrative}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {data.insights.observations.map(o => (
              <div key={o.id} className="rounded-lg border px-3 py-2.5 flex items-start gap-2.5" style={{ borderColor: 'rgba(168,85,247,0.35)', backgroundColor: 'rgba(168,85,247,0.05)' }}>
                <MessageSquare className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#a855f7' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold uppercase tracking-wider text-[10px]" style={{ color: '#a855f7' }}>
                      {o.observation_type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{formatShortDate(o.observed_at)}</span>
                    {o.products && (
                      <Link href={`/break/${o.products.slug}`} className="text-[10px] underline" style={{ color: 'var(--text-tertiary)' }}>
                        {o.products.name}
                      </Link>
                    )}
                  </div>
                  {o.source_narrative && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>&ldquo;{o.source_narrative}&rdquo;</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Two-column: Products (wider, left) + Recent Sales (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* Products — primary column */}
          <div className="lg:col-span-3">
            <Section
              title="Products"
              count={data.products.length}
              empty={data.products.length === 0}
              emptyText="This player isn't in any tracked products yet."
            >
              <div className="grid grid-cols-1 gap-2">
                {data.products.map(p => (
                  <ProductCard key={p.player_product_id} entry={p} />
                ))}
              </div>
            </Section>
          </div>

          {/* Recent Sales — narrower side column */}
          <div className="lg:col-span-2">
            <RecentSalesPanel comps={data.recent_comps} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  empty,
  emptyText,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2.5">
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {title}{' '}
          {!empty && (
            <span className="ml-1 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {count}
            </span>
          )}
        </h2>
        {subtitle && (
          <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
            {subtitle}
          </span>
        )}
      </div>
      {empty ? (
        <div
          className="rounded-lg border-2 border-dashed px-4 py-6 text-center text-xs"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-disabled)', backgroundColor: 'rgba(255,255,255,0.01)' }}
        >
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function isRawGrade(g: string | null | undefined) {
  if (!g) return false;
  return g === 'Raw' || g === 'Ungraded';
}

function RecentSalesPanel({ comps }: { comps: Comp[] }) {
  // Split incoming comps by grade so we can offer a Raw / Graded toggle.
  // Sorted newest-first by the API; we keep that order and slice 10 at the end.
  const { raw, graded } = useMemo(() => {
    const r: Comp[] = [];
    const g: Comp[] = [];
    for (const c of comps) {
      if (isRawGrade(c.grade)) r.push(c);
      else g.push(c);
    }
    return { raw: r, graded: g };
  }, [comps]);

  // Default tab: whichever has more sales for this player. Falls back to Raw
  // when both are zero so the empty state matches what most users will hit.
  const [tab, setTab] = useState<'raw' | 'graded'>(() => (graded.length > raw.length ? 'graded' : 'raw'));
  const list = tab === 'raw' ? raw : graded;
  const visible = list.slice(0, 10);
  const totalForTab = list.length;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Recent Sales{' '}
          <span className="ml-1 font-mono text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {totalForTab > 0 ? Math.min(10, totalForTab) : 0}
          </span>
        </h2>
        {/* Raw / Graded segmented toggle */}
        <div className="inline-flex items-center rounded-md border overflow-hidden text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: 'var(--terminal-border)' }}>
          {([
            { key: 'raw', label: 'Raw', count: raw.length },
            { key: 'graded', label: 'Graded', count: graded.length },
          ] as const).map(opt => {
            const active = tab === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTab(opt.key)}
                className="px-2.5 py-1 transition-colors"
                style={{
                  backgroundColor: active ? 'rgba(59,130,246,0.15)' : 'transparent',
                  color: active ? 'var(--accent-blue)' : 'var(--text-tertiary)',
                }}
              >
                {opt.label}
                <span className="ml-1 font-mono opacity-70">{opt.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-lg border-2 border-dashed px-4 py-6 text-center text-xs"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-disabled)', backgroundColor: 'rgba(255,255,255,0.01)' }}
        >
          No {tab === 'raw' ? 'raw' : 'graded'} sales found in the last 180 days.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
          <ul className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
            {visible.map((c, i) => {
              const psa10 = c.grade?.includes('10');
              const psa9 = c.grade?.includes('9');
              return (
                <li key={i} className="flex items-center justify-between px-3 py-2 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: psa10 ? 'rgba(34,197,94,0.12)' : psa9 ? 'rgba(59,130,246,0.12)' : 'rgba(148,163,184,0.12)',
                        color: psa10 ? '#22c55e' : psa9 ? 'var(--accent-blue)' : '#94a3b8',
                      }}
                    >
                      {isRawGrade(c.grade) ? 'Raw' : c.grade}
                    </span>
                    <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {(c.platform ?? '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{formatShortDate(c.sale_date)}</span>
                    <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                      {formatCurrency(c.sale_price)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function ProductCard({ entry }: { entry: ProductEntry }) {
  const tag = LIFECYCLE_LABELS[entry.lifecycle_status];
  const subtitle = [entry.year, entry.manufacturer].filter(Boolean).join(' · ');
  return (
    <Link
      href={`/break/${entry.product_slug}`}
      className="rounded-lg border p-3 transition-colors hover:bg-[var(--terminal-surface-hover)] flex items-start justify-between gap-3"
      style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: tag.bg, color: tag.fg }}>
            {tag.text}
          </span>
          {entry.sport && (
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{entry.sport}</span>
          )}
        </div>
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{entry.product_name}</div>
        {subtitle && <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</div>}
        {entry.ev_mid != null ? (
          <div className="mt-1.5 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            EV Mid <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(entry.ev_mid)}</span>
            {entry.ev_low != null && entry.ev_high != null && (
              <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                ({formatCurrency(entry.ev_low)}–{formatCurrency(entry.ev_high)})
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] italic" style={{ color: 'var(--text-disabled)' }}>No pricing yet</div>
        )}
      </div>
      <ExternalLink className="w-3.5 h-3.5 mt-1 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
    </Link>
  );
}
