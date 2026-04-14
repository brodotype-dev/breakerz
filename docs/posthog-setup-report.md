<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into BreakIQ. Here's a summary of what was added:

- **`instrumentation-client.ts`** — Client-side PostHog initialization using the Next.js 16 instrumentation pattern. Enables autocapture, session replay, and exception tracking via `capture_exceptions: true`.
- **`lib/posthog-server.ts`** — Singleton server-side PostHog client (posthog-node) for API routes and webhooks.
- **`next.config.ts`** — Added `/ingest` proxy rewrites so PostHog requests route through your domain, improving ad-blocker resilience.
- **`.env.local`** — `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` set.
- **7 files instrumented** with `posthog.capture()` or server-side `posthog.capture({distinctId, event})` calls.
- **User identification** added server-side in `app/auth/callback/route.ts` — runs `posthog.identify()` on every auth callback and fires `user_signed_up` for new accounts.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `waitlist_signup_submitted` | User submits the waitlist form (top of funnel) | `app/waitlist/page.tsx` |
| `onboarding_completed` | User completes all 3 onboarding steps | `app/(consumer)/onboarding/page.tsx` |
| `subscription_checkout_started` | User clicks a plan and is redirected to Stripe | `app/(consumer)/subscribe/page.tsx` |
| `break_analysis_run` | User runs a BreakIQ Sayz analysis | `app/(consumer)/analysis/page.tsx` |
| `slab_analysis_lookup_completed` | User completes a Slab Analysis lookup | `app/(consumer)/card-lookup/page.tsx` |
| `break_logged` | User logs a break in My Breaks (server-side) | `app/api/my-breaks/route.ts` |
| `checkout_initiated` | Server-side: checkout API called | `app/api/checkout/route.ts` |
| `subscription_activated` | Stripe webhook: checkout.session.completed | `app/api/webhooks/stripe/route.ts` |
| `subscription_canceled` | Stripe webhook: subscription deleted | `app/api/webhooks/stripe/route.ts` |
| `user_signed_up` | New user identified after OAuth/email auth | `app/auth/callback/route.ts` |

## Next steps

We've built a dashboard and five insights to track user behavior from day one:

- **Dashboard:** [Analytics basics](https://us.posthog.com/project/380571/dashboard/1462104)
- [User conversion funnel](https://us.posthog.com/project/380571/insights/CLNrmbTY) — Waitlist → Onboarding → Checkout → Activated
- [Subscriptions vs cancellations](https://us.posthog.com/project/380571/insights/JqXgyysy) — Weekly net subscription trend / churn signal
- [Feature usage — Analyses & Slab lookups](https://us.posthog.com/project/380571/insights/UItpsQOh) — Weekly engagement with the two core features
- [Checkout started by plan](https://us.posthog.com/project/380571/insights/AMHpsUoI) — Hobby vs Pro split on checkout intent
- [My Breaks engagement](https://us.posthog.com/project/380571/insights/c8iEnF3K) — Weekly break log volume

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
