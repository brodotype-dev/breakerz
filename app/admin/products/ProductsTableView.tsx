'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, PencilIcon, UsersIcon, CheckCircle2, Minus, AlertTriangle, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type ProductRow = {
  id: string;
  name: string;
  slug: string | null;
  year: string | null;
  manufacturer: string | null;
  sportName: string | null;
  isActive: boolean;
  hasOdds: boolean;
  lifecycleStatus: 'pre_release' | 'live' | 'dormant';
  releaseDate: string | null;
  playerCount: number;
  lastPriced: string | null;
  needsRefresh: boolean;
};

type StatusFilter = 'all' | 'active' | 'draft';
type LifecycleFilter = 'all' | 'pre_release' | 'live' | 'dormant';

const lifecycleStyles: Record<'pre_release' | 'live' | 'dormant', { bg: string; text: string; label: string }> = {
  pre_release: { bg: 'rgba(168, 85, 247, 0.12)', text: '#a855f7', label: 'Pre-release' },
  live: { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981', label: 'Live' },
  dormant: { bg: 'rgba(148, 163, 184, 0.15)', text: '#94a3b8', label: 'Dormant' },
};

const sportColors: Record<string, string> = {
  Baseball: 'var(--sport-baseball-primary)',
  Basketball: 'var(--sport-basketball-primary)',
  Football: 'var(--sport-football-primary)',
};

function formatFetchedAt(ts: string | null): string {
  if (!ts) return '—';
  const diffH = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return 'Today';
  if (diffH < 48) return 'Yesterday';
  return `${Math.floor(diffH / 24)}d ago`;
}

// Short date for the Release column. YYYY-MM-DD → "May 21" / "May '26"
// when same year as now; "May '26" for past/future years. Compact so the
// column doesn't bloat the table; full date is in the tooltip.
function formatReleaseDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  if (sameYear) return `${month} ${day}`;
  return `${month} '${String(d.getUTCFullYear()).slice(-2)}`;
}

// Columns the user can sort by. `name` covers product name; `release`
// is the default. Adding a new sortable column requires extending this
// union AND the sortValue switch below.
type SortKey =
  | 'name'
  | 'sport'
  | 'year'
  | 'lifecycle'
  | 'manufacturer'
  | 'players'
  | 'lastPriced'
  | 'release'
  | 'status';

// Order lifecycle statuses chronologically — pre_release first (newest
// activity at the top of the funnel) so a lifecycle sort feels intuitive.
const LIFECYCLE_ORDER: Record<'pre_release' | 'live' | 'dormant', number> = {
  pre_release: 0,
  live: 1,
  dormant: 2,
};

// Extract a comparable value for one sort key. Strings are lowercased
// for case-insensitive sort; nullable values return null so the caller
// can group them at the end regardless of direction.
function sortValue(p: ProductRow, key: SortKey): string | number | null {
  switch (key) {
    case 'name':
      return p.name.toLowerCase();
    case 'sport':
      return (p.sportName ?? '').toLowerCase();
    case 'year':
      return p.year ?? null;
    case 'lifecycle':
      return LIFECYCLE_ORDER[p.lifecycleStatus] ?? 99;
    case 'manufacturer':
      return (p.manufacturer ?? '').toLowerCase();
    case 'players':
      return p.playerCount;
    case 'lastPriced':
      return p.lastPriced ? new Date(p.lastPriced).getTime() : null;
    case 'release':
      return p.releaseDate ? new Date(p.releaseDate).getTime() : null;
    case 'status':
      // Active first when asc.
      return p.isActive ? 0 : 1;
  }
}

