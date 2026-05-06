# BreakIQ — Production Config Audit for Legal Review (v4)

**Date:** 2026-05-06
**Operator:** Mervin LLC d/b/a BreakIQ
**Production:** `getbreakiq.com` · Supabase project `zucuzhtiitibsvryenpi` · Vercel project `breakerz`

> Snapshot of the live production configuration as of the date above, prepared in response to v4 review questions. All claims here are verified against either source code, deployed infra, or live API config — not against memory of intent. Sections marked **NEEDS USER VERIFICATION** require an action by Brody (Dashboard log-in) that source code can't tell us.

---

## Quick-answer table

| # | Question | Answer | Source |
|---|---|---|---|
| 1 | Supabase tier (drives §10.2 backup retention) | **NEEDS USER VERIFICATION** | Supabase Dashboard → Project Settings → Billing |
| 2 | PostHog session replay | **OFF** — turned off 2026-05-06 04:14 UTC; no §6.3 disclosure required | PostHog API: `session_recording_opt_in: false` |
| 3a | Card Lookup — Claude prompt does NOT request face geometry | **Y** | `app/api/card-lookup/route.ts:55-72` |
| 3b | Card Lookup — uploaded images deleted from any temp storage | **Y** | No `Storage.upload()`, no `fs.write`, no temp file path in code |
| 3c | Card Lookup — no face-image search index/template DB | **Y** | No Storage usage; no biometric tables in schema |
| 4 | Anthropic API agreement (Commercial Terms — no training) | **NEEDS USER VERIFICATION** | console.anthropic.com → Workspaces |
| 5 | Discord OAuth scopes — match v4 (`identify` + `guilds.members.read`)? | **N — actual scopes are `identify email`** | `app/auth/signup/SignupForm.tsx:42-47` (no `scopes` arg → Supabase defaults) |
| 6 | Google OAuth scopes — match v4 (basic profile)? | **Y — actual scopes are `openid email profile`** | Same file, no `scopes` arg → Supabase defaults |
| 7 | Production subprocessors not listed in v4 §5? | **None in code.** Vercel Web Analytics / Speed Insights need user verification | `package.json` + `app/layout.tsx` |
| 8 | Stripe checkout — auto-renewal disclosure adjacent to confirm | **Y, with verification suggested** | `lib/stripe.ts:28-39` — Stripe-hosted Checkout |
| 9 | Post-purchase confirmation email with auto-renewal terms | **Stripe receipt covers it** (default-on); no custom Resend send | `app/api/webhooks/stripe/route.ts` (no email send on `checkout.session.completed`) |
| 10 | Free tier auto-conversion to paid | **Confirmed — none** | `lib/usage.ts:67-78` |

---

## 1. Supabase tier — NEEDS USER VERIFICATION

The Supabase MCP server I used to verify the rest of this doc does not expose project-tier metadata. Supabase tier determines:

- §10.2 backup retention disclosure (Free / Pro / Team / Enterprise = 7 / 7 / 14 / 30 days)
- Point-in-time recovery availability
- HIPAA/SOC2 contractual attachments

**Action:** Brody to check Supabase Dashboard → Project Settings → Billing → Plan.

---

## 2. PostHog session replay — **OFF (confirmed 2026-05-06 04:14 UTC)**

Initial audit on 2026-05-06 found `session_recording_opt_in: true`. Brody disabled it via PostHog UI immediately afterward. Re-pulled live config to confirm — current state:

```yaml
session_recording_opt_in: false             # OFF
session_recording_retention_period: 30d     # vestigial — no recordings being created
capture_console_log_opt_in: true            # vestigial — only relevant inside session replays
capture_performance_opt_in: true            # vestigial — only relevant inside session replays
autocapture_web_vitals_opt_in: true         # independent feature, fine to keep
heatmaps_opt_in: true                       # independent feature, fine to keep
```

**§6.3 implication:** No session-replay disclosure required. The privacy policy can disclose PostHog as a product-analytics subprocessor only (events + pseudonymous user identification), without expanded session-replay language.

The `capture_console_log_opt_in` and `capture_performance_opt_in` flags remain `true` in PostHog config, but per PostHog's data model both are gated on session recording being on — with recordings off, no console logs or network performance data are being captured. Brody can leave the toggles in their current state or also flip them off for cleanliness; either way has the same data-flow result.

**Pre-existing recordings:** any session recordings captured before 2026-05-06 04:14 UTC remain in PostHog cold storage for the 30-day retention window. Consider purging via PostHog → Recordings → Delete to remove the historical artifact, or let them age out by 2026-06-05.

---

