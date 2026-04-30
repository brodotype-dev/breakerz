'use client';

import { useEffect, useMemo, useState } from 'react';
import ChaseCardsPanel from './ChaseCardsPanel';
import { SegmentedControl } from './ds';
import type {
  AskingPriceObsRow,
  ChaseCard,
  HypeObsRow,
  PlayerWithPricing,
  Product,
  Sport,
} from '@/lib/types';

interface Props {
  product: Product & { sport: Sport };
  chaseCards: ChaseCard[];
  players: PlayerWithPricing[];
  riskFlagMap: Map<string, Array<{ flagType: string; note: string }>>;
  hypeObs: HypeObsRow[];
  askingPriceObs: AskingPriceObsRow[];
  sportPrimary: string;
  sportGradient: string;
}

interface Snapshot {
  player_product_id: string;
  has_history: boolean;
  raw_avg_90d: number | null;
  psa9_avg_90d: number | null;
  psa10_avg_90d: number | null;
  raw_sales_90d: number | null;
  psa9_sales_90d: number | null;
  psa10_sales_90d: number | null;
}

type SortKey = 'raw_desc' | 'psa10_desc' | 'alpha' | 'rookies_first';
type FilterKey = 'all' | 'rookies' | 'history' | 'risk';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'raw_desc', label: 'Raw avg' },
  { value: 'psa10_desc', label: 'PSA 10' },
  { value: 'alpha', label: 'A→Z' },
  { value: 'rookies_first', label: 'Rookies' },
];

const FILTER_OPTIONS: Array<{ value: FilterKey; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'rookies', label: 'Rookies' },
  { value: 'history', label: 'Has history' },
  { value: 'risk', label: 'Risk flag' },
];

const HYPE_TAG_META: Record<
  HypeObsRow['payload']['tag'],
  { label: string; symbol: string; color: string; bg: string }
> = {
  release_premium: { label: 'Release premium', symbol: '▲', color: '#f97316', bg: 'rgba(249,115,22,0.14)' },
  cooled:          { label: 'Cooled',          symbol: '▼', color: '#94a3b8', bg: 'rgba(148,163,184,0.14)' },
  overhyped:       { label: 'Overhyped',       symbol: '⚠', color: '#eab308', bg: 'rgba(234,179,8,0.14)' },
  underhyped:      { label: 'Underhyped',      symbol: '★', color: '#10b981', bg: 'rgba(16,185,129,0.14)' },
};

