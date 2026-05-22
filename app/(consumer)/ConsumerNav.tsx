'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Settings, User, ClipboardList, Menu, X, LogOut, Heart, Home, Sparkles, Search as SearchIcon, Plus } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { DiscordIcon } from '@/components/icons/DiscordIcon';
import { DISCORD_INVITE_URL, isDiscordInviteConfigured } from '@/lib/community';
import { logout } from './actions';

interface ConsumerNavProps {
  isAdmin: boolean;
}

// Collapsed nav: logo + primary "+ Log a Break" pill + hamburger.
// All destinations live inside the slide-out sheet — same at every
// breakpoint. The previous desktop split (icon-only md, full lg)
// was overstuffed at desktop widths; one consistent pattern reads
// cleaner and the sheet already groups items by workflow phase.

export default function ConsumerNav({ isAdmin }: ConsumerNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet when the user navigates via back/forward.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [menuOpen]);

  return (
    <>
      <header
        className="sticky top-0 z-60 border-b flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5"
        style={{
          backgroundColor: 'rgba(10, 14, 26, 0.97)',
          borderColor: 'var(--terminal-border)',
          backdropFilter: 'blur(8px)',
          zIndex: 60,
          paddingTop: 'max(0.625rem, env(safe-area-inset-top))',
        }}
      >
        {/* Brand */}
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity shrink-0">
          <Logo variant="lockup" height={32} className="h-8 sm:h-7 w-auto" priority />
        </Link>

        {/* Right side: primary CTA + hamburger.
            Pill label collapses to "Log" on the smallest screens to
            preserve thumb-room next to the hamburger. */}
        <div className="flex items-center gap-2">
          <Link
            href="/my-breaks?view=new"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all hover:opacity-90"
            style={{
              background: 'var(--accent-blue)',
              color: 'white',
              boxShadow: '0 0 0 1px rgba(59,130,246,0.4), 0 2px 8px rgba(59,130,246,0.25)',
            }}
          >
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">Log a Break</span>
            <span className="sm:hidden">Log</span>
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="inline-flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-md transition-colors hover:bg-[var(--terminal-surface)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Slide-out destinations sheet — same at every breakpoint. */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-70"
          style={{ zIndex: 70 }}
          role="dialog"
          aria-modal="true"
        >
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          {/* Panel */}
          <div
            className="absolute right-0 top-0 bottom-0 w-72 max-w-[85vw] flex flex-col"
            style={{
              backgroundColor: 'var(--terminal-bg)',
              borderLeft: '1px solid var(--terminal-border)',
              paddingTop: 'env(safe-area-inset-top)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
              <Logo variant="lockup" height={28} className="h-7 w-auto" />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-[var(--terminal-surface)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex flex-col p-2 gap-1 flex-1">
              {/* Primary CTA — also visible in the header bar, but
                  duplicated at the top of the sheet so logging is
                  obviously the central act. */}
              <Link
                href="/my-breaks?view=new"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-semibold transition-all mb-1"
                style={{
                  background: 'var(--accent-blue)',
                  color: 'white',
                  boxShadow: '0 2px 8px rgba(59,130,246,0.25)',
                }}
              >
                <Plus className="w-4 h-4" />
                Log a Break
              </Link>

              <div className="text-[10px] uppercase tracking-widest px-3 py-1 mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Discover
              </div>
              <SheetLink href="/" icon={Home} label="Breaks" onClick={() => setMenuOpen(false)} />
              <SheetLink href="/analysis" icon={Sparkles} label="Research" onClick={() => setMenuOpen(false)} />
              <SheetLink href="/card-lookup" icon={SearchIcon} label="Slabs" onClick={() => setMenuOpen(false)} />

              <div className="text-[10px] uppercase tracking-widest px-3 py-1 mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Manage
              </div>
              <SheetLink href="/chase" icon={Heart} label="My Chase" onClick={() => setMenuOpen(false)} />
              <SheetLink href="/my-breaks" icon={ClipboardList} label="My Breaks" onClick={() => setMenuOpen(false)} />
              <SheetLink href="/profile" icon={User} label="Profile" onClick={() => setMenuOpen(false)} />

              {isDiscordInviteConfigured() && (
                <>
                  <div className="text-[10px] uppercase tracking-widest px-3 py-1 mt-2" style={{ color: 'var(--text-tertiary)' }}>
                    Community
                  </div>
                  <a
                    href={DISCORD_INVITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors hover:bg-[var(--terminal-surface)]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <DiscordIcon className="text-[#5865F2]" size={18} />
                    <span className="flex-1">Join Discord</span>
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                      ↗
                    </span>
                  </a>
                </>
              )}

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium border transition-colors hover:bg-[var(--terminal-surface)] mt-2"
                  style={{ color: 'var(--accent-blue)', borderColor: 'var(--terminal-border)' }}
                >
                  <Settings className="w-4 h-4" />
                  Admin Portal
                </Link>
              )}
            </nav>

            <div className="p-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
              <SignOutLink onClick={() => setMenuOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Sheet-drawer sign-out: same SW-cache-wipe semantics as SignOutButton,
// but rendered as a full-width row instead of a header chip. Duplicates
// the cache clear inline because we want the drawer to close before the
// form submits.
async function clearServiceWorkerCaches() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'BREAKIQ_LOGOUT' });
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
  } catch {
    // best-effort
  }
}

function SheetLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors hover:bg-[var(--terminal-surface)]"
      style={{ color: 'var(--text-primary)' }}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

function SignOutLink({ onClick }: { onClick: () => void }) {
  return (
    <form action={logout}>
      <button
        type="submit"
        onClick={() => { void clearServiceWorkerCaches(); onClick(); }}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors hover:bg-[var(--terminal-surface)]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </form>
  );
}