## 3. Card Lookup — biometric posture confirmed (a/b/c all Y)

### 3a. Claude prompt does NOT request face geometry — **Y**

Verified prompt at `app/api/card-lookup/route.ts:55-72`:

> "Extract sports card details from this auction or marketplace listing screenshot. Return JSON only — no explanation, no markdown: { playerName, setName, year, cardNumber, variant, gradingCompany, grade, certNumber }"

Extracts text fields only — player name, set name, year, card number, variant, grading company, grade, cert number. No biometric extraction, no face-feature description, no embedding generation, no spatial/geometric data of human features.

### 3b. Uploaded images deleted from any temp storage after the request completes — **Y**

- No Supabase Storage upload anywhere — `grep "Storage.upload\|.upload("` returns no user-facing image upload code path.
- No `fs.writeFile` to disk for user uploads.
- The image arrives as a **base64 string in the request body**, is forwarded to Anthropic's Messages API, and is GC'd when the Vercel Function invocation ends.
- Anthropic's Commercial Terms govern their copy on their side: 30-day retention by default, no training on inputs/outputs.

### 3c. No face-image search index / template DB exists — **Y**

- No Supabase Storage buckets configured for face images (no `Storage` SDK usage in code at all).
- No tables named `face_*`, `biometric_*`, `image_embeddings`, or similar in the schema (verified against the migration history under `supabase/migrations/`).

---

## 4. Anthropic API agreement — NEEDS USER VERIFICATION

Source code can't tell us which agreement is in effect for the API key in `process.env.ANTHROPIC_API_KEY`. The default for new accounts is the **Commercial Terms of Service** (no training on inputs or outputs, 30-day data retention by default, customer can request 0-day retention via support). That matches the recommendation.

**Action:** Brody to confirm at console.anthropic.com → Workspaces → his commercial agreement. If on Commercial Terms, no further action. If on Consumer Terms, switch — Consumer Terms allow training and aren't appropriate for production user data.

---

## 5. Discord OAuth scopes — `identify email` (NOT `guilds.members.read`)

Code at `app/auth/signup/SignupForm.tsx:42-47`:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'discord',
  options: { redirectTo },
});
```

No `scopes` parameter passed. Supabase's default scopes for Discord are **`identify email`**:

- `identify` — Discord user ID, display name, avatar.
- `email` — populates `auth.users.email`.

We do **not** request `guilds.members.read`. There is no code path that calls Discord's Guilds API; the only Discord HTTP traffic is to `discord.com/api/interactions` (bot HTTP-Interactions endpoint, separate from OAuth).

**Action:** v4 §5 needs to update Discord scope listing from "identify + guilds.members.read" → "identify, email".

**Verify:** Supabase Dashboard → Authentication → Providers → Discord → "Scopes" field. If empty, you're on defaults (matches above). If populated, those scopes override the defaults.

---

## 6. Google OAuth scopes — `openid email profile` (matches v4 "basic profile")

Same code pattern as Discord — no `scopes` parameter passed. Supabase's default scopes for Google are `openid email profile`. The auth callback (`app/auth/callback/route.ts`) reads only `user.email`, `user.user_metadata.full_name` / `name`, and `user.user_metadata.avatar_url` — exactly the basic-profile fields v4 §5 describes.

No Calendar / Gmail / Drive / Contacts / People-API scopes requested.

**Verify:** Supabase Dashboard → Authentication → Providers → Google → "Scopes" field empty = defaults.

---

## 7. Subprocessors NOT in v4 §5 — none in code; one to verify in Vercel

Searched `package.json` and source for: Cloudflare, Sentry, Mailgun, SendGrid, Datadog, LogRocket, FullStory, Hotjar, Meta Pixel, Google Analytics, Mixpanel. **None present.**

### Notes on edge cases

- **Google Fonts** (Inter + JetBrains Mono) — loaded via Next.js `next/font/google`. Self-hosted at build time. **Not a runtime subprocessor.** Brody's browser does not contact Google to fetch fonts.
- **Vercel Web Analytics / Speed Insights** — NOT installed in package.json (no `@vercel/analytics`, no `@vercel/speed-insights`, no `<Analytics />` in `app/layout.tsx`). However, both can be enabled at the Vercel project level without code changes — Vercel injects the script automatically when the toggle is on.

**Action:** Brody to verify Vercel Dashboard → Project `breakerz` → Analytics tab. If "Web Analytics" or "Speed Insights" is enabled there, add to v4 §5 (data shared: pseudonymous visitor metrics, vitals, route paths). If both off, no change needed.

### Full v4 §5 list confirmed present in code

Supabase, Stripe, Anthropic, CardHedger, PSA, Resend, PostHog, Discord, Google, Vercel — all verified to have actual call sites.

---

## 8. Stripe checkout auto-renewal disclosure — Y with verification

Code at `lib/stripe.ts:28-39`:

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer_email: email,
  line_items: [{ price: priceId, quantity: 1 }],
  allow_promotion_codes: true,
  success_url: `${baseUrl}/?subscribed=true`,
  cancel_url: `${baseUrl}/subscribe`,
  metadata: { userId, plan },
  subscription_data: { metadata: { userId, plan } },
});
```

