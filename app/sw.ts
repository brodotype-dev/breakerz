/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig, RuntimeCaching } from 'serwist';
import { Serwist, NetworkOnly } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Paths that must never be served from cache and must never be intercepted
// in a way that could leak data across users. Auth pages and any API call
// (pricing, my-breaks, etc.) need fresh data every time. Admin is desktop-
// only and has no business in the consumer cache.
const BYPASS_RE = /^\/(admin|api|auth)(\/|$)/;

const bypassRules: RuntimeCaching[] = [
  {
    matcher: ({ url: { pathname }, sameOrigin }) => sameOrigin && BYPASS_RE.test(pathname),
    handler: new NetworkOnly(),
  },
];

// Drop defaultCache rules that would otherwise cache API responses or shadow
// our bypass — we want consumer HTML/RSC caching but not API caching.
const filteredDefault = defaultCache.filter((rule) => {
  const src = typeof rule.matcher === 'function' ? rule.matcher.toString() : '';
  return !src.includes('"/api/"') && !src.includes("'/api/'");
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...bypassRules, ...filteredDefault],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

serwist.addEventListeners();

// Listen for explicit logout from the consumer logout action and wipe every
// cache the SW owns. Stops the next user on a shared device from seeing the
// previous user's cached HTML/RSC.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'BREAKIQ_LOGOUT') {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      })(),
    );
  }
});