// Clickable header cell. Renders the column label + a directional arrow
// when this column is the active sort, or a dimmed up/down icon to hint
// the column is sortable. Non-active columns share the same dimmed icon
// so the affordance is consistent.
function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onClick,
  className,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const alignClass = align === 'right' ? 'justify-end text-right' : 'justify-start';
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wider w-full ${alignClass}`}
        style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
      >
        <span>{label}</span>
        <Icon
          className="size-3 shrink-0"
          style={{ opacity: active ? 1 : 0.4 }}
        />
      </button>
    </TableHead>
  );
}

function compareRows(a: ProductRow, b: ProductRow, key: SortKey, dir: 'asc' | 'desc'): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  // Nulls always sort last regardless of direction — admins want to see
  // the data they have, not a wall of dashes.
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return dir === 'asc' ? cmp : -cmp;
}

export default function ProductsTableView({
  products,
  sports,
  years,
}: {
  products: ProductRow[];
  sports: string[];
  years: string[];
}) {
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');
  // Default: newest release first. Admins are usually looking at the
  // most-recent product they just imported / pre-released.
  const [sortKey, setSortKey] = useState<SortKey>('release');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      // Same key clicked → flip direction.
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      // New key — default to desc for time/count columns (newest/largest
      // first feels right), asc for everything else (A→Z, 2024→2026).
      const descByDefault: SortKey[] = ['release', 'lastPriced', 'players'];
      setSortKey(key);
      setSortDir(descByDefault.includes(key) ? 'desc' : 'asc');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.manufacturer ?? '').toLowerCase().includes(q)) return false;
      if (sport !== 'all' && p.sportName !== sport) return false;
      if (year !== 'all' && p.year !== year) return false;
      if (status === 'active' && !p.isActive) return false;
      if (status === 'draft' && p.isActive) return false;
      if (lifecycle !== 'all' && p.lifecycleStatus !== lifecycle) return false;
      return true;
    });
    return [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [products, search, sport, year, status, lifecycle, sortKey, sortDir]);

  const counts = useMemo(() => ({
    all: products.length,
    active: products.filter(p => p.isActive).length,
    draft: products.filter(p => !p.isActive).length,
  }), [products]);

  const lifecycleCounts = useMemo(() => ({
    all: products.length,
    pre_release: products.filter(p => p.lifecycleStatus === 'pre_release').length,
    live: products.filter(p => p.lifecycleStatus === 'live').length,
    dormant: products.filter(p => p.lifecycleStatus === 'dormant').length,
  }), [products]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-[200px] h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products or manufacturer…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>

        <FilterSelect value={sport} onChange={setSport} options={[{ value: 'all', label: 'All sports' }, ...sports.map(s => ({ value: s, label: s }))]} />
        <FilterSelect value={year} onChange={setYear} options={[{ value: 'all', label: 'All years' }, ...years.map(y => ({ value: y, label: y }))]} />
        <FilterSelect
          value={lifecycle}
          onChange={(v) => setLifecycle(v as LifecycleFilter)}
          options={[
            { value: 'all', label: `All lifecycle (${lifecycleCounts.all})` },
            { value: 'pre_release', label: `Pre-release (${lifecycleCounts.pre_release})` },
            { value: 'live', label: `Live (${lifecycleCounts.live})` },
            { value: 'dormant', label: `Dormant (${lifecycleCounts.dormant})` },
          ]}
        />

        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface)' }}>
          {(['all', 'active', 'draft'] as const).map(s => {
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize"
                style={{
                  backgroundColor: active ? 'var(--terminal-surface-hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {s}
                <span
                  className="text-[10px] font-mono px-1 py-0 rounded"
                  style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}
                >
                  {counts[s]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center text-sm"
          style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-secondary)' }}
        >
          No products match these filters.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--terminal-border)' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Name" sortKey="name" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortHeader label="Sport" sortKey="sport" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[110px]" />
                <SortHeader label="Year" sortKey="year" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[80px]" />
                <SortHeader label="Release" sortKey="release" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[90px]" />
                <SortHeader label="Lifecycle" sortKey="lifecycle" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[110px]" />
                <SortHeader label="Manufacturer" sortKey="manufacturer" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[120px]" />
                <SortHeader label="Players" sortKey="players" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[80px]" align="right" />
                <SortHeader label="Last Priced" sortKey="lastPriced" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[110px]" />
                <TableHead className="w-[60px] text-center">Odds</TableHead>
                <SortHeader label="Status" sortKey="status" current={sortKey} dir={sortDir} onClick={toggleSort} className="w-[80px]" />
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/products/${p.id}`}
                        prefetch={false}
                        className="hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {p.name}
                      </Link>
                      {p.needsRefresh && (
                        <span title="CH catalog refreshed after last pricing run — re-hydrate and refresh pricing">
                          <AlertTriangle className="size-3.5 shrink-0" style={{ color: '#f59e0b' }} />
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.sportName && (
                      <span
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${sportColors[p.sportName] ?? 'var(--accent-blue)'}20`,
                          color: sportColors[p.sportName] ?? 'var(--accent-blue)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {p.sportName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{p.year}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground" title={p.releaseDate ?? ''}>
                    {formatReleaseDate(p.releaseDate)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const ls = lifecycleStyles[p.lifecycleStatus];
                      return (
                        <span
                          className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
                          style={{ backgroundColor: ls.bg, color: ls.text }}
                        >
                          {ls.label}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.manufacturer}</TableCell>
                  <TableCell className="font-mono text-sm text-right">{p.playerCount.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {formatFetchedAt(p.lastPriced)}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.hasOdds ? (
                      <CheckCircle2 className="size-4 mx-auto text-emerald-500" />
                    ) : (
                      <Minus className="size-4 mx-auto text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.isActive ? 'default' : 'outline'}>
                      {p.isActive ? 'Active' : 'Draft'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Link
                        href={`/admin/products/${p.id}/edit`}
                        prefetch={false}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit product"
                      >
                        <PencilIcon className="size-4" />
                      </Link>
                      <Link
                        href={`/admin/products/${p.id}/players`}
                        prefetch={false}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Manage players"
                      >
                        <UsersIcon className="size-4" />
                      </Link>
                      {p.slug && (
                        <Link
                          href={`/break/${p.slug}`}
                          prefetch={false}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="View consumer page"
                          target="_blank"
                        >
                          <ExternalLink className="size-4" />
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-9 px-2.5 pr-7 rounded-lg text-sm font-medium outline-none cursor-pointer appearance-none bg-no-repeat bg-right"
      style={{
        border: '1px solid var(--terminal-border)',
        backgroundColor: 'var(--terminal-surface)',
        color: 'var(--text-primary)',
        backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3e%3cpath d='M1 1l4 4 4-4' stroke='%23999' stroke-width='1.5' fill='none' stroke-linecap='round'/%3e%3c/svg%3e")`,
        backgroundPosition: 'right 0.5rem center',
      }}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