This uses **Stripe-hosted Checkout** (mode `'subscription'` redirects the user to `checkout.stripe.com`). Stripe redesigned the hosted Checkout UI in 2024 to comply with the FTC's "Click to Cancel" rule and the California Automatic Renewal Law (ARL) — auto-renewal terms (amount, interval, "Cancel anytime") render in plain language directly above the Subscribe button. We do not customize the consent text; we get Stripe's compliance-default copy.

**Action:** Brody to walk through the actual flow in incognito and confirm the exact UI/copy his customers see meets §5.2 standards. (Should pass — but the lawyer should see what Stripe shows, not Brody's reproduction.)

---

## 9. Post-purchase confirmation email — Stripe receipt covers it

`grep` of `app/api/webhooks/stripe/route.ts` confirms: no Resend send on `checkout.session.completed`, `invoice.paid`, or any subscription event. The only Resend code path in the app is `lib/email.ts` → `sendInviteEmail()` for waitlist invites.

Stripe sends its own subscription confirmation receipt by default when "Send customer emails for successful payments" is enabled in Stripe Dashboard → Settings → Customer Emails. Default is **on** for new accounts. Stripe's receipt includes:

- Amount, plan name, interval ("Subscribes you for $9.99 USD every month").
- "Manage subscription" link (Customer Portal).
- Receipt PDF attachment.

**Action:** Brody to verify Stripe Dashboard → Settings → Customer Emails → "Successful payments" is toggled on (default-on but worth eyeballing).

If branded BreakIQ-styled confirmation is desired later, ~30-min add to the webhook handler on the `checkout.session.completed` case calling `sendSubscriptionActivatedEmail()` via Resend — not necessary for compliance, just for brand polish.

---

## 10. Free tier auto-conversion — confirmed none

Verified in `lib/usage.ts:67-78`:

```ts
const limit = LIMITS[effectivePlan] ?? 3;
const used = profile.analyses_used ?? 0;

if (used >= limit) {
  return {
    allowed: false,
    remaining: 0,
    plan: effectivePlan,
    upgrade: true,
  };
}
```

When a free-tier user exhausts their 3 lifetime analyses:

1. The API returns 403 with `{ allowed: false, upgrade: true }`.
2. The frontend surfaces an upgrade prompt directing the user to `/subscribe`.
3. The user must navigate to `/subscribe` and **affirmatively click "Get Hobby" or "Get Pro"** — Stripe Checkout itself is then the next affirmative payment-method capture step.

There is no code path that automatically creates a Stripe customer or charges a card without the user clicking through a paid plan. The free tier is a hard cap, not a trial that auto-converts.

---

## Three additional items flagged beyond the strict Y/N

### A. Free-tier counter is **per-user lifetime**, not "per month"

`lib/usage.ts:11` — `free: 3 // lifetime (not monthly)`. If v4 language anywhere implies "3 free analyses per month" (a common SaaS framing), that's incorrect — it's 3 lifetime, and the user hits the upgrade gate forever after that. Worth a copy review on the `/subscribe` page and the T&C §5.1 description.

### B. Session replay decision — RESOLVED

Resolved 2026-05-06: session recording turned off in PostHog. No §6.3 disclosure required. (Original recommendation was to turn off for the beta; that's what we did.)

### C. Discord contributor data is **persistent and partially public**

Different shape than a typical subprocessor relationship — Discord allowlisted contributors submit narratives via `/insight` that:

- Persist with full attribution (Discord display name + raw narrative) **forever** in `breakerz_sentiment_history` and `player_risk_flags`.
- Become **visible to other authenticated BreakIQ users** as part of the analysis surfaces.

This is a UGC-with-attribution model, not a subprocessor flow. The privacy doc draft handles it in §3.7 and §7; v4 should keep equivalent language.

---

## File version

This doc lives at `docs/legal/production-config-audit-2026-05-06.md`. When configuration changes (Supabase tier upgrade, PostHog settings change, new subprocessor added, OAuth scopes adjusted), spawn a fresh dated copy of this audit rather than editing in place — the dates are the audit trail.
