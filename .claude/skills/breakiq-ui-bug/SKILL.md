---
name: breakiq-ui-bug
description: Use this skill whenever Brody reports a bug in the BreakIQ interface, app, or any user-facing flow — anything where the user can see the wrong thing on screen, a button doesn't work, a page won't load, auth/onboarding/checkout breaks, the PWA misbehaves, layouts are broken on mobile, or a consumer/admin route returns an error. Triggers include phrases like "the page is", "button doesn't", "I get an error when", "broken on mobile", "won't load", "redirects me to", "logged out", "checkout failed", "form not submitting", "shows the wrong", "doesn't update", "stale", "PWA", "install prompt", "offline". Do NOT use this skill for pricing math, CH match accuracy, cron jobs, missing data, or schema issues — that's breakiq-data-bug.
---

# BreakIQ UI / App Bug Playbook

The user-facing surface is Next.js 15 App Router + Tailwind + shadcn/ui, hosted on Vercel. Auth is Supabase. Payments are Stripe. The consumer surface is a PWA. Most "UI bugs" are actually one of: middleware redirect, server-action failure, RLS denying a read, RSC cache serving stale data, or a Stripe/webhook race.

## Triage order (do these in sequence)

1. **Get a precise repro.** Which route? Which user? Logged in or out? Admin or consumer? Production (`getbreakiq.com`) or staging? Mobile or desktop? Browser or installed PWA?
2. **Read the actual error.** Ask for the browser console output, network-tab status code on the failing request, or the toast/error string. "It doesn't work" is never enough to debug.
3. **Decide the layer.** UI bugs almost always live in one of:
   - **Middleware / auth** — wrong redirect, logged-out loop, `/break/*` bouncing to `/waitlist`
   - **Server component / server action** — page renders blank, action throws, form does nothing
   - **Client component** — button does nothing in console, hydration mismatch, state not updating
   - **API route** — 401 / 403 / 500 from `/api/*` in network tab
   - **Stripe / webhook** — checkout starts but plan never updates, "you've used your free analyses" after subscribing
   - **PWA / service worker** — "I see the previous user's data", "page won't refresh", install prompt missing
4. **Check PostHog for the event trail** before guessing. If a button click is the symptom, look for the corresponding `PH_EVENTS.*` capture in `lib/posthog-events.ts` and query whether it fired. Use `mcp__posthog__exec` for ad-hoc queries.
5. **Read the relevant file before editing.** The codebase has been through several refactors — don't trust your memory of how a page looked.

## Common-cause map

### Auth / redirect loops
- `middleware.ts` is the gate for `/admin/*`, `/api/admin/*`, `/break/*`, `/analysis/*`, `/card-lookup`. Cron requests bypass via `Authorization: Bearer ${CRON_SECRET}`.
- Consumer OAuth callback is `app/auth/callback/route.ts` — validates invite code, creates profile, marks waitlist `converted`, then redirects to `/onboarding` (new user) or `/break` (returning).
- "Logged out unexpectedly" on PWA → likely the SW served a stale `/auth/*` response. `/api/*` and `/auth/*` are NetworkOnly in `app/sw.ts` — verify the path actually matches the bypass list.
- "I get bounced to /waitlist" → user has no profile row yet, or `profiles.invite_status != 'converted'`. Check `profiles` table for that user_id.

### Onboarding / profile
- `app/(consumer)/onboarding/` — 3-step wizard, hard-blocks under-18.
- The OAuth callback is what decides new-vs-returning by checking `profiles.onboarding_completed_at IS NULL`. If a user is stuck on onboarding after completing it, that timestamp didn't get set — check `PUT /api/onboarding`.

### Stripe / subscription state
- Source of truth is the **Stripe webhook**, not the checkout success page. `app/api/webhooks/stripe/route.ts` updates `profiles.subscription_plan` and `profiles.analyses_used`.
- Webhook needs raw body (`request.text()` + `export const dynamic = 'force-dynamic'`).
- "Used my free analyses but I just subscribed" → the webhook didn't run or didn't reset usage. Check Stripe dashboard webhook logs first.
- Plan-aware gates live in `lib/usage.ts` (`checkAndIncrementUsage`). Hobby = 10/mo, Pro = unlimited, free = 3 lifetime.

