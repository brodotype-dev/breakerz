import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Only wrap with Serwist in production. The withSerwist wrapper always adds
// a `webpack` config function even when `disable` is true, which makes Next
// 16 Turbopack bail in `next dev`. By skipping the wrapper entirely in dev,
// Turbopack stays clean and Serwist (which we want disabled in dev anyway)
// has no effect.
const isProd = process.env.NODE_ENV === "production";
const withSerwist = isProd
  ? withSerwistInit({
      swSrc: "app/sw.ts",
      swDest: "public/sw.js",
      cacheOnNavigation: true,
      reloadOnOnline: true,
    })
  : (config: NextConfig) => config;

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  // /privacy and /terms server components read the canonical legal copy
  // from docs/legal/*.md at request time. Without this, Next.js's output
  // tracing skips the docs/ tree (no module imports it) and the read fails
  // in production.
  outputFileTracingIncludes: {
    '/privacy': ['./docs/legal/privacy-policy.md'],
    '/terms':   ['./docs/legal/terms-and-conditions.md'],
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The service worker file must be served with a permissive scope and
        // never cached at the CDN — otherwise SW updates won't propagate.
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
