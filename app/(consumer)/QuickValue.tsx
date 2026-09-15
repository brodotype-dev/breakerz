'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';

/**
 * Desktop Home's quick-value entry.
 *
 * WHY THIS EXISTS: on desktop the rail is always present, so a Home page whose
 * only job is routing to Research and Breaks duplicates the rail — which is
 * exactly why desktop Home read as empty. This gives Home a job the rail can't
 * do: start a valuation.
 *
 * It deliberately does NOT run the analysis. A verdict needs a product, a team
 * or player selection, an ask, and at least one case; cramming all of that here
 * would just rebuild Research on Home. Instead it collects the two fields you
 * always know up front and hands them to Research prefilled, so you land on the
 * configurator with two steps already done.
 *
 * Desktop-only by design — mobile's stacked launcher already works (Brody,
 * 2026-09-15), and the tab bar there is terse icons, so the routing rows earn
 * their place on small screens in a way they don't on wide ones.
 */
export default function QuickValue({
  products,
}: {
  products: { id: string; name: string; year: string | number | null }[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState('');
  const [ask, setAsk] = useState('');

  function go() {
    if (!productId) return;
    const params = new URLSearchParams({ productId });
    const n = Number(ask);
    if (ask.trim() && Number.isFinite(n) && n > 0) params.set('ask', String(Math.round(n)));
    router.push(`/analysis?${params.toString()}`);
  }

  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 22 }}>
      <div
        className="font-mono uppercase mb-3"
        style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}
      >
        Value a spot
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[260px]">
          <span className="block mb-1.5" style={{ fontSize: 12, color: 'var(--ink2)' }}>Product</span>
          <select
            value={productId}
            onChange={e => setProductId(e.target.value)}
            className="w-full rounded-md px-3 text-sm outline-none"
            style={{
              height: 40,
              border: '1px solid var(--rule-strong)',
              backgroundColor: 'var(--bg)',
              color: 'var(--ink)',
            }}
          >
            <option value="">Select a product…</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.year ? `${p.year} ` : ''}{p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="w-[150px]">
          <span className="block mb-1.5" style={{ fontSize: 12, color: 'var(--ink2)' }}>Asking price</span>
          <div
            className="flex items-center gap-1 rounded-md px-3"
            style={{ height: 40, border: '1px solid var(--rule-strong)', backgroundColor: 'var(--bg)' }}
          >
            <span className="font-mono" style={{ fontSize: 13, color: 'var(--ink3)' }}>$</span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={ask}
              onChange={e => setAsk(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') go(); }}
              placeholder="optional"
              className="w-full bg-transparent border-0 outline-none font-mono text-sm placeholder:font-sans [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              style={{ color: 'var(--ink)' }}
            />
          </div>
        </label>

        <button
          onClick={go}
          disabled={!productId}
          className="inline-flex items-center gap-2 px-4 rounded-md transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ height: 40, backgroundColor: 'var(--btn-bg)', color: 'var(--btn-fg)', fontSize: 13, fontWeight: 600 }}
        >
          <Sparkles className="w-4 h-4" strokeWidth={1.75} />
          Value it
        </button>
      </div>

      <p className="mt-2" style={{ fontSize: 12, color: 'var(--ink3)' }}>
        Picks up in Research with these filled in — you just add teams and cases.
      </p>
    </div>
  );
}
