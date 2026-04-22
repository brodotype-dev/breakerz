import { supabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Product, Sport } from '@/lib/types';
import OddsUpload from './OddsUpload';
import RunMatchingButton from './RunMatchingButton';
import RefreshCatalogButton from './RefreshCatalogButton';
import BreakIQBetsDebrief from './BreakIQBetsDebrief';
import BreakerComparisonPanel from './BreakerComparisonPanel';
import PricingBreakdownPanel from './PricingBreakdownPanel';

type PageProps = { params: Promise<{ id: string }> };

function Section({
  title,
  accent,
  badge,
  children,
}: {
  title: string;
  accent: string;
  badge?: { label: string; color: string };
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      <div className="h-1" style={{ background: accent }} />
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            {title}
          </h2>
          {badge && (
            <span className="text-xs font-medium" style={{ color: badge.color }}>
              {badge.label}
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function ReadinessStat({
  label,
  pill,
  value,
  sub,
}: {
  label: string;
  pill: 'ok' | 'warn' | 'empty';
  value: string;
  sub: string;
}) {
  return (
    <div
      className="p-3 rounded-lg space-y-1"
      style={{ backgroundColor: 'var(--terminal-surface-hover)' }}
    >
      <div className="flex items-center gap-2">
        <StatusPill value={pill} />
        <span className="terminal-label-muted">{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-4 py-2 text-sm font-medium transition-all hover:bg-[var(--terminal-surface-active)]"
      style={{ border: '1px solid var(--terminal-border)', color: 'var(--text-secondary)' }}
    >
      {label}
    </Link>
  );
}

function StatusPill({ value }: { value: 'ok' | 'warn' | 'empty' }) {
  if (value === 'ok') return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--signal-buy)', boxShadow: 'var(--glow-green)' }} />;
  if (value === 'warn') return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--signal-watch)' }} />;
  return <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--text-disabled)' }} />;
}

export default async function ProductDashboardPage({ params }: PageProps) {
  const { id } = await params;

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('id', id)
    .single<Product & { sport: Sport }>();

  if (!product) notFound();

  // Counts only — do NOT fetch rows. Supabase/PostgREST caps any single
  // response at 1000 rows by default, which silently underreports for large
  // products (e.g. Topps Finest has ~19k variants). `head: true` returns just
  // the Content-Range count header with no body, no cap.

  // Players
  const [{ count: ppTotal }, { count: autoEligibleCount }] = await Promise.all([
    supabaseAdmin
      .from('player_products')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id),
    supabaseAdmin
      .from('player_products')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id)
      .eq('insert_only', false),
  ]);

  // Variants — total, matched, with-odds
  const variantBase = () =>
    supabaseAdmin
      .from('player_product_variants')
      .select('id, player_products!inner(product_id)', { count: 'exact', head: true })
      .eq('player_products.product_id', id);

  const [{ count: variantTotalRaw }, { count: variantMatchedRaw }, { count: variantWithOddsRaw }] =
    await Promise.all([
      variantBase(),
      variantBase().not('cardhedger_card_id', 'is', null),
      variantBase().or('hobby_odds.not.is.null,breaker_odds.not.is.null'),
    ]);

  const variantTotal = variantTotalRaw ?? 0;
  const variantMatched = variantMatchedRaw ?? 0;
  const variantWithOdds = variantWithOddsRaw ?? 0;
  const unmatchedCount = variantTotal - variantMatched;

  // Unmatched preview — push filter + limit to the server; 50 rows for display.
  // Join player name via player_products → players in one query.
  const { data: unmatchedSample } = await supabaseAdmin
    .from('player_product_variants')
    .select(
      'id, variant_name, card_number, player_products!inner(product_id, player:players(name))',
    )
    .eq('player_products.product_id', id)
    .is('cardhedger_card_id', null)
    .limit(50);

  const unmatchedVariants = (unmatchedSample ?? []).map(v => ({
    id: v.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    playerName: (v as any).player_products?.player?.name ?? '',
    variantName: v.variant_name,
    cardNumber: v.card_number,
  }));

  // Pricing cache — count + newest fetched_at, no row fetch
  const [{ count: cachedCountRaw }, { data: lastFetchedRow }] = await Promise.all([
    supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, player_products!inner(product_id)', {
        count: 'exact',
        head: true,
      })
      .eq('player_products.product_id', id)
      .gt('expires_at', new Date().toISOString()),
    supabaseAdmin
      .from('pricing_cache')
      .select('fetched_at, player_products!inner(product_id)')
      .eq('player_products.product_id', id)
      .gt('expires_at', new Date().toISOString())
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const cachedCount = cachedCountRaw ?? 0;
  const lastFetched = lastFetchedRow?.fetched_at;

  const autoEligible = autoEligibleCount ?? 0;
  const ppTotalSafe = ppTotal ?? 0;
  const playerStatus = autoEligible > 0 ? 'ok' : 'empty';
  const variantMatchPct = variantTotal > 0 ? variantMatched / variantTotal : 0;
  const variantStatus = variantTotal === 0 ? 'empty' : variantMatchPct >= 0.8 ? 'ok' : 'warn';
  const oddsStatus = product.has_odds ? 'ok' : variantWithOdds > 0 ? 'warn' : 'empty';
  const pricingStatus = cachedCount === 0 ? 'empty' : cachedCount >= autoEligible ? 'ok' : 'warn';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Products
      </Link>

      {/* Hero Header */}
      <div
        className="relative overflow-hidden rounded-2xl p-6"
        style={{ background: 'var(--gradient-hero)', border: '1px solid var(--terminal-border)' }}
      >
        <div
          className="absolute top-0 right-0 w-64 h-64 blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold uppercase px-2 py-1 rounded"
                style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: 'var(--accent-blue)' }}
              >
                {product.sport?.name}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                {product.year}
              </span>
              {product.is_active ? (
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--signal-buy-bg)', color: 'var(--signal-buy)' }}>
                  LIVE
                </span>
              ) : (
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-disabled)' }}>
                  DRAFT
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {product.name}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {product.manufacturer} · Product Dashboard
            </p>
          </div>
          <Link
            href={product.slug ? `/break/${product.slug}` : '#'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ backgroundColor: 'rgba(59,130,246,0.1)', borderLeft: '3px solid var(--accent-blue)', color: 'var(--accent-blue)' }}
          >
            View Break →
          </Link>
        </div>
      </div>

      <div className="space-y-4">

        {/* Readiness summary */}
        <Section title="Product Readiness" accent="var(--gradient-blue)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <ReadinessStat label="Players" pill={playerStatus} value={String(autoEligible)} sub={`${ppTotalSafe} total incl. inserts`} />
            <ReadinessStat label="CH Matched" pill={variantStatus} value={variantTotal > 0 ? `${Math.round(variantMatchPct * 100)}%` : '—'} sub={`${variantMatched}/${variantTotal} variants`} />
            <ReadinessStat label="Odds" pill={oddsStatus} value={product.has_odds ? 'Imported' : variantWithOdds > 0 ? 'Partial' : 'Pending'} sub={`${variantWithOdds} variants`} />
            <ReadinessStat label="Pricing" pill={pricingStatus} value={String(cachedCount)} sub={lastFetched ? `Last: ${new Date(lastFetched).toLocaleDateString()}` : 'Not yet fetched'} />
          </div>
        </Section>

        {/* Quick actions */}
        <Section title="Quick Actions" accent="var(--gradient-green)">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <ActionLink href={`/admin/products/${id}/players`} label="Manage Players →" />
              <ActionLink href={`/admin/import-checklist?productId=${id}`} label="Import Checklist →" />
              <ActionLink href={`/break/${product.slug}`} label="View Break Page →" />
            </div>
            <RefreshCatalogButton productId={id} />
            <RunMatchingButton productId={id} />
          </div>
        </Section>

        {/* Odds upload */}
        <Section
          title="Import Odds"
          accent="var(--gradient-orange)"
          badge={product.has_odds ? { label: 'Odds imported', color: 'var(--signal-buy)' } : undefined}
        >
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Upload the manufacturer odds PDF to apply pull rates to variants.
          </p>
          <OddsUpload productId={id} />
        </Section>

        {/* Breakerz Bets debrief */}
        <Section title="BreakIQ Bets" accent="var(--gradient-purple)">
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Tell us what you{"'"}re seeing in the market — Claude extracts player mentions, scores sentiment, and drafts reason notes for your review.
          </p>
          <BreakIQBetsDebrief productId={id} />
        </Section>

        {/* Unmatched variants */}
        {unmatchedVariants.length > 0 && (
          <Section
            title="Unmatched Variants"
            accent="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
            badge={{ label: `${unmatchedCount} unmatched`, color: 'var(--signal-watch)' }}
          >
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              These variants have no CardHedger card ID. Re-run matching from the import wizard, or import the checklist again if players are missing.
            </p>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ backgroundColor: 'var(--terminal-surface-hover)', color: 'var(--text-tertiary)' }}>
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">Player</th>
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">Variant</th>
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider">#</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
                  {unmatchedVariants.map(v => (
                    <tr key={v.id} className="hover:bg-[var(--terminal-surface-hover)] transition-colors">
                      <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>{v.playerName}</td>
                      <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{v.variantName}</td>
                      <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{v.cardNumber ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Pricing Audit */}
        <PricingBreakdownPanel
          productId={id}
          hobbyCaseCost={product.hobby_case_cost}
          bdCaseCost={product.bd_case_cost}
        />

        {/* Breaker Comparison */}
        <Section title="Breaker Comparison" accent="var(--gradient-purple)">
          <BreakerComparisonPanel productId={id} />
        </Section>

        {/* Product details */}
        <Section title="Product Details" accent="var(--gradient-blue)">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: 'Manufacturer', value: product.manufacturer },
              { label: 'Year', value: String(product.year) },
              { label: 'Sport', value: product.sport?.name ?? '—' },
              { label: 'Hobby / Case', value: product.hobby_case_cost != null ? `$${product.hobby_case_cost.toLocaleString()}` : '—' },
              ...(product.bd_case_cost ? [{ label: 'BD / Case', value: `$${product.bd_case_cost.toLocaleString()}` }] : []),
              { label: 'Status', value: product.is_active ? 'Active' : 'Inactive', highlight: product.is_active ? 'var(--signal-buy)' : undefined },
            ].map(field => (
              <div key={field.label}>
                <p className="terminal-label-muted mb-1">{field.label}</p>
                <p className="text-sm font-medium font-mono" style={{ color: (field as any).highlight ?? 'var(--text-primary)' }}>
                  {field.value}
                </p>
              </div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}
