# Security Review — 2026-04-26

**Scope:** Security-only audit of the BreakIQ app (Next.js 15 App Router + Supabase). Functional QA was excluded by the user.
**Branch:** `claude/relaxed-shockley-bba70d` (worktree)
**Reviewer:** Claude (Opus 4.7), unattended autonomous run
**Mode:** Fix low-risk findings inline, document the rest

---

## TL;DR

Two findings need your attention **immediately, before merging this branch**:

1. **CRITICAL — Production Supabase service role key was hardcoded in `scripts/copy-prod-to-staging.mjs`.** Removed from the file in this branch, but the key is still in git history and is currently valid. **Rotate the key in Supabase now.**
2. **HIGH — Beta gate bypass via OAuth in `app/auth/callback/route.ts`.** Anyone could authenticate via Google/Discord without an invite code and end up signed in. Patched in this branch — please review before merging.

Other findings are MEDIUM/LOW and documented below with recommended fixes. Several already-known dev-mode auth bypasses (per CLAUDE.md item 7) are confirmed safe in production but were noted.

---

## Findings — by severity

### CRITICAL-1 · Production service role key committed in script (FIXED IN BRANCH; KEY ROTATION REQUIRED)

**File:** [scripts/copy-prod-to-staging.mjs:14-15](scripts/copy-prod-to-staging.mjs#L14-L15)

The script had the production Supabase **service role JWT** hardcoded as a fallback when `PROD_SERVICE_ROLE_KEY` env var is missing:

```js
const PROD_KEY = process.env.PROD_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1Y3V6aHRpaXRpYnN2cnllbnBpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzYxNzgyOSwiZXhwIjoyMDg5MTkzODI5fQ...';
```

Decoding the JWT confirms `role: service_role`, `iss: supabase`, `ref: zucuzhtiitibsvryenpi` (the production project), expiring **2036-01-13**.

**Impact:** Anyone with read access to this repo (or its git history, on any clone, on any backup, on any CI cache) gets full bypass-RLS access to the production database — `auth.users`, `profiles` (including `stripe_customer_id`), `waitlist` (including emails), `user_breaks`, everything. They can also write to any table.

**Fix in this branch:** Removed the fallback so the script now exits if `PROD_SERVICE_ROLE_KEY` env var is unset. ✅

**Action required from you (NOT done by Claude):**
1. **Rotate the service role key now.** Supabase dashboard → Settings → API → "Reset service_role key". Update Vercel env var `SUPABASE_SERVICE_ROLE_KEY` and any local `.env.local`.
2. Consider purging the key from git history with `git filter-repo` (or accept that the rotated old key is dead and move on — usually the simpler choice).
3. Audit Supabase access logs for any anomalous service-role activity since the key was first committed.

---

### HIGH-1 · Beta gate bypass: OAuth without invite creates signed-in account (FIXED IN BRANCH)

**File:** [app/auth/callback/route.ts:53-101](app/auth/callback/route.ts#L53-L101) (pre-fix)

The previous flow:
1. Exchange OAuth `code` for a session → user is now authenticated.
2. Upsert profile unconditionally.
3. **Only if `inviteCode` query param is present** validate it; if missing, skip silently.
4. Redirect to `/onboarding` or `/`.

**Impact:** A user can call `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://getbreakiq.com/auth/callback' }})` from any page (the Supabase URL + anon key are public via `NEXT_PUBLIC_*`). After Google's redirect, they hit `/auth/callback?code=xxx` with no `invite_code`. The session is created, profile upserted, and they're redirected into the app — fully past the beta waitlist.

The waitlist UI gate was effectively advisory.

**Fix in this branch:**
- After session exchange, check if profile is new.
- If new AND user has no `admin`/`contributor` role:
  - If no `invite_code` → sign out + redirect to `/waitlist?error=missing_invite`.
  - If invite_code missing/invalid/not-approved → sign out + redirect to `/waitlist?error=invalid_invite`.
- Returning users (existing profile) and role-holders skip the check, so this won't lock you out.

**Action required from you:** Test the signup flow before merging:
- New OAuth user with valid invite code → should land on `/onboarding`. ✅
- New OAuth user without invite → should land on `/waitlist?error=missing_invite`. ✅
- Returning user signing back in (existing profile) → should land on `/`. ✅
- Admin/contributor signing in for the first time → should NOT be locked out.

Update `app/waitlist/page.tsx` to render friendly messages for the `?error=missing_invite` and `?error=invalid_invite` query params. (Not done — needs design call.)

---

### HIGH-2 · Unauthenticated `/api/player-comps` burns paid CardHedger calls (FIXED IN BRANCH)

**File:** [app/api/player-comps/route.ts:11](app/api/player-comps/route.ts#L11) (pre-fix)

The route had no auth check. An unauthenticated visitor could:
- Enumerate `playerProductId` values (UUIDs but the table is small).
- For each, trigger up to 15 parallel CardHedger `getAllPrices` + 3 `getComps` calls. CardHedger is paid per call.
- Receive the full pricing response — which is the same data we restrict behind the consumer-paid `/api/pricing` cache.

**Impact:** (a) easy DoS-of-wallet attack against CardHedger spend; (b) leaks subscriber-only pricing data to anonymous users.

**Fix in this branch:** Added the same `createClient` + `getUser` + dev-bypass guard used by `/api/cardhedger/*` routes. ✅

**Note:** Even with auth, an authenticated free-tier user can still spam this endpoint and burn CH credits. The endpoint isn't usage-gated like `/api/analysis` and `/api/card-lookup` are. Add to backlog: rate-limit per user + optional usage gate.

---

### MEDIUM-1 · No Content-Security-Policy or Strict-Transport-Security header (NOT FIXED — needs careful design)

**File:** [next.config.ts:17-29](next.config.ts#L17-L29)

CLAUDE.md claims "Security headers (X-Frame-Options, **CSP**, etc.)" — but `next.config.ts` only sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. **CSP and HSTS are NOT set.**

**Impact:**
- No CSP → a stored-XSS-class bug (none currently found, but the surface is large) would have no second line of defense. Inline scripts, third-party sources, eval — all permitted by default.
- No HSTS → first-visit downgrade attacks are possible. Vercel auto-applies HSTS on `*.vercel.app`, but `getbreakiq.com` (custom domain) needs you to opt in explicitly.

**Why not auto-fixed:** Adding a wrong CSP can break the entire app (PostHog, Supabase, Stripe redirect, Next.js inline hydration scripts all need entries). Wants a deliberate design + smoke test.

**Recommended starting CSP** (start in `Content-Security-Policy-Report-Only` mode for a week first):

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://us.posthog.com https://us-assets.posthog.com https://js.stripe.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.supabase.co https://images.cardhedger.com https://*.fbcdn.net https://lh3.googleusercontent.com;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co https://us.posthog.com https://us-assets.posthog.com https://api.stripe.com;
frame-src https://js.stripe.com https://hooks.stripe.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self' https://checkout.stripe.com;
```

Drop `'unsafe-inline'` for scripts later via Next.js nonces (heavier lift; document but defer).

**Recommended HSTS:** `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. Only enable AFTER you confirm every subdomain serves HTTPS — once cached by browsers, you can't undo for 2 years.

---

### MEDIUM-2 · `pricing_cache` and other catalog tables grant `anon` SELECT via RLS

**File:** [supabase/migrations/20260420140000_enable_rls.sql](supabase/migrations/20260420140000_enable_rls.sql)

Policies attached:
- `sports`, `products`, `players`, `player_products`, `player_product_variants`, `pricing_cache`, `player_risk_flags` (active only) → `FOR SELECT USING (true)`.

Anyone with the public Supabase URL + anon key (visible in any client bundle) can `select * from pricing_cache` directly via the JS client and exfiltrate all EV calculations.

**Why this matters now:** Consumer routes are now auth-gated (since the private beta launch). The "public read" policies were designed for a public-pricing model that no longer exists. So the RLS is more permissive than the API contract is.

**Impact:** Competitors can scrape your pricing engine output without paying. No PII leak. Comparable risk to your CardHedger-data moat.

**Recommended fix:**
```sql
DROP POLICY "pricing_cache: public read" ON pricing_cache;
CREATE POLICY "pricing_cache: authenticated read"
  ON pricing_cache FOR SELECT TO authenticated USING (true);
-- repeat for sports, products, players, player_products, player_product_variants, player_risk_flags
```

API routes use `supabaseAdmin` (service role) so they're unaffected by this policy tightening. The only thing that breaks is direct `anon`-key reads, which is exactly what we want to block.

**Why not auto-fixed:** Migration changes need to be applied to prod via `supabase db push`, and the user prefers to control migration deploys directly.

---

### MEDIUM-3 · No rate limiting on any endpoint

CLAUDE.md acknowledges this is in the backlog. Current exposure inventory of endpoints that hit paid external APIs or send emails:

| Endpoint | Auth? | Hits | Risk |
|---|---|---|---|
| `/api/analysis` POST | yes + usage-gated | runBreakAnalysis → CH | low (gated) |
| `/api/card-lookup` POST | yes + usage-gated | Anthropic + PSA + CH | low (gated) |
| `/api/cardhedger/all-prices` POST | yes | CH `getAllPrices` | **medium — no per-user limit** |
| `/api/cardhedger/comps` POST | yes | CH `getComps` | **medium — no per-user limit** |
| `/api/cardhedger/search` POST | yes | CH `searchCards` | **medium — no per-user limit** |
| `/api/cardhedger/prices` POST | yes | CH `computeLiveEV` (cache-first) | low (24h cache hides most calls) |
| `/api/player-comps` GET | yes (this branch) | up to 18 CH calls per request | **medium — no per-user limit** |
| `/api/waitlist` POST | none (intentional) | Supabase insert | low — but enables email enumeration via 409 vs 200 |
| `/api/admin/waitlist/[id]/approve` | admin | Resend email | low (admin-only) |

**Recommendation:** Use Vercel KV + `@upstash/ratelimit` for a per-user/IP bucket. Token bucket of e.g. 30 CH calls/min per user is a defensible default. Document on the user model: free tier gets fewer tokens than Pro.

Email enumeration on `/api/waitlist`: respond with `{ ok: true }` regardless of whether the email already exists; have admin dashboard surface the duplicate. Today the API returns 409 `already_on_list`, which lets anyone confirm whether an email is on the waitlist.

---

### MEDIUM-4 · `/api/my-breaks` and `/api/onboarding` dev fallback writes as the first profile in the DB

**Files:** [app/api/my-breaks/route.ts:18-28](app/api/my-breaks/route.ts#L18-L28), [app/api/onboarding/route.ts:11-26](app/api/onboarding/route.ts#L11-L26)

Per CLAUDE.md item 7, this is intentional convenience. Both routes use `process.env.NODE_ENV === 'development'` as the guard. Vercel always sets `NODE_ENV=production` in deployed environments, so the fallback can't fire in prod — but it's a single env var away from full consumer-data-mass-write.

**Suggested hardening (not done):** Replace `NODE_ENV === 'development'` with a more deliberate signal that won't accidentally leak:

```ts
const isDev =
  process.env.NODE_ENV === 'development' &&
  process.env.DEV_AUTH_BYPASS === 'true';
```

Then set `DEV_AUTH_BYPASS=true` in your local `.env.local` only. This makes prod fail-safe even if `NODE_ENV` is misconfigured.

Defense-in-depth `.eq('user_id', userId)` filter was added to `app/api/my-breaks/[id]/route.ts` PUT in this branch ✅ — so that endpoint is now belt-and-suspenders even if RLS were ever broken.

---

### LOW-1 · Stripe subscription metadata is trusted blindly in webhook

**File:** [app/api/webhooks/stripe/route.ts:96-127](app/api/webhooks/stripe/route.ts#L96-L127)

Both `customer.subscription.updated` and `customer.subscription.deleted` read `subscription.metadata.userId` and update the matching `profiles` row. Stripe sets the metadata when we ask it to (in [lib/stripe.ts:35-38](lib/stripe.ts#L35-L38)) so the value is trusted-from-Stripe.

The risk surface: if a user can edit their own subscription metadata via the Customer Portal, they could overwrite `metadata.userId` and hijack another user's subscription. Stripe's Customer Portal does NOT expose metadata editing by default, so this is low risk.

**Recommended hardening:** match on `stripe_subscription_id` AND verify the resulting profile's `stripe_customer_id` matches the event's customer:

```ts
const sub = event.data.object;
const { data: profile } = await supabaseAdmin
  .from('profiles')
  .select('id, stripe_customer_id')
  .eq('stripe_subscription_id', sub.id)
  .single();
if (!profile || profile.stripe_customer_id !== resolveId(sub.customer)) break;
```

---

### LOW-2 · CRON_SECRET comparison is not constant-time

**Files:** [app/api/cron/refresh-pricing/route.ts:31](app/api/cron/refresh-pricing/route.ts#L31), [app/api/cron/refresh-ch-catalogs/route.ts:21](app/api/cron/refresh-ch-catalogs/route.ts#L21), [app/api/cron/update-scores/route.ts:18](app/api/cron/update-scores/route.ts#L18), [app/api/admin/refresh-product-pricing/route.ts:28](app/api/admin/refresh-product-pricing/route.ts#L28)

```ts
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) { ... }
```

Theoretical timing oracle. Practically not exploitable over the public Internet against Vercel infra (network jitter dwarfs the comparison time). Listed for completeness.

**Recommended:**
```ts
import { timingSafeEqual } from 'node:crypto';
const expected = `Bearer ${process.env.CRON_SECRET}`;
const ok = authHeader && authHeader.length === expected.length &&
  timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
if (!ok) return ...;
```

---

### LOW-3 · File upload endpoints have no MIME validation, size limit, or filename sanitization

**Files:** [app/api/admin/parse-checklist/route.ts:70-92](app/api/admin/parse-checklist/route.ts#L70-L92), [app/api/admin/parse-odds/route.ts:181-188](app/api/admin/parse-odds/route.ts#L181-L188), [app/api/admin/import-checklist/route.ts](app/api/admin/import-checklist/route.ts) (JSON), [app/api/card-lookup/route.ts:27-77](app/api/card-lookup/route.ts#L27-L77) (base64 image to Anthropic)

Admin-gated, so the realistic risk is an admin being tricked into uploading a malicious PDF. `pdf2json` is generally safe (pure JS, no DOM/canvas) but has had CVEs historically. Add a request size cap on the admin file routes:

```ts
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const buffer = Buffer.from(await file.arrayBuffer());
if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'File too large' }, { status: 413 });
```

Also validate the file extension matches one of `pdf|csv|xlsx|xls` rather than relying on `endsWith` checks scattered across handlers.

---

### LOW-4 · Mixed client/server export in `lib/supabase.ts`

**File:** [lib/supabase.ts:17-23](lib/supabase.ts#L17-L23)

`lib/supabase.ts` exports both `supabase` (anon, browser-safe) and `supabaseAdmin` (service role, server-only) from the same module. Next.js bundles by import, not by file, so a client component that imports `supabase` won't pull `supabaseAdmin` into the browser bundle — but the convention is fragile. A future refactor that imports `supabaseAdmin` from a `'use client'` file would silently bundle `process.env.SUPABASE_SERVICE_ROLE_KEY` (which would resolve to undefined client-side, breaking but not leaking).

**Recommendation:** split into `lib/supabase-browser.ts` (anon, browser-safe) and `lib/supabase-admin.ts` (service role, with `import 'server-only';` at the top to make accidental client imports a build error).

---

### LOW-5 · Stripe `createCheckoutSession` doesn't reuse existing `stripe_customer_id`

**File:** [lib/stripe.ts:28-39](lib/stripe.ts#L28-L39)

Always passes `customer_email` instead of `customer: stripe_customer_id`, so a returning user who upgrades plans after canceling will get a fresh Stripe Customer record. Data hygiene issue, not security — but worth tracking because it confuses Stripe's dashboard search.

---

### LOW-6 · No DELETE policy on `user_breaks`

**File:** [supabase/migrations/20260409120000_my_breaks.sql:53-63](supabase/migrations/20260409120000_my_breaks.sql#L53-L63)

`user_breaks` has SELECT/INSERT/UPDATE policies but no DELETE — so RLS blocks all deletes by `authenticated` users. We don't expose delete via the API, so this is fine; noted for completeness. If you ever expose a "delete this break" feature you'll need to add the policy.

---

## Confirmed-OK areas (positive findings)

- **No `dangerouslySetInnerHTML` anywhere** in `app/` or `components/`.
- **Email template HTML escapes** the `firstName` interpolation ([lib/email.ts:22](lib/email.ts#L22)). This branch additionally escapes the `to` field used in the body and URL-encodes `inviteCode` in the link. ✅
- **Stripe webhook signature verification** uses `req.text()` for raw body, validates signature with `constructWebhookEvent`, returns 400 on missing/bad signature. Correct.
- **Open-redirect protection in admin login** (`from` param validated to start with `/` and not `//`): [app/admin/login/actions.ts:12](app/admin/login/actions.ts#L12). Correct.
- **All admin server actions** (`app/admin/**/actions.ts`, `app/(consumer)/actions.ts`) call `requireRole(...)` at the top.
- **All `/api/admin/*` routes** call `checkRole('admin', 'contributor')` (verified file-by-file).
- **All cron endpoints** validate `Authorization: Bearer ${CRON_SECRET}`.
- **No `.env*` files tracked in git.** `.gitignore` covers `.env*`, `.env.local`, `.claude/settings.local.json`. ✅
- **`.mcp.json`** uses `${CARDHEDGER_API_KEY}` env interpolation — no plaintext keys.
- **No `console.log` of secrets** found across `app/` and `lib/`.
- **No `NEXT_PUBLIC_*` env var** carries a secret. Service role and CRON_SECRET only referenced in server-side files.
- **RLS enabled on all 13 tables** (per migration `20260420140000_enable_rls.sql` plus per-table migrations for `profiles`, `user_roles`, `user_breaks`).
- **`user_breaks` RLS policies** correctly scope SELECT/INSERT/UPDATE to `auth.uid() = user_id`.
- **`profiles` RLS** scopes SELECT to `auth.uid() = id`.
- **`waitlist` RLS** allows anon INSERT only — no anon SELECT/UPDATE/DELETE.

---

## What I want you to test before merging this branch

The fixes I applied are low-risk but do change two flows. Please verify in production-like staging:

1. **Auth callback (HIGH-2 fix)**
   - New OAuth signup with valid invite code → `/onboarding` ✅
   - New OAuth signup without invite code → bounced to `/waitlist?error=missing_invite`
   - Returning OAuth user (existing profile) → `/` (no invite needed, doesn't lock you out)
   - Existing admin/contributor signing in → `/` (allow-list bypass works)
   - Email signup with invite code → `/onboarding` after email verification
2. **`/api/player-comps` (HIGH-2 fix)** — `curl` it without auth, expect 401. Authenticated session, expect 200.
3. **`/api/my-breaks/[id]` PUT (MEDIUM-4 fix)** — abandon and complete flows still work for the owning user. Try abandoning a break that doesn't belong to you (e.g. via curl) and confirm 404.
4. **Email invite (LOW)** — approve a waitlist entry, confirm the email renders correctly with `{firstName}` and `{to}` after escaping.
5. **`copy-prod-to-staging.mjs` (CRITICAL-1 fix)** — running without `PROD_SERVICE_ROLE_KEY` should now exit immediately with the env var error.

---

## Things to add to docs/BACKLOG.md

- [ ] Rotate Supabase service role key (CRITICAL-1) **— do this first**
- [ ] Roll out CSP in report-only mode for 1 week, then enforce (MEDIUM-1)
- [ ] Add HSTS to `next.config.ts` once all subdomains are HTTPS (MEDIUM-1)
- [ ] Tighten RLS on catalog tables from `anon` to `authenticated` (MEDIUM-2)
- [ ] Vercel KV + Upstash rate-limit middleware on `/api/cardhedger/*`, `/api/player-comps`, `/api/waitlist` (MEDIUM-3)
- [ ] Make waitlist 409 indistinguishable from 200 to block email enumeration (MEDIUM-3)
- [ ] Replace `NODE_ENV === 'development'` dev bypass with `DEV_AUTH_BYPASS=true` flag (MEDIUM-4)
- [ ] Stripe webhook: cross-check `subscription_id ↔ customer_id` to harden against metadata tampering (LOW-1)
- [ ] Constant-time CRON_SECRET comparison (LOW-2)
- [ ] File upload size cap + MIME validation on admin upload endpoints (LOW-3)
- [ ] Split `lib/supabase.ts` into browser/admin modules with `import 'server-only'` (LOW-4)
- [ ] Reuse `stripe_customer_id` in `createCheckoutSession` for returning users (LOW-5)
- [ ] Update `app/waitlist/page.tsx` to render friendly error states for `?error=missing_invite` and `?error=invalid_invite` (HIGH-2 follow-up)

---

## Files modified in this branch

- `scripts/copy-prod-to-staging.mjs` — removed hardcoded prod service role key
- `app/api/player-comps/route.ts` — added auth check
- `app/auth/callback/route.ts` — invite required for new sign-ups, returning users + role-holders bypass
- `lib/email.ts` — escape `to` field in body, URL-encode `inviteCode` in link
- `app/api/my-breaks/[id]/route.ts` — defense-in-depth `.eq('user_id', ...)` on PUT

No production-data, schema, or dependency changes were made.
