# BreakIQ Beta Email Audit

*Audit run 2026-05-20 via direct Resend REST + Supabase MCP. Plan: `~/.claude/plans/i-d-like-to-open-replicated-wirth.md`.*

## TL;DR — production bug

**Six waitlist users approved between 2026-04-13 and 2026-05-05 never actually received their invite emails.** The DB shows `invite_sent_at` populated for all six; the Resend account shows zero invite emails ever sent from BreakIQ code. Silent failure. Launch-blocking.

Root cause is two layers:
1. **Stale Resend API key in production Vercel env** — the key BreakIQ deployed code has been using to authenticate against Resend has been invalid for an unknown period.
2. **Error swallowing in [app/api/admin/waitlist/[id]/approve/route.ts:50-60](../app/api/admin/waitlist/[id]/approve/route.ts)** — the route try/catches `sendInviteEmail` and returns `200 {ok: true, emailError: true}` on send failure. Console logs the error; nothing surfaces to the admin UI.

Below is everything else the audit found.

---

## Resend account state (snapshot 2026-05-20)

Pulled via direct REST calls (MCP server is on a stale cached env from prior session — not relevant to data validity, just routing).

| Resource | Count | Detail |
|---|---:|---|
| Verified domains | 1 | `getbreakiq.com` (verified 2026-04-03, sending enabled, us-east-1) |
| API keys | 3 | `Claude_Code_MCP` (full access, last used today), `Vercel Integration` (full access, never used), `Supabase Integration` (full access, never used) |
| Audiences | 1 | `General` (created 2026-01-05, no contacts visible in this account) |
| Broadcasts | 0 | — |
| Templates | 0 | — |
| Topics | 0 | — |
| Webhooks | 0 | — |
| Total emails in send history | 8 | All from `Juniper <onboarding@resend.dev>`, all to `brodyclemmer@gmail.com`, all dated **2026-01-06 to 2026-03-20** |

### What that send history tells us

