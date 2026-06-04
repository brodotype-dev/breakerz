import Link from 'next/link';
import { getCHCoverageForActiveProducts, getRecentCHAdditions, type CHCoverageRow } from '@/lib/ch-coverage';
import { AlertTriangle, CheckCircle2, Database, ExternalLink } from 'lucide-react';
import ProbeCHButton from './ProbeCHButton';
import CHAdditionsPanel from './CHAdditionsPanel';

// CardHedger data-health dashboard. One row per active product, surfacing
// the kind of signals that would have caught the 2026-05-20 ch_price_cache
// null-overwrite incident and the 2026-05-25 Kong-URL-cap regression at
// a glance instead of forensic side-experiments.
//
// Pure server component. Pulls counts via lib/ch-coverage.ts and renders
// a sortable-ish (HTML table — no client interactivity for v1) row per
// product with three category groups:
//
//   1. Catalog & cache (left) — how much of OUR card_ids does CH have data
//      for: distinct cards, cards-with-prices, all-null, never-fetched
//   2. Cache freshness (middle) — fresh vs stale ch_price_cache rows
//   3. Pricing delivery (right) — pricing_cache coverage + avg confidence
//      + last-priced timestamp (consumer-facing freshness)

export const dynamic = 'force-dynamic';

export default async function DataHealthPage() {
  const [rows, additions] = await Promise.all([
    getCHCoverageForActiveProducts(),
    getRecentCHAdditions(14),
  ]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Database className="w-5 h-5" />
            CardHedger Data Health
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Per-product CH coverage. Catches CH-side regressions + our own cache bugs at a glance.
            All counts scoped to cards <em>this product references</em> (matched variants only).
          </p>
        </div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {rows.length} active product{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      <CHAdditionsPanel data={additions} />

      {rows.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-tertiary)' }}
        >
          No active products.
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--terminal-surface-hover)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <Th>Product</Th>
                  <Th rightAlign>Distinct cards</Th>
                  <Th rightAlign>With prices</Th>
                  <Th rightAlign>All-null</Th>
                  <Th rightAlign>Never fetched</Th>
                  <Th rightAlign>Cache fresh</Th>
                  <Th rightAlign>Cache stale</Th>
                  <Th rightAlign>Priced players</Th>
                  <Th rightAlign>Pricing fresh</Th>
                  <Th rightAlign>Avg confidence</Th>
                  <Th>Last priced</Th>
                  <Th>CH live probe</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                {rows.map(r => (
                  <Row key={r.productId} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Legend />
    </div>
  );
}

function Th({ children, rightAlign }: { children?: React.ReactNode; rightAlign?: boolean }) {
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider ${rightAlign ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Row({ r }: { r: CHCoverageRow }) {
  const coveragePct = r.distinctCardIds > 0 ? r.cardsWithPrices / r.distinctCardIds : 0;
  const pricedPct = r.playerProductsTotal > 0 ? r.playerProductsPriced / r.playerProductsTotal : 0;

  // Coverage health buckets — also drives the column tint for `cardsWithPrices`.
  // Pre-release products are exempt from the coverage check because CH doesn't
  // catalog them until release. Calling them red would be noise.
  const coverageTier =
    r.lifecycleStatus === 'pre_release' ? 'preRelease'
    : coveragePct >= 0.6 ? 'good'
    : coveragePct >= 0.25 ? 'warn'
    : 'pass';

  return (
    <tr style={{ color: 'var(--text-secondary)' }} className="hover:bg-[var(--terminal-surface-hover)] transition-colors">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/products/${r.productId}`}
            className="font-medium text-sm hover:underline"
            style={{ color: 'var(--text-primary)' }}
          >
            {r.productName}
          </Link>
          <LifecyclePill ls={r.lifecycleStatus} />
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono">{r.distinctCardIds.toLocaleString()}</td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: tierColor(coverageTier) }}>
        {r.cardsWithPrices.toLocaleString()}
        <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          ({pct(coveragePct)})
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono">{r.cardsAllNull.toLocaleString()}</td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: r.cardsNeverFetched > 0 ? 'var(--signal-watch)' : 'var(--text-secondary)' }}>
        {r.cardsNeverFetched.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right font-mono">{r.cachedFresh.toLocaleString()}</td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: r.cachedStale > 0 ? 'var(--signal-watch)' : 'var(--text-secondary)' }}>
        {r.cachedStale.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {r.playerProductsPriced.toLocaleString()}/{r.playerProductsTotal.toLocaleString()}
        <span className="ml-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          ({pct(pricedPct)})
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono" style={{ color: r.pricingCacheStale > 0 ? 'var(--signal-watch)' : 'var(--text-secondary)' }}>
        {r.pricingCacheFresh.toLocaleString()}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {r.avgConfidence != null ? (r.avgConfidence * 100).toFixed(0) + '%' : '—'}
      </td>
      <td className="px-3 py-2 font-mono text-xs" title={r.lastPriced ?? ''}>
        {formatLastPriced(r.lastPriced)}
      </td>
      <td className="px-3 py-2">
        <ProbeCHButton productId={r.productId} />
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/admin/products/${r.productId}`}
          className="inline-flex items-center gap-1 text-xs hover:underline"
          style={{ color: 'var(--accent-blue)' }}
        >
          Open <ExternalLink className="w-3 h-3" />
        </Link>
      </td>
    </tr>
  );
}

function LifecyclePill({ ls }: { ls: CHCoverageRow['lifecycleStatus'] }) {
  const styles: Record<typeof ls, { bg: string; text: string; label: string }> = {
    pre_release: { bg: 'rgba(168,85,247,0.15)', text: '#a855f7', label: 'Pre' },
    live: { bg: 'rgba(16,185,129,0.15)', text: '#10b981', label: 'Live' },
    dormant: { bg: 'rgba(148,163,184,0.18)', text: '#94a3b8', label: 'Dormant' },
  };
  const s = styles[ls];
  return (
    <span
      className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

function tierColor(tier: 'good' | 'warn' | 'pass' | 'preRelease'): string {
  if (tier === 'good') return 'var(--signal-buy)';
  if (tier === 'warn') return 'var(--signal-watch)';
  if (tier === 'pass') return 'var(--signal-pass)';
  return 'var(--text-secondary)';
}

function pct(n: number): string {
  if (n === 0) return '0%';
  if (n < 0.01) return '<1%';
  return Math.round(n * 100) + '%';
}

function formatLastPriced(iso: string | null): string {
  if (!iso) return '—';
  const diffH = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return Math.round(diffH) + 'h ago';
  return Math.round(diffH / 24) + 'd ago';
}

function Legend() {
  return (
    <div
      className="rounded-xl p-4 text-xs space-y-2"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)', color: 'var(--text-tertiary)' }}
    >
      <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
        <AlertTriangle className="w-3.5 h-3.5" />
        Reading the dashboard
      </div>
      <ul className="space-y-1 list-disc list-inside">
        <li>
          <strong>With prices / All-null / Never fetched</strong> sum to <em>Distinct cards</em>. A high
          all-null % means CH genuinely has no sales data on these cards yet (pre-release,
          ultra-low-volume parallels). A high never-fetched % means the cron hasn&apos;t finished its
          first seed — wait a few firings.
        </li>
        <li>
          <strong>Cache fresh vs stale</strong> = fetched in the last 24h vs older. Stale → next cron
          firing picks it up.
        </li>
        <li>
          <strong>Priced players</strong> = consumer-facing slot-price coverage. <em>Pricing fresh</em>{' '}
          is the count of <code>pricing_cache</code> rows under the 24h TTL.
        </li>
        <li>
          <strong>Avg confidence</strong> is CH&apos;s sales-weighted confidence (0–100%) averaged
          across the product&apos;s player_products. Bucketed in the player drawer as Strong / Solid /
          Stale / Cold.
        </li>
        <li>
          <strong>Pre-release products</strong> are tinted neutral — CH doesn&apos;t catalog products
          before release, so &quot;zero coverage&quot; is expected, not a fire.
        </li>
        <li>
          Watch for sudden drops in <strong>With prices</strong> on a product that was previously
          green — that&apos;s the canary for a CH-side regression or one of our cache bugs.
        </li>
        <li>
          <strong>CH live probe</strong> is button-triggered (1 small CH call) — it asks CH&apos;s
          card-search how many cards exist in this product&apos;s set and compares to our{' '}
          <code>ch_set_cache</code>. Match = healthy. <em>CH +N</em> = CH grew, run Refresh CH Catalog
          on the product. <em>CH returned 0</em> = bad <code>ch_set_name</code> or CH outage.
        </li>
      </ul>
      <div className="pt-2 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <CheckCircle2 className="w-3 h-3" style={{ color: 'var(--signal-buy)' }} />
        Tier thresholds: <span style={{ color: 'var(--signal-buy)' }}>green ≥ 60%</span>{' · '}
        <span style={{ color: 'var(--signal-watch)' }}>yellow 25–60%</span>{' · '}
        <span style={{ color: 'var(--signal-pass)' }}>red &lt; 25%</span>
      </div>
    </div>
  );
}
