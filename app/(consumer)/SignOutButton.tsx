'use client';

import { LogOut } from 'lucide-react';
import posthog from 'posthog-js';
import { logout } from './actions';

// Wraps the logout server action so we can wipe service-worker caches before
// the redirect runs. Without this, the next user on a shared device could
// see cached HTML/RSC from the previous session.
async function clearServiceWorkerCaches() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    reg?.active?.postMessage({ type: 'BREAKIQ_LOGOUT' });
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // best-effort — never block logout
  }
}

export default function SignOutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        onClick={() => {
          // Fire-and-forget; the server action redirect will follow.
          void clearServiceWorkerCaches();
          // Reset PostHog identity so the next user on a shared device gets a
          // fresh anonymous distinct_id instead of inheriting this session's.
          try { posthog.reset(); } catch { /* swallow */ }
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--terminal-surface)]"
        style={{ color: 'var(--text-secondary)' }}
      >
        <LogOut className="w-3 h-3" />
        Sign Out
      </button>
    </form>
  );
}
