# Plan: Card Breakerz Beta — Users, Auth, Subscriptions & Access Control

**Created:** 2026-03-27
**Status:** Draft — Under Review

---

## Context

Approaching Beta launch in the next few weeks. The app currently has zero user identity infrastructure: the consumer side is fully open, the admin side is protected by a shared password cookie that isn't even enforced by middleware. This cycle delivers the full user layer: Supabase Auth, role-based access, Stripe subscriptions with a free trial, a waitlist + invite system, activity logging, and Sentry error tracking.

**Decisions locked in:**
- Beta access: Waitlist → manual approve → invite code → signup
- Payments: Stripe from day one (hosted Checkout + webhooks); Stripe account already exists
- Contributors: Broader editor role — Breakerz Bets + player flags/risk notes (no product/import)
- Bug tracking: Sentry (account exists, needs project configured)
- Email: Resend (account exists)
- Trial length: 31 days
- Paid tiers: TBD — starting with one paid tier (Pro) likely; Premium deferred until feature set is defined

---

## Current State (What Exists Today)

- Admin login: password-only form, sets `admin_session` cookie — **but no middleware enforces it**. Admin routes are currently unprotected.
- Consumer side: fully open, no auth of any kind
- Database: zero user/auth tables. No `profiles`, `roles`, `subscriptions`, `waitlist`, `activity_log`
- Supabase Auth: configured in the project but not used — all DB access uses service role key directly
- API routes `/api/admin/*`: no auth check whatsoever

---

## Personas

### Beta target: Consumer
Someone buying a break slot. They want to know: what players are in this break, what's each slot worth, is this a good deal, what's the risk on key players.

**What they see:**
- Home page — active products
- Break page — player slots, team slots, social currency badges (B-scores, risk flags, HV, icons), Breakerz Sayz analysis
- Live pricing refresh — fresh CardHedger data on demand

**What they do NOT see:**
- Breaker Comparison tool — that's a separate product for people *running* breaks, not buying them. Hide entirely from consumers.
- Anything in `/admin/*`

### Future persona: Breaker (not this cycle)
Someone running a break and pricing their slots. The Breaker Comparison tool lives here. Separate product offering — defer.

### Internal roles
| Role | Access |
|---|---|
| `admin` | Full `/admin/*` — products, import, odds, Breakerz Bets, player flags, user management, waitlist |
| `contributor` | `/admin/breakiq-betz` + player flags/risk notes only |

---

## Subscription Tiers (Consumer-facing only)

Trial length: **31 days** at Pro level, auto-downgrades to Free.

| Tier | What they get | Notes |
|---|---|---|
| `free` | Browse products, break pages with cached pricing (up to 24h old), all social currency badges | Read-only |
| `pro` | Everything in Free + live pricing refresh + Breakerz Sayz AI analysis + Card Lookup | Paid via Stripe — price TBD |
| Trial | Full Pro access for 31 days | Auto-downgrades to free on expiry |

**Card Lookup (`/card-lookup`):** Pro-only. Gate with a subscription check in Phase 4/5 — free-tier users hitting the page should see an upgrade CTA. Good conversion hook.

**Breaker Comparison tool:** Hidden from all consumer-facing routes. Not part of this product offering.

> **Prerequisite before Phase 4:** Set Pro price point, create Stripe product + price, get PRICE_ID.

---

## Implementation Phases

### Phase 1 — Auth Foundation
Replace the shared-password admin login with Supabase Auth. Enforce middleware.

**New DB tables:**
```sql
-- profiles: extends auth.users
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- user_roles: 'admin' | 'contributor'
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'contributor')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
```

**New files:**
- `middleware.ts` — protect `/admin/*` (require auth + admin/contributor role) and `/api/admin/*`; redirect to `/admin/login` if not authenticated
- `lib/auth.ts` — `getCurrentUser()`, `requireRole(role)`, `getUserRole()`
- `lib/supabase-server.ts` — cookie-aware `createServerClient` from `@supabase/ssr` for middleware + server components
- Rewrite `app/admin/login/page.tsx` — Supabase Auth email+password (remove `ADMIN_PASSWORD` env var dependency)
- Update `app/admin/AdminNav.tsx` — role-conditional nav (contributor sees Breakerz Bets + players only)

**Package to add:** `@supabase/ssr`

---

### Phase 2 — Waitlist + Invite System

**New DB table:**
```sql
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  use_case TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'converted')),
  invite_code TEXT UNIQUE,
  invite_sent_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**New pages/routes:**
- `app/waitlist/page.tsx` — public signup form (name, email, "what are you breaking?")
- `app/api/waitlist/route.ts` — POST: insert into waitlist table
- `app/admin/waitlist/page.tsx` — admin view: pending/approved/rejected tabs, approve button, notes
- `app/api/admin/waitlist/[id]/approve/route.ts` — generate invite code, send invite email
- `app/auth/accept-invite/page.tsx` — invite landing (code pre-filled), routes to signup

**Email provider:** Resend (simple, developer-friendly, excellent Next.js support)

**Home page:** Add waitlist CTA on `app/page.tsx` for logged-out visitors.

---

### Phase 3 — Consumer Auth + Signup

**New pages:**
- `app/auth/login/page.tsx` — consumer login (email + password via Supabase Auth)
- `app/auth/signup/page.tsx` — signup form; validates invite code against waitlist table before creating account
- `app/auth/callback/route.ts` — Supabase Auth email confirmation callback

**On successful signup:**
1. Insert into `profiles`
2. Insert into `subscriptions` with `plan_type: 'pro'`, `status: 'trial'`, `trial_ends_at: now() + 14 days`
3. Mark waitlist entry as `converted`

**Shared layout:** Update `app/layout.tsx` with a minimal header showing login/signup CTA or user avatar + logout.

---

### Phase 4 — Stripe Subscriptions

**New DB table:**
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('free', 'pro', 'premium')),
  status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'cancelled', 'expired', 'past_due')),
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
```

