'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ChevronDown, Settings, Monitor, User, ClipboardList, Menu, X, LogOut } from 'lucide-react';
import { Logo } from '@/components/Logo';
import SignOutButton from './SignOutButton';
import { logout } from './actions';

interface ConsumerNavProps {
  isAdmin: boolean;
}

export default function ConsumerNav({ isAdmin }: ConsumerNavProps) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    }
    if (adminOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [adminOpen]);

  // Close the mobile sheet when the user navigates.
  useEffect(() => {
    if (!mobileOpen) return;
    const close = () => setMobileOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [mobileOpen]);

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
        {/* Brand — bigger on mobile so home is an easy tap target */}
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity shrink-0">
          <Logo variant="lockup" height={32} className="h-8 sm:h-7 w-auto" priority />
        </Link>

        {/* Desktop nav (≥ sm) */}
        <div className="hidden sm:flex items-center gap-2">
          <Link
            href="/my-breaks"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--terminal-surface)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ClipboardList className="w-3 h-3" />
            My Breaks
          </Link>
          <Link
            href="/profile"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--terminal-surface)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <User className="w-3 h-3" />
            Profile
          </Link>

          {isAdmin && (
            <div className="relative" ref={adminRef}>
              <button
                onClick={() => setAdminOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--terminal-surface)]"
                style={{ color: 'var(--accent-blue)', borderColor: 'var(--terminal-border)' }}
              >
                <Monitor className="w-3 h-3" />
                Consumer View
                <ChevronDown className={`w-3 h-3 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
              </button>
              {adminOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-lg border shadow-lg overflow-hidden"
                  style={{ backgroundColor: 'var(--terminal-surface)', borderColor: 'var(--terminal-border)' }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium"
                    style={{
                      color: 'var(--accent-blue)',
                      borderBottom: '1px solid var(--terminal-border)',
                      backgroundColor: 'rgba(59,130,246,0.06)',
                    }}
                  >
                    <Monitor className="w-3 h-3" />
                    Consumer View
                  </div>
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-[var(--terminal-surface-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                    onClick={() => setAdminOpen(false)}
                  >
                    <Settings className="w-3 h-3" />
                    Admin Portal
                  </Link>
                </div>
              )}
            </div>
          )}

          <SignOutButton />
        </div>

        {/* Mobile hamburger (< sm) */}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="sm:hidden inline-flex items-center justify-center h-10 w-10 rounded-md transition-colors hover:bg-[var(--terminal-surface)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile sheet — full-height drawer, paints over the page */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-70 sm:hidden"
          style={{ zIndex: 70 }}
          role="dialog"
          aria-modal="true"
        >
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
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
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-[var(--terminal-surface)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex flex-col p-2 gap-1 flex-1">
              <Link
                href="/my-breaks"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors hover:bg-[var(--terminal-surface)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <ClipboardList className="w-4 h-4" />
                My Breaks
              </Link>
              <Link
                href="/profile"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors hover:bg-[var(--terminal-surface)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <User className="w-4 h-4" />
                Profile
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium border transition-colors hover:bg-[var(--terminal-surface)]"
                  style={{ color: 'var(--accent-blue)', borderColor: 'var(--terminal-border)' }}
                >
                  <Settings className="w-4 h-4" />
                  Admin Portal
                </Link>
              )}
            </nav>

            <div className="p-2 border-t" style={{ borderColor: 'var(--terminal-border)' }}>
              <SignOutLink onClick={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Mobile-drawer sign-out: same SW-cache-wipe semantics as SignOutButton, but
// rendered as a full-width row instead of a header chip. Duplicates the cache
// clear inline because we want the drawer to close before the form submits.
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