const PULSING_RISK_TYPES = new Set(['injury', 'suspension']);

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(0)}`;
  if (n < 1000) return `$${Math.round(n)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

function formatReleaseDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function relativeTimeFromNow(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Pre-release consumer layout.
 *
 * Renders when `lifecycle_status === 'pre_release'`. The live engine doesn't
 * run yet — no slot EVs, no case math. This surface focuses on launch hype
 * + intel: countdown, chase cards, hype/asking-price chips from Discord
 * insight capture, and 90-day comps from each player's existing cards.
 */
export default function PreReleaseLayout({
  product,
  chaseCards,
  players,
  riskFlagMap,
  hypeObs,
  askingPriceObs,
  sportPrimary,
  sportGradient,
}: Props) {
  const [snapshots, setSnapshots] = useState<Map<string, Snapshot>>(new Map());
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());
  const [sort, setSort] = useState<SortKey>('raw_desc');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [groupByTeam, setGroupByTeam] = useState(false);

  // Player snapshots fetch (unchanged from prior version other than psa9 fields).
  useEffect(() => {
    if (!players.length || !product.id) return;
    let cancelled = false;
    setSnapshotsLoading(true);
    fetch('/api/pre-release/player-snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id }),
    })
      .then(r => r.json())
      .then((data: { snapshots?: Snapshot[] }) => {
        if (cancelled) return;
        const m = new Map<string, Snapshot>();
        for (const s of data.snapshots ?? []) m.set(s.player_product_id, s);
        setSnapshots(m);
      })
      .catch(err => console.error('[PreReleaseLayout] snapshot fetch failed', err))
      .finally(() => { if (!cancelled) setSnapshotsLoading(false); });
    return () => { cancelled = true; };
  }, [product.id, players.length]);

  // Tick every second on launch day so HH:MM:SS ticks down. Heavier-than-needed
  // outside the launch day window — guarded below.
  const launchDay = useMemo(() => {
    if (!product.release_date) return null;
    const d = new Date(product.release_date + 'T00:00:00');
    return d;
  }, [product.release_date]);

  const isLaunchDay = useMemo(() => {
    if (!launchDay) return false;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    return launchDay.getTime() === todayStart.getTime();
  }, [launchDay, now]); // re-evaluate on tick

  useEffect(() => {
    // Tick once a minute by default; once a second on launch day for the
    // HH:MM:SS countdown.
    const intervalMs = isLaunchDay ? 1000 : 60_000;
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [isLaunchDay]);

  // Countdown formatting.
  const countdown = useMemo(() => {
    if (!launchDay) return null;
    const diffMs = launchDay.getTime() - now.getTime();
    if (diffMs <= 0) {
      // Past release_date but still pre_release in admin — surface that.
      return { kind: 'past' as const };
    }
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (days >= 1) return { kind: 'days' as const, days, hours, mins };
    return { kind: 'sameday' as const, hours, mins, secs };
  }, [launchDay, now]);

  // Bucket hype obs for display rendering (separate from the engine bucketing
  // that lib/score-modulation.ts handles).
  const productHype = useMemo(() => hypeObs.filter(o => o.scope_type === 'product'), [hypeObs]);
  const playerHype = useMemo(() => {
    const m = new Map<string, HypeObsRow[]>();
    for (const o of hypeObs) {
      if (o.scope_type === 'player' && o.scope_id) {
        const arr = m.get(o.scope_id) ?? [];
        arr.push(o);
        m.set(o.scope_id, arr);
      }
    }
    return m;
  }, [hypeObs]);

  const productAsk = useMemo(
    () => askingPriceObs.filter(o => o.scope_type === 'product'),
    [askingPriceObs],
  );

  // Sub-hero release-window context.
  const subHeroBits: string[] = useMemo(() => {
    const bits: string[] = [];
    if (product.release_date) bits.push(`Launches ${formatReleaseDate(product.release_date)}`);
    const hobbyCase = product.hobby_am_case_cost ?? product.hobby_case_cost ?? null;
    if (hobbyCase) bits.push(`Hobby case ${formatPrice(hobbyCase)}`);
    const bdCase = product.bd_am_case_cost ?? product.bd_case_cost ?? null;
    if (bdCase) bits.push(`BD case ${formatPrice(bdCase)}`);
    return bits;
  }, [product]);

  // Sorted + filtered roster.
  const visiblePlayers = useMemo(() => {
    let arr = [...players];
    // Filter
    if (filter === 'rookies') arr = arr.filter(p => p.player?.is_rookie);
    if (filter === 'history') arr = arr.filter(p => snapshots.get(p.id)?.has_history);
    if (filter === 'risk') arr = arr.filter(p => (riskFlagMap.get(p.id)?.length ?? 0) > 0);
    // Sort
    arr.sort((a, b) => {
      if (sort === 'alpha') return (a.player?.name ?? '').localeCompare(b.player?.name ?? '');
      if (sort === 'rookies_first') {
        const aR = a.player?.is_rookie ? 0 : 1;
        const bR = b.player?.is_rookie ? 0 : 1;
        if (aR !== bR) return aR - bR;
        return (a.player?.name ?? '').localeCompare(b.player?.name ?? '');
      }
      if (sort === 'psa10_desc') {
        const av = snapshots.get(a.id)?.psa10_avg_90d ?? -1;
        const bv = snapshots.get(b.id)?.psa10_avg_90d ?? -1;
        return bv - av;
      }
      // raw_desc default
      const av = snapshots.get(a.id)?.raw_avg_90d ?? -1;
      const bv = snapshots.get(b.id)?.raw_avg_90d ?? -1;
      return bv - av;
    });
    return arr;
  }, [players, filter, sort, snapshots, riskFlagMap]);

  // Top 3 raw-avg players for the Watching widget. Pulled from full roster
  // (not the filtered view) so the widget is stable.
  const watchList = useMemo(() => {
    return [...players]
      .map(p => ({ p, snap: snapshots.get(p.id) }))
      .filter(x => x.snap?.has_history)
      .sort((a, b) => (b.snap?.raw_avg_90d ?? 0) - (a.snap?.raw_avg_90d ?? 0))
      .slice(0, 3);
  }, [players, snapshots]);

  // Group-by-team grouping (after sort/filter).
  const grouped = useMemo(() => {
    if (!groupByTeam) return null;
    const m = new Map<string, PlayerWithPricing[]>();
    for (const p of visiblePlayers) {
      const team = p.player?.team || 'No team';
      const arr = m.get(team) ?? [];
      arr.push(p);
      m.set(team, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [groupByTeam, visiblePlayers]);

  // Compute rank-among-visible for the top-3 flair (only when sort is a
  // value-based sort — alphabetical/rookies-first don't get rank badges).
  const rankByPpId = useMemo(() => {
    if (sort !== 'raw_desc' && sort !== 'psa10_desc') return new Map<string, number>();
    const m = new Map<string, number>();
    visiblePlayers.slice(0, 3).forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [visiblePlayers, sort]);

  return (
    <div className="space-y-5">
      {/* Countdown + sub-hero */}
      {countdown && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div
            className="h-1"
            style={{ background: sportGradient }}
          />
          <div className="px-5 py-5 text-center">
            <p
              className="text-[10px] uppercase tracking-[0.22em] mb-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {countdown.kind === 'past' ? 'Released' : 'Release Countdown'}
            </p>
            {countdown.kind === 'days' && (
              <div className="flex items-end justify-center gap-3 font-mono">
                <CountdownCell value={countdown.days} label={countdown.days === 1 ? 'day' : 'days'} primary={sportPrimary} large />
                <span className="text-3xl font-black opacity-30 mb-2" style={{ color: 'var(--text-tertiary)' }}>·</span>
                <CountdownCell value={countdown.hours} label="hrs" primary={sportPrimary} />
                <span className="text-3xl font-black opacity-30 mb-2" style={{ color: 'var(--text-tertiary)' }}>·</span>
                <CountdownCell value={countdown.mins} label="min" primary={sportPrimary} />
              </div>
            )}
            {countdown.kind === 'sameday' && (
              <div className="flex items-end justify-center gap-3 font-mono">
                <CountdownCell value={countdown.hours} label="hrs" primary={sportPrimary} large />
                <span className="text-3xl font-black opacity-30 mb-2" style={{ color: 'var(--text-tertiary)' }}>:</span>
                <CountdownCell value={countdown.mins} label="min" primary={sportPrimary} />
                <span className="text-3xl font-black opacity-30 mb-2" style={{ color: 'var(--text-tertiary)' }}>:</span>
                <CountdownCell value={countdown.secs} label="sec" primary={sportPrimary} />
              </div>
            )}
            {countdown.kind === 'past' && (
              <div className="flex items-center justify-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ backgroundColor: '#ef4444' }}
                />
                <p className="text-2xl font-black" style={{ color: '#ef4444' }}>
                  Live now
                </p>
              </div>
            )}
          </div>
          {subHeroBits.length > 0 && (
            <div
              className="border-t px-5 py-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs"
              style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface-hover)' }}
            >
              {subHeroBits.map((bit, i) => (
                <span key={i} style={{ color: 'var(--text-secondary)' }}>{bit}</span>
              ))}
              {productAsk[0] && (
                <span
                  className="font-mono px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: 'rgba(168,85,247,0.14)',
                    color: '#c4b5fd',
                    border: '1px solid rgba(168,85,247,0.35)',
                  }}
                  title={productAsk[0].source_narrative ?? ''}
                >
                  Streams asking{' '}
                  {productAsk[0].payload.price_low === productAsk[0].payload.price_high
                    ? formatPrice(productAsk[0].payload.price_low)
                    : `${formatPrice(productAsk[0].payload.price_low)}–${formatPrice(productAsk[0].payload.price_high)}`}
                  {productAsk.length > 1 && ` · ${productAsk.length} obs`}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Product-scope hype banner */}
      {productHype.length > 0 && <ProductHypeBanner obs={productHype[0]} count={productHype.length} />}

      {/* Chase cards — primary signal during pre-release */}
      {chaseCards.length > 0 && <ChaseCardsPanel chaseCards={chaseCards} />}

      {/* Watching widget — top 3 by raw avg */}
      {watchList.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
            <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
              Watching · top of the checklist by 90-day raw avg
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px" style={{ backgroundColor: 'var(--terminal-border)' }}>
            {watchList.map(({ p, snap }, i) => (
              <div key={p.id} className="px-4 py-3 flex flex-col gap-1" style={{ backgroundColor: 'var(--terminal-surface)' }}>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-mono font-bold w-5 h-5 rounded inline-flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7' }}
                  >
                    ▲{i + 1}
                  </span>
                  <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {p.player?.name}
                  </span>
                </div>
                <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  90d raw {formatPrice(snap?.raw_avg_90d ?? null)}
                  {snap?.psa10_avg_90d != null && (
                    <> · PSA 10 {formatPrice(snap.psa10_avg_90d)}</>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  {(playerHype.get(p.player_id) ?? []).slice(0, 2).map((h, idx) => (
                    <HypeChip key={idx} obs={h} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player checklist */}
      {players.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--terminal-border)' }}>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                Checklist · {visiblePlayers.length}{visiblePlayers.length !== players.length && ` of ${players.length}`} {players.length === 1 ? 'player' : 'players'}
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                90-day comps from each player&apos;s existing cards. Rookies show data-light.
                {snapshotsLoading && <span className="ml-1.5 italic">Loading…</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SegmentedControl
                value={sort}
                onChange={v => setSort(v as SortKey)}
                options={SORT_OPTIONS}
              />
              <button
                onClick={() => setGroupByTeam(g => !g)}
                className="text-[11px] font-semibold uppercase tracking-wider px-3 py-2 rounded-lg border transition-colors"
                style={{
                  backgroundColor: groupByTeam ? 'var(--accent-blue)' : 'transparent',
                  borderColor: groupByTeam ? 'var(--accent-blue)' : 'var(--terminal-border)',
                  color: groupByTeam ? 'white' : 'var(--text-secondary)',
                }}
              >
                Group by team
              </button>
            </div>
          </div>

          {/* Filter chips */}
          <div className="px-5 py-2 border-b flex flex-wrap items-center gap-1.5" style={{ borderColor: 'var(--terminal-border)' }}>
            {FILTER_OPTIONS.map(opt => {
              const active = filter === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors"
                  style={{
                    backgroundColor: active ? 'rgba(59,130,246,0.15)' : 'transparent',
                    borderColor: active ? 'var(--accent-blue)' : 'var(--terminal-border)',
                    color: active ? 'var(--accent-blue)' : 'var(--text-tertiary)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="hidden md:grid grid-cols-[1fr_80px_80px_80px_70px_60px] gap-3 px-5 py-2 border-b text-[10px] uppercase tracking-wider font-bold"
            style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-tertiary)', backgroundColor: 'var(--terminal-surface-hover)' }}>
            <span>Player</span>
            <span className="text-right">Raw avg</span>
            <span className="text-right">PSA 9</span>
            <span className="text-right">PSA 10</span>
            <span className="text-right">Sales 90d</span>
            <span className="text-right">Team</span>
          </div>

          {/* Rows: either flat (sorted) or grouped by team */}
          {grouped ? (
            <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
              {grouped.map(([team, list]) => (
                <div key={team}>
                  <div
                    className="px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest sticky top-0 z-[1]"
                    style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-secondary)' }}
                  >
                    {team} · {list.length}
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                    {list.map(p => (
                      <PlayerRow
                        key={p.id}
                        p={p}
                        snap={snapshots.get(p.id)}
                        flags={riskFlagMap.get(p.id) ?? []}
                        hype={playerHype.get(p.player_id) ?? []}
                        rank={rankByPpId.get(p.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
              {visiblePlayers.map(p => (
                <PlayerRow
                  key={p.id}
                  p={p}
                  snap={snapshots.get(p.id)}
                  flags={riskFlagMap.get(p.id) ?? []}
                  hype={playerHype.get(p.player_id) ?? []}
                  rank={rankByPpId.get(p.id)}
                />
              ))}
            </div>
          )}

          {visiblePlayers.length === 0 && (
            <div className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              No players match the current filter.
            </div>
          )}
        </div>
      )}

      {players.length === 0 && chaseCards.length === 0 && (
        <div
          className="rounded-xl border border-dashed p-10 text-center"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            Checklist not loaded yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            We&apos;re prepping this product. Chase cards and player roster will appear here as the launch gets closer.
          </p>
        </div>
      )}
    </div>
  );
}

function CountdownCell({ value, label, primary, large }: { value: number; label: string; primary: string; large?: boolean }) {
  return (
    <div className="flex flex-col items-center min-w-[3.5rem]">
      <span
        className={`font-black tabular-nums ${large ? 'text-5xl md:text-6xl' : 'text-3xl md:text-4xl'}`}
        style={{ color: primary }}
      >
        {String(value).padStart(2, '0')}
      </span>
      <span className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
    </div>
  );
}

function ProductHypeBanner({ obs, count }: { obs: HypeObsRow; count: number }) {
  const meta = HYPE_TAG_META[obs.payload.tag];
  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-start gap-3"
      style={{
        borderColor: meta.color + '55',
        backgroundColor: meta.bg,
      }}
      title={obs.source_narrative ?? ''}
    >
      <span className="text-lg" style={{ color: meta.color }}>{meta.symbol}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: meta.color }}>
          {meta.label} tag active
          {count > 1 && (
            <span className="text-xs font-normal ml-1.5" style={{ color: 'var(--text-tertiary)' }}>
              · {count} obs
            </span>
          )}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {obs.source_narrative
            ? `"${obs.source_narrative.slice(0, 140)}${obs.source_narrative.length > 140 ? '…' : ''}"`
            : 'Active hype signal logged for this product.'}{' '}
          <span style={{ color: 'var(--text-tertiary)' }}>· {relativeTimeFromNow(obs.observed_at)}</span>
        </p>
      </div>
    </div>
  );
}

function HypeChip({ obs }: { obs: HypeObsRow }) {
  const meta = HYPE_TAG_META[obs.payload.tag];
  return (
    <span
      title={obs.source_narrative ?? meta.label}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      <span>{meta.symbol}</span>
      <span>{meta.label}</span>
    </span>
  );
}

function PlayerRow({
  p,
  snap,
  flags,
  hype,
  rank,
}: {
  p: PlayerWithPricing;
  snap?: Snapshot;
  flags: Array<{ flagType: string; note: string }>;
  hype: HypeObsRow[];
  rank?: number;
}) {
  const isRookie = !!p.player?.is_rookie;
  return (
    <div
      className="md:grid md:grid-cols-[1fr_80px_80px_80px_70px_60px] md:gap-3 px-5 py-2.5 flex items-center gap-3 flex-wrap"
      style={{ borderColor: 'var(--terminal-border)' }}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
        {rank && (
          <span
            className="text-[10px] font-mono font-bold w-5 h-5 rounded inline-flex items-center justify-center"
            style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7' }}
          >
            ▲{rank}
          </span>
        )}
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {p.player?.name}
        </span>
        {isRookie && (
          <span
            className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981' }}
          >
            RC
          </span>
        )}
        {flags.map((f, i) => {
          const pulse = PULSING_RISK_TYPES.has(f.flagType);
          return (
            <span
              key={i}
              title={f.note}
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide ${pulse ? 'animate-pulse' : ''}`}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.18)',
                color: '#fecaca',
                border: '1px solid rgba(239,68,68,0.45)',
              }}
            >
              {f.flagType}
            </span>
          );
        })}
        {hype.slice(0, 2).map((h, i) => <HypeChip key={i} obs={h} />)}
      </div>

      <span className="md:text-right text-xs font-mono" style={{ color: snap?.has_history ? 'var(--text-primary)' : 'var(--text-disabled)' }}>
        {snap?.has_history ? formatPrice(snap.raw_avg_90d) : isRookie ? 'No data' : '—'}
      </span>

      <span className="md:text-right text-xs font-mono" style={{ color: snap?.psa9_avg_90d != null ? 'var(--text-primary)' : 'var(--text-disabled)' }}>
        {snap?.psa9_avg_90d != null ? formatPrice(snap.psa9_avg_90d) : '—'}
      </span>

      <span className="md:text-right text-xs font-mono" style={{ color: snap?.psa10_avg_90d != null ? 'var(--text-primary)' : 'var(--text-disabled)' }}>
        {snap?.psa10_avg_90d != null ? formatPrice(snap.psa10_avg_90d) : '—'}
      </span>

      <span className="md:text-right text-xs font-mono" style={{ color: snap?.has_history ? 'var(--text-secondary)' : 'var(--text-disabled)' }}>
        {snap?.has_history && snap.raw_sales_90d != null ? snap.raw_sales_90d.toLocaleString() : '—'}
      </span>

      <span className="md:text-right text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
        {p.player?.team || '—'}
      </span>
    </div>
  );
}
