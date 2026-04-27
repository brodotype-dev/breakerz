'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, PencilIcon, UsersIcon, CheckCircle2, Minus, AlertTriangle, ExternalLink } from 'lucide-react';
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.manufacturer ?? '').toLowerCase().includes(q)) return false;
      if (sport !== 'all' && p.sportName !== sport) return false;
      if (year !== 'all' && p.year !== year) return false;
      if (status === 'active' && !p.isActive) return false;
      if (status === 'draft' && p.isActive) return false;
      if (lifecycle !== 'all' && p.lifecycleStatus !== lifecycle) return false;
      return true;
    });
  }, [products, search, sport, year, status, lifecycle]);

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
                <TableHead>Name</TableHead>
                <TableHead className="w-[110px]">Sport</TableHead>
                <TableHead className="w-[80px]">Year</TableHead>
                <TableHead className="w-[110px]">Lifecycle</TableHead>
                <TableHead className="w-[120px]">Manufacturer</TableHead>
                <TableHead className="w-[80px] text-right">Players</TableHead>
                <TableHead className="w-[110px]">Last Priced</TableHead>
                <TableHead className="w-[60px] text-center">Odds</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
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
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit product"
                      >
                        <PencilIcon className="size-4" />
                      </Link>
                      <Link
                        href={`/admin/products/${p.id}/players`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Manage players"
                      >
                        <UsersIcon className="size-4" />
                      </Link>
                      {p.slug && (
                        <Link
                          href={`/break/${p.slug}`}
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