**New routes:**
- `app/api/stripe/checkout/route.ts` — create Stripe Checkout session, return hosted URL
- `app/api/stripe/portal/route.ts` — create Stripe Customer Portal session (manage/cancel subscription)
- `app/api/stripe/webhook/route.ts` — handle `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` → update subscriptions table

**New lib:**
- `lib/subscriptions.ts` — `getUserTier(userId)`, `canUseFeature(userId, feature)`, `checkUsageLimit(userId, endpoint)`

**Upgrade CTA:**
- Break page "Refresh pricing" button → shows "Upgrade to Pro →" if free tier
- Analysis page → same gate
- Card Lookup page (`/card-lookup`) → show upgrade wall if free tier

> **Prerequisite:** Create Stripe products + prices in Stripe dashboard first. Share `STRIPE_PRO_PRICE_ID` and `STRIPE_PREMIUM_PRICE_ID` before building.

---

### Phase 5 — API Rate Limiting + Usage Tracking

**New DB table:**
```sql
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,  -- 'pricing_refresh' | 'analysis'
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  called_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_api_usage_user_month ON api_usage(user_id, endpoint, called_at);
```

**Modified API routes:**
- `app/api/pricing/route.ts` (POST) — get user from session → check tier → count usage this month → if over limit return 402 with upgrade message
- `app/api/analysis/route.ts` (POST) — same pattern

**Core helper (in `lib/subscriptions.ts`):**
```typescript
async function checkAndTrackUsage(
  userId: string,
  endpoint: 'pricing_refresh' | 'analysis'
): Promise<{ allowed: boolean; remaining: number | 'unlimited' }>
```

---

### Phase 6 — Activity Logging

**New DB table:**
```sql
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,  -- 'product.create' | 'checklist.import' | 'bets.save' | 'pricing.refresh' | ...
  resource_type TEXT,    -- 'product' | 'player' | 'player_product' | 'pricing'
  resource_id UUID,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_log_action ON activity_log(action, created_at DESC);
```

**Instrumented actions (admin):**
- Product create/update
- Checklist import
- Odds upload
- Breakerz Bets save
- Player flag create/clear

**Instrumented actions (consumer):**
- Pricing refresh
- Analysis run
- Invite accepted
- Subscription changed

**New admin page:**
- `app/admin/activity/page.tsx` — paginated log, filter by user/action/date range

---

### Phase 7 — Sentry Integration

**Install:** `@sentry/nextjs`

**New config files:**
- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `next.config.ts` — wrap with `withSentryConfig`

**User context:** In `middleware.ts`, call `Sentry.setUser({ id, email })` when session exists.

**Env vars:** `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`

---

### Phase 8 — Admin User Management UI

**New pages:**
- `app/admin/users/page.tsx` — list all users: name, email, tier, trial status, usage this month, last active
- `app/admin/users/[id]/page.tsx` — user detail: subscription history, activity log, manual tier override button

---

## New Env Vars Required

```
# Stripe
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID
STRIPE_PREMIUM_PRICE_ID

# Email
RESEND_API_KEY
FROM_EMAIL

# Sentry
SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN
```

---

## Key Files to Modify

| File | Change |
|---|---|
| `middleware.ts` (new) | Route protection for `/admin/*` and `/api/admin/*` |
| `lib/supabase.ts` | No change — keep existing; add `lib/supabase-server.ts` alongside |
| `lib/auth.ts` (new) | `getCurrentUser`, `requireRole`, `getUserRole` |
| `lib/subscriptions.ts` (new) | Tier checks, usage counting, Stripe helpers |
| `app/admin/login/page.tsx` | Rewrite: Supabase Auth instead of cookie password |
| `app/admin/AdminNav.tsx` | Role-conditional nav items |
| `app/api/pricing/route.ts` | Add tier + usage check on POST |
| `app/api/analysis/route.ts` | Add tier + usage check on POST |
| `app/page.tsx` | Add waitlist CTA for logged-out visitors |

---

## Verification Checklist

- [ ] Navigate to `/admin/products` logged out → redirected to `/admin/login`
- [ ] Log in as contributor → Breakerz Bets + players visible; Products/Import/Odds/Card Lookup hidden
- [ ] Waitlist form → entry in `/admin/waitlist` → approve → invite email → click link → signup with code → account with Pro trial
- [ ] Set `trial_ends_at` to past in DB → user sees Free tier limits on pricing refresh
- [ ] Click Upgrade → Stripe Checkout → complete → subscription row updated → webhook logged
- [ ] Pro user hits 10 pricing refreshes → 11th returns 402 + upgrade prompt
- [ ] Import a checklist → entry appears in `/admin/activity`
- [ ] Trigger a server error → confirm in Sentry with user context

---

## Open Questions Before Starting

1. **Tier feature breakdown:** What specifically does Pro unlock vs. Free? (See discussion below)
2. **Pro price point:** Set after features are defined
3. **Sentry project:** Create project in existing Sentry account → get DSN before Phase 7
4. **Stripe products:** Create Pro product + price in Stripe dashboard before Phase 4 → get PRICE_ID

## Resolved
- ✅ Trial length: 31 days
- ✅ Email: Resend (account exists)
- ✅ Stripe: Account exists
- ✅ Sentry: Account exists (project setup needed)
- ✅ Premium tier: Deferred until Pro is validated
