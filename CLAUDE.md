# BreakIQ — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

**Docs (read on demand, not automatically):**
- [CHANGELOG.md](./CHANGELOG.md) — full feature history
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritized work queue
- [docs/pricing-architecture.md](./docs/pricing-architecture.md) — pricing pipeline (cache-read consumer + cron fan-out writer)
- [docs/cardhedger-matching.md](./docs/cardhedger-matching.md) — CH matching architecture (v1 legacy notes)
- [docs/catalog-preload-architecture.md](./docs/catalog-preload-architecture.md) — CH matching v2 (catalog pre-load + tiered local matcher)
- [docs/cardhedger-questions.md](./docs/cardhedger-questions.md) — running list of questions for the CH team
- [docs/beta-launch-checklist.md](./docs/beta-launch-checklist.md) — pre-launch todo list
- [docs/cost-analysis.md](./docs/cost-analysis.md) — unit economics, breakeven, service costs
- [docs/manufacturer-rules/bowman.md](./docs/manufacturer-rules/bowman.md) — Bowman/Topps prefix names, CH naming conventions, match rate history
- [docs/breaker-identity-prd.md](./docs/breaker-identity-prd.md) — Breaker role + crowdsourced case pricing PRD (backlogged, post-public-beta)

Update CHANGELOG.md at the end of every session with what changed and why.

---

## Current State

Live at [getbreakiq.com](https://getbreakiq.com). Private beta — consumer routes require auth; unauthenticated visitors redirected to `/waitlist`.

**Admin pipeline** ✅ Product creation → checklist import (Topps PDF/CSV, Bowman XLSX) → CardHedger matching (Claude Haiku, ~76–90% auto-match) → odds import → readiness dashboard → BreakIQ Bets debrief

**Auth + Waitlist** ✅ Supabase Auth (email+password for admins, Google/Discord/email OAuth for consumers). Public waitlist → admin approval → Resend invite email → `/auth/signup?code=` → OAuth or email signup → `/auth/callback` validates invite, creates profile, marks converted. Test invite code: `beta-test-2026`.

**Social Currency** ✅ B-score (breakerz_score), Icon tier (is_icon), Risk Flags (player_risk_flags), HV (is_high_volatility), consumer badges (★ ↑↓ ⚡ ⚑)

**Slab Analysis** ✅ Upload cert image or enter cert # directly → Claude parses → PSA API verifies (grade + pop data) → CardHedger prices + comps → max bid calculator

**My Breaks** ✅ Consumer break tracking: log pre-break (with live analysis snapshot) or post-break. Rate outcome (Win/Mediocre/Bust), select platform, analysis feedback (helpful/not helpful). Stats row + time/platform/outcome filters. CSV export + import. Chase/hit card tracking designed, deferred to Phase 2.

**Pricing Pipeline** ✅ Consumer `/api/pricing` is a pure cache read — no external calls, no 504s. Writes happen in two places, both hitting `/api/admin/refresh-product-pricing` (300s budget per invocation): (1) admin on-demand via "Refresh Pricing" button on product page; (2) overnight cron, 5 staggered firings between 4–6:30 AM UTC. Each firing picks the stalest products (latest `pricing_cache.fetched_at` null or > 22h old, oldest first), throttles to 3 concurrent CH-fetching workers, and exits within 270s. Workers it can't finish get picked up by the next firing. Concurrency=3 because 16-way parallel CH starved bandwidth and blew worker timeouts on 2026-04-27. Middleware lets `Authorization: Bearer ${CRON_SECRET}` requests through `/api/admin/*` — without that bypass the orchestrator's fan-out POSTs get 307'd to `/admin/login`. Cron orchestrator builds fan-out URL from `req.url` (not `NEXT_PUBLIC_APP_URL`) to avoid the apex→www 301 that downgrades POST to GET. If cache is empty, consumer page shows a passive "pricing not yet available" banner. See `docs/pricing-architecture.md`. Requires Vercel Pro.

**Onboarding** ✅ 3-step wizard at `/onboarding`: age gate (hard block under 18), about you (experience level, collecting interests including TCGs, eras, platform, monthly spend), quick hits (attribution, best pull). OAuth callback redirects new users to onboarding; returning users skip it.

**Subscriptions** ✅ Stripe integration — Hobby ($9.99/mo, 10 analyses), Pro ($24.99/mo, unlimited). 3 free lifetime analyses as trial. Usage gates on `/api/analysis`, `/api/card-lookup`, `/api/my-breaks`. Promo codes enabled. Webhook handles checkout, invoice, subscription lifecycle.

**Security** ✅ Pre-beta audit (2026-04-10): auth guards on all admin server actions + API routes, consumer API auth, security headers (X-Frame-Options, CSP, etc.), XSS fix in email, open redirect fix, legacy auth backdoor deleted.

**Analytics** ✅ PostHog installed — server-side user identification + `user_signed_up` event in auth callback.

**CH Matching v2** ✅ (2026-04-21) Catalog pre-load into `ch_set_cache` + tiered local matcher. Descriptor-based knowledge (`lib/card-knowledge/` — data, not classes). Tier ladder: exact-variant → synonym → number-only → card-code → claude(in-set candidates) → no-match. Daily cron refreshes catalogs for active products at 3 AM UTC. On-demand "Refresh CH Catalog" button on product page. `match_tier` persisted on variants for debugging. `ch_set_name` on products stores exact CH canonical name — use "Find on CH" widget in product form. See `docs/catalog-preload-architecture.md`.

**Security** ✅ RLS enabled on all 11 tables. Auth guards on all admin actions and API routes. Security headers. See security section in BACKLOG for remaining items (rate limiting, file validation).

**After-Market Case Pricing** ✅ (2026-04-23) Admin can set `hobby_am_case_cost` / `bd_am_case_cost` separate from MSRP. Consumer break page defaults to AM price when available. `DashboardConfig` shows MSRP · Market reference row. Phase 2 (Breaker identity + crowdsourced pricing) backlogged — see `docs/breaker-identity-prd.md`.

**Next up:** Phase 5 C-score (blocked on Kyle), My Breaks Phase 2 (chase/hit card tracking), Sentry error tracking, rate limiting, 2025-26 Bowman Basketball re-match (CPA cards being added by CH this week)

---

## Stack

Next.js 15 App Router · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres + Auth) · Stripe · CardHedger API · PSA API · Claude Haiku · Resend · PostHog · Vercel

