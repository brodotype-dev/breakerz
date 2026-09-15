'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Sparkles, ClipboardList, Layers,
  Search as SearchIcon, Heart, User, Settings, LogOut, Plus, Menu, X,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { DiscordIcon } from '@/components/icons/DiscordIcon';
import { DISCORD_INVITE_URL, isDiscordInviteConfigured } from '@/lib/community';
import { logout } from './actions';

/**
 * Four-destination nav from the 2026-09-15 UX rethink handoff:
 * desktop = persistent 196px rail, mobile = four-item bottom tab bar,
 * with Slabs + Chase demoted to a secondary TOOLS group.
 *
 * ONE DELIBERATE DEPARTURE from the handoff's IA. Its fourth destination is
 * "Learn", which is not built — every figure on it derives from a
 * returned/pull value the app has never stored (see the build plan). Rather
 * than ship a dead fourth item, that slot is **Breaks** — the product grid
 * that used to live at `/` and moved to `/breaks` when `/` became Home.
 * Result: four real destinations, nothing orphaned, and the handoff's
 * structure intact.
 */

const PRIMARY = [
  { href: '/',            icon: Home,          label: 'Home',     exact: true },
  { href: '/analysis',    icon: Sparkles,      label: 'Research', exact: false },
  { href: '/my-breaks',   icon: ClipboardList, label: 'Log',      exact: false },
  { href: '/breaks',      icon: Layers,        label: 'Breaks',   exact: false },
] as const;

const TOOLS = [
  { href: '/card-lookup', icon: SearchIcon, label: 'Slabs' },
  { href: '/chase',       icon: Heart,      label: 'Chase' },
] as const;

