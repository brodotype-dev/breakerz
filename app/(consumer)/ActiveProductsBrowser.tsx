'use client';

import { useMemo, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import type { Product, Sport } from '@/lib/types';
import ProductCard, { type ProductSignal } from '@/components/breakiq/ProductCard';

type ProductRow = Product & { sport: Sport };
type LifecycleFilter = 'all' | 'live' | 'pre_release';

export type { ProductSignal };

function isPreRelease(releaseDate: string | null): boolean {
  if (!releaseDate) return false;
  return new Date(releaseDate + 'T00:00:00') > new Date();
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
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none h-9 pl-3 pr-8 rounded-lg text-sm font-medium cursor-pointer outline-none"
        style={{
          border: '1px solid var(--terminal-border)',
          backgroundColor: 'var(--terminal-surface)',
          color: 'var(--text-primary)',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: 'var(--text-tertiary)' }}
      />
    </div>
  );
}

export default function ActiveProductsBrowser({
  products,
  signals,
}: {
  products: ProductRow[];
  signals: Record<string, ProductSignal>;
}) {
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState<string>('all');
  const [year, setYear] = useState<string>('all');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');

  const sports = useMemo(
    () => Array.from(new Set(products.map(p => p.sport?.name).filter(Boolean) as string[])).sort(),
    [products],
  );
  const years = useMemo(
    () => Array.from(new Set(products.map(p => p.year))).sort().reverse(),
    [products],
  );

  const lifecycleCounts = useMemo(() => ({
    all: products.length,
    live: products.filter(p => !isPreRelease(p.release_date)).length,
    pre_release: products.filter(p => isPreRelease(p.release_date)).length,
  }), [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (sport !== 'all' && p.sport?.name !== sport) return false;
      if (year !== 'all' && p.year !== year) return false;
      const pre = isPreRelease(p.release_date);
      if (lifecycle === 'live' && pre) return false;
      if (lifecycle === 'pre_release' && !pre) return false;
      if (q) {
        const hay = `${p.name} ${p.manufacturer}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, search, sport, year, lifecycle]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            Active Products
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Click any product to see detailed slot pricing and analysis
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-[220px] h-9 px-3 rounded-lg"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products or manufacturer…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>

        <FilterSelect
          value={sport}
          onChange={setSport}
          options={[{ value: 'all', label: 'All sports' }, ...sports.map(s => ({ value: s, label: s }))]}
        />
        <FilterSelect
          value={year}
          onChange={setYear}
          options={[{ value: 'all', label: 'All years' }, ...years.map(y => ({ value: y, label: y }))]}
        />

        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface)' }}>
          {(['all', 'live', 'pre_release'] as const).map(s => {
            const active = lifecycle === s;
            const label = s === 'all' ? 'All' : s === 'live' ? 'Live' : 'Pre-release';
            return (
              <button
                key={s}
                type="button"
                onClick={() => setLifecycle(s)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                style={{
                  backgroundColor: active ? 'var(--terminal-surface-hover)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {label}
                <span
                  className="text-[10px] font-mono px-1 py-0 rounded"
                  style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)' }}
                >
                  {lifecycleCounts[s]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-12 text-center"
          style={{ borderColor: 'var(--terminal-border)', color: 'var(--text-secondary)' }}
        >
          <p className="font-semibold mb-1">No products match these filters.</p>
          <p className="text-sm">Try clearing the search or switching sport/year.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(product => (
            <ProductCard key={product.id} product={product} signal={signals[product.id]} />
          ))}
        </div>
      )}
    </div>
  );
}
