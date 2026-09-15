import Link from 'next/link';
import { ClipboardList, Sparkles, ChevronRight } from 'lucide-react';
import { getCurrentUserFromSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Home — the routing surface from the 2026-09-15 UX rethink handoff.
 *
 * The headline says BreakIQ does two jobs, so Home is exactly two doors:
 * value a spot (Research) and log what you bought (Breaks). No inline forms —
 * both jobs need their full page anyway (Brody, 2026-09-15: a quick-value form
 * that hands off to Research's configurator is just a slower CTA).
 *
 * REDUCED vs. the handoff, deliberately. The designed Home also carries a
 * "pick up where you left off" block, stale valuation markers, and a
 * "valuations this month" stat. All three need a history of valuations —
 * and `/api/analysis` never persists a run (no valuation table exists).
 * See docs/plans/2026-09-15-ux-rethink-build-plan.md.
 */

export const dynamic = 'force-dynamic';

const EYEBROW: React.CSSProperties = { fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' };

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;

function JobCard({
  step, when, icon: Icon, iconColor, title, body, href, cta, primary, footer,
}: {
  step: string;
  when: string;
  icon: IconType;
  iconColor: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  primary?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col rounded-xl p-6 sm:p-7"
      style={{ backgroundColor: 'var(--panel)', border: '1px solid var(--rule)' }}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex w-11 h-11 items-center justify-center rounded-lg"
          style={{ backgroundColor: 'var(--sel)', border: '1px solid var(--rule-strong)' }}
        >
          <Icon className="w-5 h-5" strokeWidth={1.75} style={{ color: iconColor }} />
        </span>
        <span className="font-mono uppercase" style={EYEBROW}>{step} · {when}</span>
      </div>

      <h2 className="mt-6" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
        {title}
      </h2>
      <p className="mt-2" style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)', maxWidth: '44ch' }}>
        {body}
      </p>

      {footer && <div className="mt-5">{footer}</div>}

      <div className="mt-auto pt-7">
        <Link
          href={href}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 px-5 rounded-md transition-opacity hover:opacity-90"
          style={{
            height: 42,
            fontSize: 14,
            fontWeight: 600,
            ...(primary
              ? { backgroundColor: 'var(--btn-bg)', color: 'var(--btn-fg)' }
              : { backgroundColor: 'var(--sel)', color: 'var(--ink)', border: '1px solid var(--rule-strong)' }),
          }}
        >
          {cta}
          <ChevronRight className="w-4 h-4" strokeWidth={2} />
        </Link>
      </div>
    </section>
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

  const dateLabel = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', ' ·')
    .toUpperCase();

  // The record lives on the job it belongs to. Nothing logged → no "0 / 0";
  // most beta accounts are in that state.
  const recordFooter =
    logged > 0 ? (
      <Link
        href="/my-breaks"
        className="flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-[var(--sel)]"
        style={{ border: '1px solid var(--rule-faint)' }}
      >
        <span className="font-mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
          {logged} logged
        </span>
        {pending > 0 && (
          <span className="font-mono" style={{ fontSize: 13, color: 'var(--hold)' }}>
            {pending} awaiting results
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5" style={{ fontSize: 12, color: 'var(--ink2)' }}>
          Your breaks <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </span>
      </Link>
    ) : null;

  return (
    <div className="px-5 sm:px-8 lg:px-[34px] py-7 lg:py-[34px] max-w-[1100px]">
      <header>
        <div className="font-mono uppercase" style={EYEBROW}>{dateLabel}</div>
        <h1
          className="mt-2"
          style={{ fontSize: 'clamp(24px, 4vw, 30px)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.025em', color: 'var(--ink)' }}
        >
          {firstName ? `Start here, ${firstName}` : 'Start here'}
        </h1>
        <p className="mt-2" style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink2)', maxWidth: '62ch' }}>
          BreakIQ does two jobs: tell you what a spot is worth before you buy, and remember what
          happened after.
        </p>
      </header>

      <div className="mt-8 grid gap-4 lg:gap-5 md:grid-cols-2 items-stretch">
        <JobCard
          step="01"
          when="Before you buy"
          icon={Sparkles}
          iconColor="var(--accent-key)"
          title="Value a spot"
          body="Pick the product, teams and cases, enter the breaker's ask, and get a fair price with a buy, hold or pass verdict."
          href="/analysis"
          cta="Value a spot"
        />
        <JobCard
          step="02"
          when="After you buy"
          icon={ClipboardList}
          iconColor="var(--buy)"
          title="Log your break"
          body={
            pending > 0
              ? `${pending} ${pending === 1 ? 'purchase is' : 'purchases are'} still waiting on results. Every logged break feeds the comp set and sharpens the numbers you see.`
              : 'Record what you bought and how it went. Every logged break feeds the comp set and sharpens the numbers you see.'
          }
          href="/my-breaks?view=new"
          cta="Log a break"
          primary
          footer={recordFooter}
        />
      </div>
    </div>
  );
}
