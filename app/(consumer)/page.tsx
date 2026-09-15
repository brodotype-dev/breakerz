import Link from 'next/link';
import { ClipboardList, Sparkles, ChevronRight } from 'lucide-react';
import { getCurrentUserFromSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getActiveProducts } from '@/lib/active-products';
import QuickValue from './QuickValue';

/**
 * Home — the routing surface from the 2026-09-15 UX rethink handoff.
 * Answers "what should I do now" and leads with logging, because logged
 * breaks are what sharpen every number in the app.
 *
 * REDUCED vs. the handoff, deliberately. The designed Home also carries a
 * "pick up where you left off" block, stale valuation markers, and a
 * "valuations this month" stat. All three need a history of valuations —
 * and `/api/analysis` never persists a run (no valuation table exists).
 * Rather than substitute recent *breaks* for recent *valuations* — different
 * objects, and the swap would quietly misrepresent them — those are omitted.
 * See docs/plans/2026-09-15-ux-rethink-build-plan.md.
 */

export const dynamic = 'force-dynamic';

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5" style={{ borderTop: '1px solid var(--rule-faint)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink2)' }}>{label}</span>
      <span
        className="font-mono"
        style={{ fontSize: 15, fontWeight: 500, color: accent ? 'var(--accent-key)' : 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}

function RouteRow({
  href, icon: Icon, title, sub, iconColor,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  title: string;
  sub: string;
  iconColor: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3.5 w-full text-left transition-opacity hover:opacity-80"
      style={{ padding: '18px 0', borderBottom: '1px solid var(--rule-faint)' }}
    >
      <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.75} style={{ color: iconColor }} />
      <span className="flex-1 min-w-0">
        <span className="block" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span className="block mt-0.5" style={{ fontSize: 13, color: 'var(--ink2)' }}>{sub}</span>
      </span>
      <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={1.75} style={{ color: 'var(--ink3)' }} />
    </Link>
  );
}

export default async function HomePage() {
  const user = await getCurrentUserFromSession();

  let firstName = '';
  let logged = 0;
  let pending = 0;

  if (user) {
    const [{ data: profile }, { count: loggedCount }, { count: pendingCount }] = await Promise.all([
      supabaseAdmin.from('profiles').select('first_name, full_name').eq('id', user.id).maybeSingle(),
      supabaseAdmin.from('user_breaks').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_test', false),
      supabaseAdmin.from('user_breaks').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_test', false).eq('status', 'pending'),
    ]);
    firstName =
      profile?.first_name?.trim() ||
      (profile?.full_name ?? '').trim().split(' ')[0] ||
      '';
    logged = loggedCount ?? 0;
    pending = pendingCount ?? 0;
  }

  // Shared cache entry with Research — no extra DB hit.
  const { products } = await getActiveProducts();
  const pickerProducts = products.map(p => ({ id: p.id, name: p.name, year: p.year ?? null }));

  const dateLabel = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', ' ·')
    .toUpperCase();

  // Empty state: a brand-new account has nothing logged, so the prompt can't
  // claim purchases are waiting. Say what the app is for instead.
  const promptCopy =
    logged === 0
      ? 'Bought into a break? Logging it is what sharpens every number you see here.'
      : pending > 0
        ? `${pending} ${pending === 1 ? 'purchase is' : 'purchases are'} still waiting on results. Logging is what sharpens every number you see here.`
        : 'Logging what you bought is what sharpens every number you see here.';

  return (
    <div className="px-5 sm:px-8 lg:px-[34px] py-7 lg:py-[30px] max-w-[1100px]">
      {/* Header */}
      <div style={{ paddingBottom: 20, borderBottom: '1px solid var(--rule)' }}>
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
          {dateLabel}
        </div>
        <h1
          className="mt-2"
          style={{ fontSize: 'clamp(22px, 4vw, 27px)', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.022em', color: 'var(--ink)' }}
        >
          {firstName ? `Start here, ${firstName}` : 'Start here'}
        </h1>
        <p className="mt-1.5" style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink2)', maxWidth: '62ch' }}>
          BreakIQ does two jobs: tell you what a spot is worth before you buy, and remember what
          happened after.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2.5">
            <ClipboardList className="w-[17px] h-[17px]" strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              Log a break you bought into
            </span>
          </div>
          <span className="flex-1 min-w-[220px]" style={{ fontSize: 13, color: 'var(--ink2)' }}>
            {promptCopy}
          </span>
          <Link
            href="/my-breaks?view=new"
            className="inline-flex items-center justify-center px-4 rounded-md transition-opacity hover:opacity-90"
            style={{ height: 38, backgroundColor: 'var(--btn-bg)', color: 'var(--btn-fg)', fontSize: 13, fontWeight: 600 }}
          >
            Log now
          </Link>
        </div>
      </div>

      {/* Desktop only: the rail already routes to Research and Breaks, so a Home
          that only routes duplicates it — which is why desktop Home read as
          empty. Give it a job the rail can't do: start a valuation. Mobile keeps
          the stacked launcher, which works because the tab bar is terse icons. */}
      <div className="hidden lg:block mt-[26px]">
        <QuickValue products={pickerProducts} />
      </div>

      {/* Body */}
      <div className="mt-[26px] flex flex-col lg:flex-row gap-9">
        <div className="flex-1 min-w-0">
          <div className="font-mono uppercase mb-1" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
            Or
          </div>
          <RouteRow
            href="/analysis"
            icon={Sparkles}
            iconColor="var(--accent-key)"
            title="Value a spot"
            sub="Know the fair price before you commit to a slot"
          />
          <RouteRow
            href="/my-breaks"
            icon={ClipboardList}
            iconColor="var(--buy)"
            title="Your break record"
            sub="Every break you've analyzed and bought, in one place"
          />
        </div>

        <aside className="w-full lg:w-[262px] shrink-0">
          <div className="font-mono uppercase mb-2" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}>
            Why we ask you to log
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)' }}>
            Every logged break feeds the comp set. Your record is what turns a generic fair value
            into one that knows how you buy.
          </p>
          <div className="mt-5">
            <Stat label="Breaks logged" value={String(logged)} />
            <Stat label="Awaiting results" value={String(pending)} accent={pending > 0} />
          </div>
        </aside>
      </div>
    </div>
  );
}