---

## Deploy

```bash
cd ~/Documents/GitHub/breakerz
git push origin main
vercel --prod --yes
```

Production: `breakerz.vercel.app` | Staging branch: `staging` | Repo: `github.com/brodotype-dev/breakerz`

---

## Environments

| | Production | Preview/Development |
|---|---|---|
| Supabase | `zucuzhtiitibsvryenpi` | `isqxqsznbozlipjvttha` (staging) |
| URL | `breakerz.vercel.app` | staging preview URLs |

**Env vars** (set in Vercel, use `.env.local` for local dev):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CARDHEDGER_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, `PSA_API_KEY`, `CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HOBBY`, `STRIPE_PRICE_PRO`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`

Supabase Vercel integration injects both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` — `lib/supabase.ts` uses `??` fallbacks for both. Don't remove them.

---

## Known Gotchas

1. **PDF parsing** — use `pdf2json` not `pdf-parse` (canvas crash on Vercel). Lazy `require()` inside handler + `export const dynamic = 'force-dynamic'`. See `app/api/admin/parse-odds/route.ts`.
2. **Resend lazy init** — `new Resend(key)` must be inside a function, not module-level, or builds fail when `RESEND_API_KEY` is absent.
3. **hobbyEVPerBox not cached** — pricing_cache stores ev_low/mid/high but not odds-weighted EV. Cached GET falls back to evMid. Schema change needed to fix (in backlog).
4. **Supabase migrations** — CLI linked to production. To push: `supabase db push`. To repair a failed migration: `supabase migration repair --status reverted <timestamp>`. Files in `supabase/migrations/`.
5. **Stripe webhook** — raw body required for signature verification. Route uses `request.text()` + `export const dynamic = 'force-dynamic'`. Webhook endpoint: `/api/webhooks/stripe`.
6. **Stripe SDK types** — v22+ uses `2026-03-25.dahlia` API version. Webhook event data objects cast to local interfaces to avoid SDK type drift.
7. **Dev mode auth bypass** — consumer API routes (`my-breaks`, `onboarding`) fall back to first profile in dev mode when no auth session. Never deploy with `NODE_ENV=development`.
8. **Supabase email rate limit** — free tier limits ~4 confirmation emails/hour. Hits during testing but not an issue in production.

---

## Key Files

