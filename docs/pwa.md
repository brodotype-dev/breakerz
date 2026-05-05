# PWA — Consumer App Shell

BreakIQ's consumer surface is a Progressive Web App. Admin (`/admin/*`, `/api/admin/*`) is intentionally excluded — it stays a plain desktop web app.

## What ships

- **Manifest** — [`app/manifest.ts`](../app/manifest.ts), served at `/manifest.webmanifest`. `display: standalone`, `start_url: /`, `scope: /`, theme + background `#0a0e1a` (matches `--background`).
- **Icons** — [`public/icons/`](../public/icons): `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png` (180×180). Generated from `public/brand/icon-gradient.svg` via [`scripts/generate-pwa-icons.mjs`](../scripts/generate-pwa-icons.mjs). Re-run the script if the brand mark changes.
- **Service worker** — [`app/sw.ts`](../app/sw.ts), built by `@serwist/next` to `public/sw.js`. Registered automatically by Serwist's runtime; SW is **disabled in development** (`disable: process.env.NODE_ENV === 'development'`).
- **Offline fallback** — [`app/offline/page.tsx`](../app/offline/page.tsx). Returned by the SW for navigation requests when both network and cache miss.
- **Install prompt** — [`app/(consumer)/InstallPrompt.tsx`](../app/(consumer)/InstallPrompt.tsx). Captures `beforeinstallprompt` (Android Chrome / desktop Chrome / Edge) and renders a dismissible chip. iOS Safari gets a one-time "Tap Share → Add to Home Screen" hint instead.
- **Cache wipe on logout** — [`app/(consumer)/SignOutButton.tsx`](../app/(consumer)/SignOutButton.tsx) posts `{type:'BREAKIQ_LOGOUT'}` to the SW, which deletes every Cache Storage bucket. Prevents the next user on a shared device from seeing the previous user's RSC payloads.

## Cache strategy

Runtime caching is layered. First match wins.

| Path pattern | Strategy | Why |
|---|---|---|
| `/admin/*`, `/api/*`, `/auth/*` | NetworkOnly | Admin is desktop-only. APIs (pricing, my-breaks, slab analysis) need fresh data. Auth pages must always hit the server. |
| Fonts (`fonts.gstatic.com`, `*.woff2`, etc.) | CacheFirst / SWR | Versioned by URL — safe to cache long-term. |
| Images (`*.png`, `*.svg`, etc.) | StaleWhileRevalidate | Brand assets and uploaded images. |
| `/_next/static/*.js` | CacheFirst | Next.js content-hashes these — cache-bust comes for free on deploy. |
| `/_next/image` | StaleWhileRevalidate | Next/Image responses. |
| Same-origin HTML / RSC (consumer routes) | NetworkFirst | Live data wins; cached shell only fills in for offline. |
| Cross-origin GET | NetworkFirst (10s timeout) | Best-effort. |

The SW falls back to `/offline` when a navigation request can't be served from network or cache.

## Install matrix

| Surface | Install entry point | Notes |
|---|---|---|
| Android Chrome | Browser menu → "Install app", or the auto-shown InstallPrompt chip | Splash uses `theme_color` + `icon-512`. |
| Desktop Chrome / Edge | URL-bar install icon, or the InstallPrompt chip | Launches in a standalone window. |
| iOS Safari | Share → Add to Home Screen | No `beforeinstallprompt`. We show a one-time hint. Status bar uses `black-translucent`. |
| iOS Chrome / Firefox / Edge | Not installable | iOS only allows installs from Safari. |

## Cache invalidation

The SW uses `skipWaiting + clientsClaim`, so a new deploy activates on the next page load. To force-bust everything (e.g. after a breaking schema change):

1. Bump the icon path or precache version in `app/sw.ts`.
2. Redeploy.
3. The new `/sw.js` (served `Cache-Control: no-cache` per `next.config.ts`) replaces the old one immediately.

If a beta tester reports stale data:
- DevTools → Application → Service Workers → "Unregister".
- Or post `{type:'BREAKIQ_LOGOUT'}` from the console: `(await navigator.serviceWorker.getRegistration())?.active?.postMessage({type:'BREAKIQ_LOGOUT'})`.

## Testing installability

1. `npm run build && npm start` (SW only ships in production builds).
2. Chrome DevTools → Application → Manifest → "Add to homescreen" → walks you through install.
3. Lighthouse → PWA category. Bar is "installable" + correct theme/splash, not 100/100.
4. Real-device smoke test required before declaring done — iOS Safari quietly drops manifest fields the spec says it supports.

## Known gotchas

- **Vercel + custom headers on `/sw.js`** — `next.config.ts`'s `headers()` is the right place; verify the response actually carries `Service-Worker-Allowed: /` and `Cache-Control: no-cache` in production. Vercel's edge has been known to strip headers from static files in some configs.
- **Offline page hydration** — `/offline` is `force-static` and uses an `<a href="/">` retry link, not `onClick`, so it works even when the React bundle hasn't loaded.
- **Out of scope (intentional)** — push notifications, background sync of My Breaks logs, share targets, file handlers. Add these only when there's a concrete user need.