### PWA / service worker
- Manifest: `app/manifest.ts`. SW source: `app/sw.ts` → compiled by `@serwist/next` to `public/sw.js`. Disabled in dev.
- Logout flow posts `BREAKIQ_LOGOUT` to the SW which deletes every Cache Storage bucket. If the previous user's data leaks: verify `app/(consumer)/SignOutButton.tsx` is the actual sign-out trigger, not a raw Supabase call.
- "Page is stale on mobile" → bypass list in `app/sw.ts` should cover the path. `/admin/*`, `/api/*`, `/auth/*` are NetworkOnly.
- iOS PWA install prompt is manual (no `beforeinstallprompt`). Component: `app/(consumer)/InstallPrompt.tsx`.

### Pricing display (UI side only — actual numbers go to breakiq-data-bug)
- `/break/[slug]` reads from `/api/pricing` which is a **pure cache read** — no CH calls. If the page shows "pricing not yet available" that's `pricing_cache` empty, not a UI bug.
- `low conf` chip = `pricing_cache.confidence < 0.5`. Defined in `components/breakiq/PlayerTable.tsx`.
- `<PricingFeedback>` 👍/👎 lives on player rows, team rows, break-analysis result, slab-analysis result. Writes to `pricing_feedback` via `POST /api/feedback/pricing`.

### My Breaks
- `app/(consumer)/my-breaks/` — list, new break (multi-format), log previous.
- Schema is multi-team / multi-player: `user_breaks.teams text[]`, `extra_player_product_ids uuid[]`, `formats jsonb`. Old single-value columns kept nullable for legacy rows.
- CSV export/import uses `Teams` (semicolon-sep) + per-format case columns.

### Discord insight bot
- `app/api/discord/interactions/route.ts` is the dispatcher. `lib/insights-parser.ts` holds the Claude parser prompt and rules.
- "/insight didn't do anything" → check Discord application logs and `pending_insights` table. Discord Interactions runs over HTTP, no gateway connection.

## Verification before declaring it fixed

1. **Reproduce the original bug** on the broken branch first (so you know what "fixed" means).
2. **Run the actual flow in a browser** for any UI/frontend change. Type checking and tests don't catch wrong behavior. Start the dev server and click through.
3. **Check both auth states** if relevant — logged-in and logged-out.
4. **Check both surfaces** — admin and consumer — when touching shared components (e.g. anything in `components/breakiq/`).
5. **PWA changes** require a hard reload + `Application → Service Workers → Update` in DevTools, or the user will see the old bundle.

## Logging the fix

- One-line bug fixes → CHANGELOG entry only.
- Anything touching multiple files → CHANGELOG + a one-line update to "Current State" in `CLAUDE.md` if the behavior is user-visible.
- If the bug is a recurring pattern (third time we've hit a stale-cache issue, second time RLS bit us), save a feedback memory so future sessions catch it sooner.

## Files most often touched for UI bugs

```
middleware.ts
app/auth/callback/route.ts
app/(consumer)/layout.tsx
app/(consumer)/SignOutButton.tsx
app/(consumer)/PostHogIdentify.tsx
app/(consumer)/onboarding/
app/(consumer)/my-breaks/
app/(consumer)/subscribe/
app/break/[slug]/page.tsx
app/analysis/
app/card-lookup/
app/api/checkout/route.ts
app/api/webhooks/stripe/route.ts
app/api/onboarding/route.ts
app/api/profile/route.ts
app/api/feedback/pricing/route.ts
app/manifest.ts
app/sw.ts
components/breakiq/
lib/auth.ts
lib/supabase-server.ts
lib/stripe.ts
lib/usage.ts
lib/posthog-events.ts
```
