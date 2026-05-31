/**
 * /break/[slug] — consumer break analysis page.
 *
 * Server component. Fetches product via slug (fast, single query), then
 * kicks off the heavier data bundle (pricing + chase + observations) as
 * an unawaited promise that gets streamed into the client via Suspense.
 *
 * The page returns in roughly two phases:
 *
 *   1. Instant (~100-300ms): hero header + product-driven banners + a
 *      skeleton placeholder for the dynamic content below.
 *   2. Data-resolve (~300-1500ms): BreakPageClient hydrates with the
 *      loaded BreakPageData and renders the format mix, slot tables,
 *      drawer, and (when applicable) the pre-release layout.
 *
 * Pre-conversion this was an 893-line client component that did all
 * fetching in a single useEffect, blocking first paint until everything
 * resolved. See CHANGELOG 2026-05-27 for the conversion writeup.
 */

import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import BetaBanner from '@/components/breakiq/BetaBanner';
import { loadBreakPageData, loadProductBySlug, type ProductWithSport } from '@/lib/break-page-data';
import { supabaseAdmin } from '@/lib/supabase';
import BreakPageClient from './BreakPageClient';
import BreakPageSkeleton from './BreakPageSkeleton';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BreakPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await loadProductBySlug(slug);
  if (!product) notFound();

  // Kick off the data fetch but DO NOT await — pass the promise down.
  // React 19's `use()` hook in BreakPageClient triggers Suspense while
  // the promise is pending, which shows BreakPageSkeleton below the
  // server-rendered hero + banners.
  const dataPromise = loadBreakPageData(product);

  // PYT rewrite — flag-gates whether the client uses fair_value_ev or
  // case_cost_share for hobby team slots. Fetched server-side so the
  // initial render is consistent with what the engine will compute.
  const { data: pytFlagRow } = await supabaseAdmin
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'fair_value_pyt_enabled')
    .maybeSingle();
  const fairValuePytEnabled = !!pytFlagRow?.enabled;

  const lifecycle = (product.lifecycle_status ?? 'live') as 'pre_release' | 'live' | 'dormant';
  const isPreRelease = lifecycle === 'pre_release';
  const isDormant = lifecycle === 'dormant';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <BreakHero product={product} />

      {/* Product-driven banners — render immediately, no data dependency.
          The data-driven banners (estimated count, EV-only) live inside
          BreakPageClient since they need the streamed-in pricing data. */}
      {isPreRelease && (
        <div className="border-b px-4 sm:px-6 py-3" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(168,85,247,0.08)' }}>
          <p className="text-xs font-semibold" style={{ color: '#c4b5fd' }}>
            Pre-release · {product.release_date ? `${product.name} launches ${formatReleaseDate(product.release_date)}` : `${product.name} hasn't launched yet`}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
            No live pricing yet — the secondary market hasn't established. Below: chase cards we're watching plus historical comps from these players' existing cards.
          </p>
        </div>
      )}
      {isDormant && (
        <div className="border-b px-4 sm:px-6 py-3" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'rgba(148,163,184,0.08)' }}>
          <p className="text-xs font-semibold" style={{ color: '#cbd5e1' }}>
            Dormant · {product.name} is no longer actively tracked
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-t-secondary)' }}>
            Pricing refreshes biweekly instead of nightly — values may lag the live market. Treat as historical reference, not a real-time read.
          </p>
        </div>
      )}

      <main className="px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-5 max-w-[1400px] mx-auto">
        <BetaBanner surface="break_page" />
        <Suspense fallback={<BreakPageSkeleton />}>
          <BreakPageClient
            product={product}
            dataPromise={dataPromise}
            fairValuePytEnabled={fairValuePytEnabled}
          />
        </Suspense>
      </main>
    </div>
  );
}

// ─── Server components ──────────────────────────────────────────────────

function BreakHero({ product }: { product: ProductWithSport }) {
  const sportName = product.sport?.name ?? '';
  const { primary, gradient } = getSportStyle(sportName);

  return (
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

      <div className="relative px-4 sm:px-6 py-4 sm:py-6">
        {/* Back nav */}
        <Link href="/">
          <button
            className="flex items-center gap-2 text-xs font-semibold mb-3 sm:mb-5 px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: 'white', backgroundColor: 'rgba(255,255,255,0.15)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Products
          </button>
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4 sm:gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5 sm:mb-2">
              <span
                className="text-[10px] font-bold uppercase px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md sm:rounded-lg backdrop-blur-sm"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', letterSpacing: '0.06em' }}
              >
                {sportName}
              </span>
              <span className="text-xs sm:text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.9)' }}>{product.year}</span>
              <span className="text-xs sm:text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>{product.manufacturer}</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white mb-2 sm:mb-3 break-words">{product.name}</h1>
            {!product.has_odds && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 rounded-md sm:rounded-lg backdrop-blur-sm w-fit" style={{ backgroundColor: 'rgba(245,158,11,0.3)' }}>
                <span className="text-[11px] sm:text-xs font-medium" style={{ color: '#fef3c7' }}>No odds · EV-only</span>
                <OddsTooltip />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
