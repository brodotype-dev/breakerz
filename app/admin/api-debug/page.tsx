'use client';

import { useState } from 'react';

type SearchCard = {
  card_id: string;
  player_name: string;
  set_name: string;
  year: string;
  variant: string;
  number: string;
  rookie: boolean;
  prices: Array<{ grade: string; price: string }>;
};

type Comp = {
  sale_price: number;
  sale_date: string;
  grade: string;
  platform: string;
};

type GradePrice = {
  grade: string;
  price: string;
};

export default function ApiDebugPage() {
  const [query, setQuery] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [days, setDays] = useState(90);

  const [searchResults, setSearchResults] = useState<SearchCard[] | null>(null);
  const [allPrices, setAllPrices] = useState<GradePrice[] | null>(null);
  const [comps, setComps] = useState<Comp[] | null>(null);

  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(l => ({ ...l, search: true }));
    setErrors(e => ({ ...e, search: '' }));
    try {
      const res = await fetch('/api/cardhedger/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSearchResults(data.cards ?? []);
    } catch (err) {
      setErrors(e => ({ ...e, search: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoading(l => ({ ...l, search: false }));
    }
  }

  async function runAllPrices() {
    if (!selectedCardId.trim()) return;
    setLoading(l => ({ ...l, allPrices: true }));
    setErrors(e => ({ ...e, allPrices: '' }));
    try {
      const res = await fetch('/api/cardhedger/all-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: selectedCardId.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAllPrices(data.prices ?? []);
    } catch (err) {
      setErrors(e => ({ ...e, allPrices: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoading(l => ({ ...l, allPrices: false }));
    }
  }

  async function runComps() {
    if (!selectedCardId.trim()) return;
    setLoading(l => ({ ...l, comps: true }));
    setErrors(e => ({ ...e, comps: '' }));
    try {
      const res = await fetch('/api/cardhedger/comps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: selectedCardId.trim(), days }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setComps(data.comps ?? []);
    } catch (err) {
      setErrors(e => ({ ...e, comps: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoading(l => ({ ...l, comps: false }));
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">CardHedger API Debug</h1>
        <p className="text-sm text-muted-foreground mt-1">Inspect raw API responses for prices and comps.</p>
      </div>

      {/* Step 1 — Search */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">1. Search cards</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm bg-background"
            placeholder="e.g. Wembanyama Topps Finest 2023"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runSearch()}
          />
          <button
            onClick={runSearch}
            disabled={loading.search}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading.search ? 'Searching…' : 'Search'}
          </button>
        </div>
        {errors.search && <p className="text-sm text-red-500">{errors.search}</p>}

        {searchResults && (
          <div className="border rounded overflow-hidden text-sm">
            <div className="bg-muted px-3 py-2 font-medium text-xs uppercase tracking-wide">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
            {searchResults.length === 0 ? (
              <p className="px-3 py-3 text-muted-foreground">No cards found.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">card_id</th>
                    <th className="text-left px-3 py-2">player</th>
                    <th className="text-left px-3 py-2">set</th>
                    <th className="text-left px-3 py-2">year</th>
                    <th className="text-left px-3 py-2">variant</th>
                    <th className="text-left px-3 py-2">#</th>
                    <th className="text-left px-3 py-2">RC</th>
                    <th className="text-left px-3 py-2">prices (inline)</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((card, i) => (
                    <tr key={card.card_id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{card.card_id}</td>
                      <td className="px-3 py-1.5 font-medium">{card.player_name}</td>
                      <td className="px-3 py-1.5">{card.set_name}</td>
                      <td className="px-3 py-1.5">{card.year}</td>
                      <td className="px-3 py-1.5">{card.variant}</td>
                      <td className="px-3 py-1.5">{card.number}</td>
                      <td className="px-3 py-1.5">{card.rookie ? '✓' : ''}</td>
                      <td className="px-3 py-1.5">
                        {(card.prices ?? []).map(p => `${p.grade}: $${p.price}`).join(' · ')}
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => setSelectedCardId(card.card_id)}
                          className="text-blue-500 hover:underline whitespace-nowrap"
                        >
                          Use ID
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* Step 2 — Card ID + fetch buttons */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">2. Fetch price data</h2>
        <div className="flex gap-2 items-center">
          <input
            className="w-72 border rounded px-3 py-2 text-sm font-mono bg-background"
            placeholder="card_id"
            value={selectedCardId}
            onChange={e => setSelectedCardId(e.target.value)}
          />
          <select
            className="border rounded px-3 py-2 text-sm bg-background"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
          </select>
          <button
            onClick={runAllPrices}
            disabled={loading.allPrices || !selectedCardId}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading.allPrices ? 'Loading…' : 'All Prices'}
          </button>
          <button
            onClick={runComps}
            disabled={loading.comps || !selectedCardId}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          >
            {loading.comps ? 'Loading…' : 'Comps'}
          </button>
          <button
            onClick={() => { runAllPrices(); runComps(); }}
            disabled={(loading.allPrices || loading.comps) || !selectedCardId}
            className="px-4 py-2 text-sm font-medium border rounded hover:bg-muted disabled:opacity-50"
          >
            Both
          </button>
        </div>
      </section>

      {/* All Prices result */}
      {(allPrices !== null || errors.allPrices) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            all-prices-by-card — {allPrices?.length ?? 0} grades
          </h2>
          {errors.allPrices && <p className="text-sm text-red-500">{errors.allPrices}</p>}
          {allPrices && allPrices.length > 0 && (
            <div className="border rounded overflow-hidden text-sm">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">grade</th>
                    <th className="text-right px-3 py-2">price</th>
                  </tr>
                </thead>
                <tbody>
                  {allPrices.map((p, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                      <td className="px-3 py-1.5">{p.grade}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        ${parseFloat(String(p.price)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {allPrices && allPrices.length === 0 && (
            <p className="text-sm text-muted-foreground border rounded px-3 py-3">No price data returned.</p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw JSON</summary>
            <pre className="mt-2 p-3 bg-muted rounded overflow-auto max-h-64 text-[10px]">
              {JSON.stringify({ prices: allPrices }, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {/* Comps result */}
      {(comps !== null || errors.comps) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            comps ({days}d) — {comps?.length ?? 0} sales
          </h2>
          {errors.comps && <p className="text-sm text-red-500">{errors.comps}</p>}
          {comps && comps.length > 0 && (
            <div className="border rounded overflow-hidden text-sm">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">date</th>
                    <th className="text-left px-3 py-2">grade</th>
                    <th className="text-left px-3 py-2">platform</th>
                    <th className="text-right px-3 py-2">sale price</th>
                  </tr>
                </thead>
                <tbody>
                  {comps
                    .slice()
                    .sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())
                    .map((c, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-3 py-1.5 font-mono">{c.sale_date}</td>
                        <td className="px-3 py-1.5">{c.grade}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{c.platform}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-medium">
                          ${c.sale_price.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {comps && comps.length === 0 && (
            <p className="text-sm text-muted-foreground border rounded px-3 py-3">No comps returned for this window.</p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw JSON</summary>
            <pre className="mt-2 p-3 bg-muted rounded overflow-auto max-h-64 text-[10px]">
              {JSON.stringify({ comps }, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
