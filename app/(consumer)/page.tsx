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

const EYEBROW: React.CSSProperties = { fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' };

/** Raised surface. Home used to put every section straight on the page ground,
 *  separated only by identical hairlines — which is why it all blended. */
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl ${className}`}
      style={{ backgroundColor: 'var(--panel)', border: '1px solid var(--rule)' }}
    >
      {children}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="font-mono" style={{ fontSize: 34, lineHeight: 1, fontWeight: 500, letterSpacing: '-0.02em', color: tone ?? 'var(--ink)' }}>
        {value}
      </div>
      <div className="mt-2" style={{ fontSize: 12, color: 'var(--ink2)' }}>{label}</div>
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
      className="flex items-center gap-3.5 w-full text-left transition-colors hover:bg-[var(--subtle)]"
      style={{ padding: '16px 20px' }}
    >
      <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.75} style={{ color: iconColor }} />
      <span className="flex-1 min-w-0">
        <span className="block" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
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
    <div className="px-5 sm:px-8 lg:px-[34px] py-7 lg:py-[34px] max-w-[1100px]">
      {/* Header — sits on the ground; everything actionable below is raised. */}
      <header>
        <div className="font-mono uppercase" style={EYEBROW}>{dateLabel}</div>
        <h1
          className="mt-2"
          style={{ fontSize: 'clamp(24px, 4vw, 30px)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.025em', color: 'var(--ink)' }}
        >
          {firstName ? `Start here, ${firstName}` : 'Start here'}
        </h1>
        <p className="mt-2" style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink2)', maxWidth: '62ch' }}>
          BreakIQ does two jobs: tell you what a spot is worth before you buy, and remember what
          happened after.
        </p>
      </header>

      <div className="mt-7 grid gap-4 lg:gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-stretch">
        <div className="flex flex-col gap-4 lg:gap-5 min-w-0">
          {/* Primary job. The only filled button on the page lives here, and
              the panel gets a left key-line so the eye lands on it first. */}
          <Panel className="relative overflow-hidden">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: 'var(--ink)' }} />
            <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <span
                className="hidden sm:flex w-11 h-11 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--sel)', border: '1px solid var(--rule-strong)' }}
              >
                <ClipboardList className="w-5 h-5" strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono uppercase" style={EYEBROW}>Do this first</div>
                <h2 className="mt-1.5" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
                  Log a break you bought into
                </h2>
                <p className="mt-1" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink2)' }}>
                  {promptCopy}
                </p>
              </div>
              <Link
                href="/my-breaks?view=new"
                className="inline-flex items-center justify-center px-5 rounded-md transition-opacity hover:opacity-90 shrink-0"
                style={{ height: 40, backgroundColor: 'var(--btn-bg)', color: 'var(--btn-fg)', fontSize: 13, fontWeight: 600 }}
              >
                Log now
              </Link>
            </div>
          </Panel>

          {/* Desktop only: the rail already routes to Research and Breaks, so a Home
              that only routes duplicates it. Give it a job the rail can't do:
              start a valuation. */}
          <Panel className="hidden lg:block p-6">
            <QuickValue products={pickerProducts} />
          </Panel>

          {/* Mobile keeps the stacked launcher — the tab bar is terse icons, so
              these rows earn their place on small screens. */}
          <Panel className="lg:hidden overflow-hidden">
            <RouteRow
              href="/analysis"
              icon={Sparkles}
              iconColor="var(--accent-key)"
              title="Value a spot"
              sub="Know the fair price before you commit to a slot"
            />
            <div style={{ borderTop: '1px solid var(--rule-faint)' }} />
            <RouteRow
              href="/my-breaks"
              icon={ClipboardList}
              iconColor="var(--buy)"
              title="Your break record"
              sub="Every break you've analyzed and bought, in one place"
            />
          </Panel>
        </div>

        {/* Record — figures, not rows, so the numbers read at a glance. */}
        <Panel className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="font-mono uppercase" style={EYEBROW}>Your record</span>
            <Link
              href="/my-breaks"
              className="inline-flex items-center gap-0.5 transition-opacity hover:opacity-80"
              style={{ fontSize: 12, color: 'var(--ink2)' }}
            >
              Breaks <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
            </Link>
          </div>
          {/* Most beta accounts have nothing logged, and a big "0 / 0" reads as a
              broken dashboard — so figures only appear once there's a record. */}
          {logged > 0 ? (
            <div className="mt-5 flex gap-4">
              <Figure label="Breaks logged" value={logged} />
              <div style={{ width: 1, backgroundColor: 'var(--rule)' }} />
              <Figure label="Awaiting results" value={pending} tone={pending > 0 ? 'var(--hold)' : undefined} />
            </div>
          ) : (
            <p className="mt-4" style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 500, color: 'var(--ink)' }}>
              Nothing logged yet. Your first break starts the record.
            </p>
          )}
          <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--rule-faint)' }}>
            <div className="font-mono uppercase mb-2" style={EYEBROW}>Why we ask you to log</div>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink2)' }}>
              Every logged break feeds the comp set. Your record is what turns a generic fair value
              into one that knows how you buy.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