```
middleware.ts                    — auth guard: /admin/*, /api/admin/*, /break/*, /analysis/*
lib/supabase.ts                  — admin client (service role)
lib/supabase-server.ts           — cookie-aware server client (@supabase/ssr)
lib/auth.ts                      — getCurrentUser(), requireRole()
lib/email.ts                     — sendInviteEmail() via Resend
lib/engine.ts                    — pricing engine: computeSlotPricing, computeEffectiveScore
lib/cardhedger.ts                — CardHedger API + Claude matching (claudeCardMatchFromCandidates for v2)
lib/cardhedger-catalog.ts        — catalog lifecycle: findCanonicalSet, refreshSetCatalog, loadCatalogIndex
lib/psa.ts                       — PSA public API: getCertByNumber() (bearer token auth)
lib/card-knowledge/              — descriptor-based manufacturer knowledge (bowman, panini, default, match, types)
lib/card-knowledge/match.ts      — generic tier-ladder matcher (exact-variant → synonym → number-only → card-code)
lib/checklist-parser.ts          — PDF/CSV/XLSX checklist parsers
app/waitlist/                    — public signup
app/auth/signup/                 — consumer OAuth entry (invite code validation)
app/auth/callback/route.ts       — OAuth callback: exchange code, validate invite, create profile
app/admin/login/                 — admin auth
app/admin/waitlist/              — approve users, send invites
app/admin/products/[id]/         — product dashboard (matching, odds, BreakIQ Bets, Pricing Audit)
app/(consumer)/                  — auth-gated consumer route group (layout, nav, actions)
app/(consumer)/profile/          — beta user profile page (name, DOB/age, hobby prefs)
app/(consumer)/card-lookup/      — Slab Analysis tool (auth-gated)
app/break/[slug]/                — consumer break analysis (auth required)
app/analysis/                    — BreakIQ Sayz deal checker (auth required)
app/api/admin/pricing-breakdown/ — per-player pricing inputs for Pricing Audit Panel
app/api/pricing/                 — consumer pricing read (GET/POST, pure cache read, no CH calls)
lib/pricing-refresh.ts           — shared refresh pipeline: CH batch-fetch, aggregate EV, upsert pricing_cache (throws on error)
app/api/admin/refresh-product-pricing/ — per-product worker (maxDuration=300); called by admin button AND cron fan-out
app/admin/products/[id]/RefreshPricingButton.tsx — admin on-demand "Refresh Pricing" button (Quick Actions)
app/api/cron/refresh-pricing/    — nightly cron (4 AM UTC); fans out one HTTP call per active product in parallel, each on its own Vercel invocation
app/api/cron/refresh-ch-catalogs/— daily cron (3 AM UTC) to refresh ch_set_cache for active products
app/api/admin/refresh-ch-catalog/— admin on-demand catalog refresh for a single product
app/admin/products/[id]/RefreshCatalogButton.tsx — UI button for on-demand catalog refresh
app/api/my-breaks/               — GET (list), POST (create with analysis snapshot)
app/api/my-breaks/[id]/          — PUT (complete or abandon a pending break)
app/(consumer)/my-breaks/        — consumer break tracking page (list, new break, log previous)
lib/analysis.ts                  — shared runBreakAnalysis() used by BreakIQ Sayz + My Breaks
lib/stripe.ts                    — Stripe client, checkout sessions, customer portal
lib/usage.ts                     — checkAndIncrementUsage() with plan-aware limits
app/api/checkout/                — POST (Stripe checkout session), GET (customer portal)
app/api/webhooks/stripe/         — Stripe webhook handler (checkout, invoice, subscription events)
app/api/onboarding/              — PUT (save onboarding fields, set onboarding_completed_at)
app/(consumer)/onboarding/       — 3-step onboarding wizard (age, preferences, attribution)
app/(consumer)/subscribe/        — plan selection page (Hobby/Pro + free trial)
app/api/profile/                 — GET + PUT consumer profile (RLS-scoped)
scripts/copy-prod-to-staging.mjs — copy product data from prod to staging Supabase
```

---

## Database Schema

```
sports, products, players, player_products, player_product_variants
pricing_cache         — 24h TTL, ev_low/mid/high per player_product
player_risk_flags     — soft-delete (cleared_at); injury/suspension/legal/trade/retirement
user_breaks           — consumer break log: analysis snapshot, platform, outcome, feedback, status lifecycle
products              — ch_set_name TEXT: exact CardHedger canonical set name for set-catalog matching
products              — hobby_am_case_cost / bd_am_case_cost NUMERIC: admin-set after-market case price (nullable; break page prefers over MSRP when set)
ch_set_cache          — pre-loaded CH set catalogs, keyed by (ch_set_name, card_id); drives v2 local matching
ch_set_refresh_log    — per-refresh telemetry (pages, cards, duration, errors)
player_product_variants.match_tier — which tier matched (exact-variant | synonym | number-only | card-code | claude | no-match)
profiles              — mirrors auth.users + onboarding fields + subscription (stripe_customer_id, subscription_plan, analyses_used)
user_roles            — (user_id, role): admin | contributor
waitlist              — status: pending → approved → converted | rejected
```

---

## Pricing Model

```
effectiveScore = clamp(buzz_score + breakerz_score, -0.9, 1.0)  [0 if is_icon]
hobbyWeight    = hobbyEVPerBox × (1 + effectiveScore)
slotCost       = breakCost × (hobbyWeight / Σ hobbyWeights)
hobbyEVPerBox  = Σ(variantEV × 1/hobby_odds)  [falls back to evMid if no odds]
```

---

## MCP Servers

- **Supabase** — `.mcp.json` at repo root, project ref `zucuzhtiitibsvryenpi`. Query tables directly.
- **Figma** — `~/.claude/mcp.json` global. Share a Figma URL to read design specs.
