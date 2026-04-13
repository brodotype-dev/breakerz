# BreakIQ — Cost Analysis & Unit Economics

*Last updated: 2026-04-13*

---

## Fixed Monthly Costs (regardless of users)

| Service | Current Plan | Monthly Cost | Notes |
|---|---|---|---|
| **CardHedger API** | Custom | **$300** | Fixed contract |
| **Supabase** | Free tier | **$0** | Free covers 50K MAU, 500MB DB, 5GB bandwidth. Pro ($25/mo) needed at ~200+ users |
| **Vercel** | Hobby | **$0** | Free covers build/deploy. Pro ($20/mo) for analytics, team access, or >100GB bandwidth |
| **Resend** | Free tier | **$0** | 3,000 emails/mo free. $20/mo at scale |
| **PSA API** | Free | **$0** | Public bearer token |
| **Stripe** | Pay-as-you-go | 2.9% + $0.30/txn | Per-transaction only |
| **Domain** | getbreakiq.com | ~**$1** | Annual amortized |
| **Claude Code (dev)** | Usage-based | **$600–900** | $20–30/day active dev. Drops to ~$150–300/mo in maintenance mode |

**Fixed baseline: ~$300/mo** (CardHedger) + dev costs

---

## Variable Costs Per User Action

**Claude Haiku 4.5 pricing:** $0.80/1M input tokens, $4.00/1M output tokens

| Action | Claude Cost | CardHedger Calls | Effective Cost |
|---|---|---|---|
| **BreakIQ Sayz analysis** | ~$0.0006 | 0 (uses pricing cache) | **~$0.001** |
| **Slab Analysis (vision + pricing)** | ~$0.002 | 2–3 calls | **~$0.003** |
| **My Breaks (new, with analysis)** | ~$0.0006 | 0 (uses pricing cache) | **~$0.001** |
| **Nightly pricing refresh (per player)** | $0 | 1–2 calls | **~$0.002** (CH quota) |
| **Admin: match variant** | ~$0.0005 | 1 call | **~$0.001** |

Claude costs are effectively negligible with Haiku. CardHedger is the real variable — but it's a flat $300/mo, so more usage doesn't increase cost until rate limits are hit.

---

## Subscription Tiers

| | Free (Trial) | Hobby | Pro |
|---|---|---|---|
| **Price** | $0 | $9.99/mo | $24.99/mo |
| **BreakIQ Sayz** | 3 lifetime | 10/mo | Unlimited |
| **Slab Analysis** | 3 lifetime | 10/mo | Unlimited |
| **My Breaks** | Unlimited logging | Unlimited | Unlimited |
| **Products & Slot Pricing** | All | All | All |

---

## Revenue vs. Cost at Scale

**Assumptions:**
- 80% Hobby ($9.99), 20% Pro ($24.99) split (conservative — shifts toward Pro as value is demonstrated)
- Hobby users average 7 analyses/mo, Pro users average 25
- 10 active products, ~50 players each (nightly cron)

| | **50 Users** | **200 Users** | **500 Users** |
|---|---|---|---|
| | | | |
| **Revenue** | | | |
| Hobby (80%) | 40 × $9.99 = $400 | 160 × $9.99 = $1,598 | 400 × $9.99 = $3,996 |
| Pro (20%) | 10 × $24.99 = $250 | 40 × $24.99 = $1,000 | 100 × $24.99 = $2,499 |
| **Gross Revenue** | **$650** | **$2,598** | **$6,495** |
| Stripe fees | -$34 | -$135 | -$295 |
| **Net Revenue** | **$616** | **$2,463** | **$6,200** |
| | | | |
| **COGS** | | | |
| CardHedger API | $300 | $300 | $300 |
| Claude API (analyses) | $0.50 | $4 | $12 |
| Supabase | $0 | $25 | $25 |
| Vercel | $0 | $20 | $20 |
| Resend | $0 | $0 | $20 |
| **Total COGS** | **$301** | **$349** | **$377** |
| | | | |
| **Gross Margin** | **$315 (48%)** | **$2,114 (81%)** | **$5,823 (90%)** |
| | | | |
| **Dev Costs** | | | |
| Claude Code (active) | $600–900 | $300–600 | $150–300 |
| | | | |
| **Net after dev** | **-$285 to -$585** | **$1,514 to $1,814** | **$5,523 to $5,673** |

---

## Breakeven Analysis

- **Fixed costs:** ~$325/mo (CardHedger + Supabase Pro)
- **Average revenue per user:** $9.99 × 0.8 + $24.99 × 0.2 = **$12.99/mo**
- **Stripe fee per user:** ~$0.68
- **Net per user:** ~$12.31
- **Breakeven (COGS only): ~27 paying users**
- **Breakeven (including $600/mo dev): ~76 paying users**

---

## Service Upgrade Triggers

| Service | Trigger | Cost | When |
|---|---|---|---|
| **Supabase → Pro** | >50K auth requests/mo or daily backups needed | $25/mo | ~100+ users |
| **Vercel → Pro** | Team access, analytics, >100GB bandwidth | $20/mo | When analytics needed |
| **Resend → Pro** | >3,000 emails/mo | $20/mo | ~3,000 invites sent |
| **CardHedger tier upgrade** | Rate limits hit | TBD | 500+ heavy users |
| **PostHog (analytics)** | You want event tracking | $0 (free: 1M events/mo) | Now |
| **Sentry (errors)** | You want error tracking | $0 (free: 5K events/mo) | Now |

---

## Key Takeaways

1. **Claude costs are irrelevant.** Haiku is so cheap that 500 users doing 25 analyses/month costs $12/mo. Not worth optimizing.

2. **CardHedger is the only real COGS.** The $300/mo flat fee means margin improves dramatically with every user. At 200 users it's 86% gross margin.

3. **Dev costs dominate at beta scale.** $600–900/mo in Claude Code during active dev is the biggest expense. Drops to $150–300/mo in maintenance mode.

4. **You're profitable at ~22 paying users** (COGS only) or ~61 users including dev. Very achievable for a beta with a waitlist.

5. **Add PostHog + Sentry now** (both free tier). You need event tracking and error monitoring before launch — currently there's no visibility into what users do or when things break.

6. **No annual pricing yet.** Variable AI/API costs are moving fast. Monthly-only protects against getting locked into a discount that doesn't cover costs if upstream pricing changes.

---

## API Call Volume by Endpoint

For capacity planning — estimated monthly API calls at each scale:

| Endpoint | 50 Users | 200 Users | 500 Users |
|---|---|---|---|
| Claude Haiku (analyses) | ~350 calls | ~2,800 calls | ~8,750 calls |
| Claude Haiku (slab vision) | ~100 calls | ~600 calls | ~2,000 calls |
| CardHedger (pricing cache refresh) | ~15,000/mo (cron) | ~15,000/mo (cron) | ~15,000/mo (cron) |
| CardHedger (slab lookups) | ~200 calls | ~1,200 calls | ~4,000 calls |
| PSA API (cert lookups) | ~100 calls | ~600 calls | ~2,000 calls |
| Supabase (DB operations) | ~50K | ~200K | ~500K |
| Stripe (checkout/portal) | ~50 | ~200 | ~500 |
| Resend (invite emails) | ~50 | ~200 | ~500 |