- **Zero BreakIQ transactional emails have ever reached Resend.** `sendInviteEmail` writes from `invites@getbreakiq.com` (or the fallback `invites@breakerz.vercel.app`) — neither appears anywhere in the 8-message history.
- **The 8 historical emails are from a previous project called "Juniper"** — admin notifications and a test email. They use `onboarding@resend.dev` (Resend's default dev sender) and were probably sent by a Supabase Auth → Resend hook configured on a different project sharing this Resend account.
- **The "Vercel Integration" key has `last_used_at = null`** — Resend has never seen a request authenticated with that key. Combined with the absent BreakIQ sends, this confirms production Vercel env has been holding a key Resend can't authenticate.

---

## The waitlist bug — cross-reference

```
waitlist.status = 'approved' AND invite_sent_at IS NOT NULL → 6 rows
waitlist.status = 'pending'                                 → 11 rows
```

Earliest approved invite: **2026-04-13 15:43**. Latest: **2026-05-05 19:21**.

Resend send history during the same window: **0 emails sent from anything BreakIQ-related**.

### What the affected users actually experienced

1. Joined the waitlist (status `pending`).
2. Brody (or whoever) approved them in the admin UI.
3. Route updated their row: `status = 'approved'`, `invite_code` minted, `invite_sent_at = now()`.
4. Route called `sendInviteEmail` → call threw (invalid API key) → caught silently.
5. Admin UI saw `{ok: true}` → looked successful.
6. User never received the email → never signed up → invisible churn from the admin's perspective.

### Recovery actions (P0 launch-blockers)

- [ ] Verify Vercel `RESEND_API_KEY` env var matches one of the live full-access keys above (preferably `Vercel Integration` or `Claude_Code_MCP`, NOT a key not in the list). Already pushed today; confirm the deploy actually rolled.
- [ ] Re-send the 6 outstanding invites. They still have valid `invite_code` values in the DB — no need to mint new codes. A small one-off script that selects approved rows where the user hasn't actually signed up yet and calls `sendInviteEmail({to, fullName, inviteCode})` for each is the cleanest path.
- [ ] Update [approve/route.ts](../app/api/admin/waitlist/[id]/approve/route.ts) to surface `emailError: true` to the admin UI prominently (red banner / toast), not just log it.
- [ ] Wire production observability for transactional-email failures. At minimum: a PostHog event `invite_email_failed` fired in the catch block so silent failures show up in the dashboard.

---

## Email touchpoints — the launch punch list

Status legend: 🟢 implemented & verified working · 🟡 implemented but broken/stale · 🔴 missing · ⚪ not needed for V1

| # | Touchpoint | Trigger | Sender | Status | Notes |
|---|---|---|---|---|---|
| 1 | **Waitlist join confirmation** ("you're on the list") | `POST /api/waitlist` | `hello@getbreakiq.com` | 🔴 missing | Highest UX value for the smallest engineering lift. Right now users hit submit and get no acknowledgment outside the in-page success state. |
| 2 | **Approval invite** ("you're in") | Admin approves a waitlist row | `invites@getbreakiq.com` | 🟡 broken | Code exists in [lib/email.ts](../lib/email.ts) `sendInviteEmail`. Has been silently failing — see bug above. Fix is the recovery actions list. |
| 3 | **Post-signup welcome** ("here's how to use BreakIQ") | First successful `/auth/callback` | `hello@getbreakiq.com` | 🔴 missing | Sets expectations + nudges into onboarding. Could include 1–2 link CTAs to `/break` and `/chase`. |
| 4 | **Onboarding-incomplete nudge** | 24h after signup if `onboarding_completed_at IS NULL` | `hello@getbreakiq.com` | 🔴 missing | Optional for V1. Wait until we see onboarding drop-off in PostHog before building this. |
| 5 | **Subscription started — receipt** | Stripe `checkout.session.completed` webhook | `hello@getbreakiq.com` | 🔴 missing in our code | **Stripe sends a default receipt automatically** — verify in Stripe Dashboard → Settings → Customer emails that "Successful payments" is enabled. If yes, no BreakIQ code needed. If no, add a Resend send from the webhook handler. |
| 6 | **Subscription renewal** | Stripe `invoice.payment_succeeded` | — | ⚪ not for V1 | Stripe handles this if enabled in dashboard. Customizing isn't a V1 priority. |
| 7 | **Failed payment** | Stripe `invoice.payment_failed` | — | 🔴 missing in our code | **Stripe sends by default**. Same verification as #5 — confirm in Stripe dashboard. |
| 8 | **Subscription canceled** | Stripe `customer.subscription.deleted` | `hello@getbreakiq.com` | 🔴 missing | Confirmation + win-back hook. Phase 2. |
| 9 | **Inactivity nudge** | 7d/14d after last sign-in | `hello@getbreakiq.com` | ⚪ not for V1 | Build after we have retention data to optimize. |
| 10 | **New product live** announcement | Manual broadcast when a new break product flips `live` | broadcast | ⚪ not for V1 | Marketing surface. Bundle with general newsletter once we have audience traction. |
| 11 | **Admin notification — new waitlist signup** | Public waitlist POST | currently `Juniper <onboarding@resend.dev>` | 🟡 broken (wrong project's branding) | The "🔔 New User Signup - Approval Required" emails Brody has been receiving are from a Supabase Auth hook on a *previous* project still attached to this Resend account. They've been working but they're branded "Juniper." Reconfigure the Supabase Auth hook to use a BreakIQ sender, or replace with a BreakIQ-owned implementation. |

### Order to ship (recommended)

**Before private beta opens to non-friends-and-family:**
1. Recovery actions for the 6 broken invites (P0)
2. Make `sendInviteEmail` reliable + observable (P0)
3. Touchpoint #1 — waitlist join confirmation (high UX, low effort)
4. Touchpoint #3 — post-signup welcome (high UX, low effort)
5. Verify Stripe dashboard customer-email settings cover #5 and #7 (likely zero code needed)

**Before public beta:**
6. Touchpoint #11 — replace Juniper-branded admin notifications
7. Touchpoint #8 — subscription canceled (small footprint, reduces support load)

**Phase 2+:** #4, #6, #9, #10 once we have usage data to inform copy and cadence.

---

## Account hygiene to do alongside

- **Sender consolidation.** `lib/email.ts` defaults FROM to `invites@breakerz.vercel.app` if `FROM_EMAIL` env is unset — that domain isn't verified in Resend. The .env.local has `FROM_EMAIL="invites@getbreakiq.com"`. Worth deleting the breakerz.vercel.app fallback so an unset env var fails loudly instead of silently sending against an unverified domain. (Resend would reject it; the existing try/catch would swallow it; same silent-failure shape as today.)
- **Webhooks.** Zero webhooks configured. At minimum we want delivered / bounced / complained events posted back to BreakIQ so we know when our own sends fail downstream. Resend's webhook config lives in the dashboard; a `POST /api/webhooks/resend` handler is a 1-hour ship.
- **Templates.** Account has none — inline HTML in `lib/email.ts` is the current pattern. Fine for V1. If we get past 5 transactional types it's worth migrating to Resend-hosted templates so copy edits don't require deploys.
- **Audiences + topics.** Have one (`General`) audience, zero contacts. Set this up before the first broadcast — not before.

---

## Where the MCP fits going forward

Even though I ran this audit via direct REST (MCP env was stale), the long-term value of the Resend MCP is that future sessions can:

- Trigger one-off broadcasts and drafts from chat without writing Node scripts.
- Manage the audience as it grows without a CLI/dashboard context switch.
- Resend the 6 broken invites once code-side fix is in.

After the next clean Mac-app restart, the MCP should authenticate against `Claude_Code_MCP` (full access). Verify with one `mcp__resend__list-domains` call before assuming.
