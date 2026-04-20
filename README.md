# BreakIQ

AI-powered intelligence platform for sports card breaks. Real-time slot pricing, deal analysis, and market signals — built for breakers and serious collectors.

**Live:** [getbreakiq.com](https://getbreakiq.com) · Private beta

---

## What it does

Given a sports card product (e.g. 2025 Bowman Chrome Baseball), BreakIQ:

1. Imports the manufacturer checklist (Topps PDF, Bowman XLSX, Panini CSV) and links every variant to a CardHedger `card_id`
2. Fetches live card pricing from CardHedger (24h cache, nightly cron refresh)
3. Computes odds-weighted EV per player: `hobbyEVPerBox = Σ(variantEV × 1/hobby_odds)`
4. Applies social signal adjustments: `effectiveScore = clamp(buzz_score + breakerz_score, -0.9, 1.0)`
5. Distributes break cost across teams proportionally by weighted EV
6. Outputs per-team slot costs, RC counts, and BUY/WATCH/PASS signals

**BreakIQ Sayz** (`/analysis`) — consumer deal checker: pick a product, select a team, enter the asking price — Claude returns a BUY/WATCH/PASS verdict with a 2–3 sentence AI narrative, risk flag disclosures, and social signal badges.

**Slab Analysis** (`/card-lookup`) — upload a cert image or enter a cert number directly. Claude parses the image, PSA API verifies grade + population data, CardHedger returns market-wide grade pricing and recent comps.

**My Breaks** (`/my-breaks`) — log breaks before or after they happen. Captures the BreakIQ analysis snapshot at decision time. Rate outcome (Win/Mediocre/Bust), record platform, give feedback on the analysis. Stats, filters, CSV export/import.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router (TypeScript) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (Postgres + Auth) |
| Payments | Stripe (Hobby $9.99/mo, Pro $24.99/mo) |
| Pricing API | CardHedger |
| Cert Verification | PSA Public API |
| Email | Resend |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) |
| Analytics | PostHog |
| Deploy | Vercel |

---

## Local development

```bash
npm install
npm run dev
```

Copy env vars from Vercel or ask for `.env.local`. Required vars:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET
CARDHEDGER_API_KEY
ANTHROPIC_API_KEY
PSA_API_KEY
RESEND_API_KEY
FROM_EMAIL
NEXT_PUBLIC_APP_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_HOBBY
STRIPE_PRICE_PRO
CRON_SECRET
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
```

Local dev bypasses auth (middleware skips redirect, API routes fall back to first profile). See [CLAUDE.md](./CLAUDE.md) for full environment details and known gotchas.

---

## Deploy

```bash
git push origin main
vercel --prod --yes
```

Staging branch: `staging` | Repo: `github.com/brodotype-dev/breakerz`

---

## Key routes

### Consumer (auth required)

| Route | Purpose |
|---|---|
| `/` | Homepage — product grid, My Breaks promo |
| `/break/[slug]` | Break analysis — team slots, player EV, buzz badges |
| `/analysis` | BreakIQ Sayz — enter a price, get BUY/WATCH/PASS + AI narrative |
| `/card-lookup` | Slab Analysis — cert image or cert # → PSA verification + market pricing |
| `/my-breaks` | Break history — log, track outcomes, export CSV |
| `/onboarding` | Post-signup wizard (age gate, preferences, attribution) |
| `/subscribe` | Plan selection — Hobby $9.99 / Pro $24.99 / free trial |
| `/profile` | Consumer profile — name, DOB, hobby preferences |
| `/waitlist` | Public beta signup |
| `/auth/signup` | Invite-code signup — Google / Discord / email |

### Admin (admin/contributor role required)

| Route | Purpose |
|---|---|
| `/admin/products` | Product listing |
| `/admin/products/new` | Create product with CH set-name lookup |
| `/admin/products/[id]` | Product dashboard — matching, odds, BreakIQ Bets, Pricing Audit |
| `/admin/products/[id]/edit` | Edit product — display name, CH set name, pricing |
| `/admin/products/[id]/players` | Player management — icon tier, HV flag, risk flags |
| `/admin/import-checklist` | Checklist import wizard (PDF/XLSX/CSV) |
| `/admin/breakiq-betz` | Global BreakIQ Bets editorial scores |
| `/admin/waitlist` | Waitlist management — approve, send invites |

---

## Admin: adding a product

1. Go to `/admin/products/new`
2. Fill in Sport, Manufacturer, Year, Display Name
3. **Find on CH** — search for the canonical CardHedger set name and lock it in (stored as `ch_set_name`)
4. Set pricing (Hobby/Case, BD/Case), release date if pre-release
5. Publish

**Important:** The `ch_set_name` must exactly match CardHedger's canonical set name. Use the "Find on CH" button to search — wrong names silently return wrong results. See [docs/manufacturer-rules/bowman.md](./docs/manufacturer-rules/bowman.md) for naming conventions.

---

## Admin: importing a checklist

1. Go to `/admin/products/[id]` → Import Checklist
2. Upload a checklist file (Topps PDF, Bowman XLSX, Panini CSV)
3. Review parsed sections — set Hobby/BD sets per section
4. Import → runs CardHedger auto-matching

**Matching:** Uses set-catalog mode by default — pre-loads the full CH set (~94 API calls), matches locally by card number (confidence 0.95), falls back to individual Claude matching for unmatched variants.

Current match rates: ~95% Bowman Draft · **96% Bowman's Best** · TBD Bowman Chrome

---

## CardHedger matching

Matching runs automatically during import and on-demand via "Re-run Matching" on the product dashboard. The `ch_set_name` on the product is used directly — no set-search needed at match time.

For autograph prefixes (BMA/CPA/BPA/FDA/CA/BSA), "Autograph" is appended to the query. Without it, base cards outrank autos in search results.

See [docs/manufacturer-rules/bowman.md](./docs/manufacturer-rules/bowman.md) for full prefix reference and CH naming conventions.

---

## Subscriptions

- **Free trial:** 3 lifetime AI analyses (BreakIQ Sayz + Slab Analysis + My Breaks new)
- **Hobby:** $9.99/mo — 10 analyses, 10 slab lookups, unlimited break logging
- **Pro:** $24.99/mo — unlimited everything
- Admin/contributor users bypass all limits

Stripe webhooks at `/api/webhooks/stripe` handle checkout, invoice, and subscription lifecycle.

---

## Project docs

- [CHANGELOG.md](./CHANGELOG.md) — feature history
- [CLAUDE.md](./CLAUDE.md) — Claude Code context (deploy, gotchas, schema, env vars)
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritized work queue
- [docs/cost-analysis.md](./docs/cost-analysis.md) — unit economics and breakeven analysis
- [docs/manufacturer-rules/bowman.md](./docs/manufacturer-rules/bowman.md) — Bowman/Topps matching rules and CH conventions
- [docs/cardhedger-matching.md](./docs/cardhedger-matching.md) — CH matching architecture
- [docs/cardhedger-questions.md](./docs/cardhedger-questions.md) — open questions for CH team