function useIsActive() {
  const pathname = usePathname() ?? '/';
  return (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
}

export default function ConsumerNav({
  isAdmin,
  plan = 'free',
  pendingCount = 0,
}: {
  isAdmin: boolean;
  plan?: string;
  pendingCount?: number;
}) {
  const isActive = useIsActive();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close the overflow sheet on back/forward so it can't linger over a new page.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [menuOpen]);

  const isPro = plan && plan !== 'free';
  const planLabel = isPro ? plan.toUpperCase() : 'FREE';
  const planDetail = isPro ? 'Unlimited valuations' : '5 lifetime analyses';
  const planFill = isPro ? '100%' : '33%';

  return (
    <>
      {/* ── Desktop rail ─────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex fixed left-0 top-0 bottom-0 z-50 flex-col"
        style={{
          width: 196,
          padding: '24px 14px',
          backgroundColor: 'var(--panel)',
          borderRight: '1px solid var(--rule)',
        }}
      >
        <Link href="/" className="flex items-center mb-6 px-2 hover:opacity-80 transition-opacity">
          <Logo variant="lockup" height={26} className="h-[26px] w-auto" priority />
        </Link>

        <nav className="flex flex-col gap-0.5">
          {PRIMARY.map(({ href, icon: Icon, label, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors"
                style={{
                  backgroundColor: active ? 'var(--sel)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink2)',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {label === 'Log' && pendingCount > 0 && (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--ink3)' }}>
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div
          className="mt-6 mb-1.5 px-2.5 font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}
        >
          Tools
        </div>
        <nav className="flex flex-col gap-0.5">
          {TOOLS.map(({ href, icon: Icon, label }) => {
            const active = isActive(href, false);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors"
                style={{
                  backgroundColor: active ? 'var(--sel)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink2)',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer: plan → Discord → account */}
        <div className="mt-auto pt-4">
          <div className="px-2.5">
            <div
              className="font-mono uppercase"
              style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}
            >
              {planLabel}
            </div>
            <div className="mt-1 mb-2" style={{ fontSize: 12, color: 'var(--ink2)' }}>
              {planDetail}
            </div>
            <div style={{ height: 2, backgroundColor: 'var(--rule)' }}>
              <div style={{ height: 2, width: planFill, backgroundColor: 'var(--accent-key)' }} />
            </div>
            {!isPro && (
              <Link
                href="/subscribe"
                className="inline-block mt-2 hover:opacity-80"
                style={{ fontSize: 12, color: 'var(--accent-key)' }}
              >
                Go Pro →
              </Link>
            )}
          </div>

          {isDiscordInviteConfigured() && (
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-2.5 py-2 mt-3 rounded-md hover:bg-[var(--subtle)] transition-colors"
              style={{ fontSize: 12, fontWeight: 600, color: '#5865F2' }}
            >
              <DiscordIcon size={15} />
              Discord
            </a>
          )}

          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--rule)' }}>
            <Link
              href="/profile"
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[var(--subtle)] transition-colors"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}
            >
              <User className="w-[15px] h-[15px]" strokeWidth={1.75} />
              Account
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[var(--subtle)] transition-colors"
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}
              >
                <Settings className="w-[15px] h-[15px]" strokeWidth={1.75} />
                Admin
              </Link>
            )}
            <form action={logout}>
              <button
                type="submit"
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-[var(--subtle)] transition-colors"
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}
              >
                <LogOut className="w-[15px] h-[15px]" strokeWidth={1.75} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── Mobile header: brand + the one filled action ──────────── */}
      <header
        className="lg:hidden sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2.5"
        style={{
          backgroundColor: 'var(--panel)',
          borderBottom: '1px solid var(--rule)',
          paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
        }}
      >
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity shrink-0">
          <Logo variant="lockup" height={28} className="h-7 w-auto" priority />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/my-breaks?view=new"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--btn-bg)',
              color: 'var(--btn-fg)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Log
          </Link>
          {/* The four-item tab bar can't carry Tools or the account actions.
              Without this, mobile users lose Slabs, Chase, Profile, Admin and
              SIGN OUT entirely — they were in the old slide-out sheet. */}
          <button
            type="button"
            aria-label="More"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="inline-flex items-center justify-center rounded-md transition-colors hover:bg-[var(--subtle)]"
            style={{ height: 36, width: 36, color: 'var(--ink2)' }}
          >
            <Menu className="w-5 h-5" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Mobile overflow sheet — Tools + account */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <div
            className="absolute right-0 top-0 bottom-0 w-64 max-w-[85vw] flex flex-col"
            style={{
              backgroundColor: 'var(--panel)',
              borderLeft: '1px solid var(--rule)',
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: '1px solid var(--rule)' }}
            >
              <span
                className="font-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink3)' }}
              >
                Tools
              </span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setMenuOpen(false)}
                className="inline-flex items-center justify-center rounded-md hover:bg-[var(--subtle)]"
                style={{ height: 36, width: 36, color: 'var(--ink2)' }}
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <nav className="flex flex-col p-2 gap-0.5">
              {TOOLS.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--subtle)]"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}
                >
                  <Icon className="w-[17px] h-[17px]" strokeWidth={1.75} />
                  {label}
                </Link>
              ))}

              <div className="my-2" style={{ borderTop: '1px solid var(--rule)' }} />

              <Link
                href="/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--subtle)]"
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}
              >
                <User className="w-[17px] h-[17px]" strokeWidth={1.75} />
                Account
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--subtle)]"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}
                >
                  <Settings className="w-[17px] h-[17px]" strokeWidth={1.75} />
                  Admin
                </Link>
              )}
              {isDiscordInviteConfigured() && (
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--subtle)]"
                  style={{ fontSize: 14, fontWeight: 600, color: '#5865F2' }}
                >
                  <DiscordIcon size={17} />
                  Discord
                </a>
              )}
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-md hover:bg-[var(--subtle)]"
                  style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink3)' }}
                >
                  <LogOut className="w-[17px] h-[17px]" strokeWidth={1.75} />
                  Sign out
                </button>
              </form>
            </nav>
          </div>
        </div>
      )}

      {/* ── Mobile bottom tab bar ─────────────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex"
        style={{
          backgroundColor: 'var(--panel)',
          borderTop: '1px solid var(--rule)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {PRIMARY.map(({ href, icon: Icon, label, exact }) => {
          // Guard against a hydration mismatch: usePathname is stable, but the
          // active style is the only thing that differs pre-mount.
          const active = mounted && isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
              style={{ color: active ? 'var(--ink)' : 'var(--ink3)', minHeight: 56 }}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
