# BreakIQ — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

**Docs (read on demand, not automatically):**
- [CHANGELOG.md](./CHANGELOG.md) — full feature history
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritized work queue
- [docs/cardhedger-matching.md](./docs/cardhedger-matching.md) — CH matching architecture
- [docs/beta-launch-checklist.md](./docs/beta-launch-checklist.md) — pre-launch todo list

Update CHANGELOG.md at the end of every session with what changed and why.

---

## Current State

Live at [breakerz.vercel.app](https://breakerz.vercel.app) (domain: getbreakiq.com pending). Private beta — `/break/*` and `/analysis/*` require auth; unauthenticated visitors redirected to `/waitlist`.

**Admin pipeline** ✅ Product creation → checklist import (Topps PDF/CSV, Bowman XLSX) → CardHedger matching (Claude Haiku, ~76–90% auto-match) → odds import → readiness dashboard → BreakIQ Bets debrief

**Auth + Waitlist** ✅ Supabase Auth (email+password for admins, Google/Apple OAuth for consumers). Public waitlist → admin approval → Resend invite email → `/auth/signup?code=` → OAuth → `/auth/callback` validates invite, creates profile, marks converted.

**Social Currency** ✅ B-score (breakerz_score), Icon tier (is_icon), Risk Flags (player_risk_flags), HV (is_high_volatility), consumer badges (★ ↑↓ ⚡ ⚑)

**Next up:** Google OAuth consent screen publish, getbreakiq.com domain setup, B-score decay, pricing cache cron, Phase 5 C-score (blocked on Kyle)

---

## Stack

Next.js 15 App Router · TypeScript · Tailwind + shadcn/ui · Supabase (Postgres + Auth) · CardHedger API · Claude Haiku · Resend · Vercel

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
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CARDHEDGER_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`

Supabase Vercel integration injects both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` — `lib/supabase.ts` uses `??` fallbacks for both. Don't remove them.

---

## Known Gotchas

1. **PDF parsing** — use `pdf2json` not `pdf-parse` (canvas crash on Vercel). Lazy `require()` inside handler + `export const dynamic = 'force-dynamic'`. See `app/api/admin/parse-odds/route.ts`.
2. **Resend lazy init** — `new Resend(key)` must be inside a function, not module-level, or builds fail when `RESEND_API_KEY` is absent.
3. **hobbyEVPerBox not cached** — pricing_cache stores ev_low/mid/high but not odds-weighted EV. Cached GET falls back to evMid. Schema change needed to fix (in backlog).
4. **Supabase migrations** — CLI linked to production. To push: `supabase db push`. To repair a failed migration: `supabase migration repair --status reverted <timestamp>`. Files in `supabase/migrations/`.

---

## Key Files

```
middleware.ts                    — auth guard: /admin/*, /api/admin/*, /break/*, /analysis/*
lib/supabase.ts                  — admin client (service role)
lib/supabase-server.ts           — cookie-aware server client (@supabase/ssr)
lib/auth.ts                      — getCurrentUser(), requireRole()
lib/email.ts                     — sendInviteEmail() via Resend
lib/engine.ts                    — pricing engine: computeSlotPricing, computeEffectiveScore
lib/cardhedger.ts                — CardHedger API + Claude matching
lib/card-knowledge/              — manufacturer matching modules (bowman, panini, default)
lib/checklist-parser.ts          — PDF/CSV/XLSX checklist parsers
app/waitlist/                    — public signup
app/auth/signup/                 — consumer OAuth entry (invite code validation)
app/auth/callback/route.ts       — OAuth callback: exchange code, validate invite, create profile
app/admin/login/                 — admin auth
app/admin/waitlist/              — approve users, send invites
app/admin/products/[id]/         — product dashboard (matching, odds, BreakIQ Bets)
app/break/[slug]/                — consumer break analysis (auth required)
app/analysis/                    — BreakIQ Sayz deal checker (auth required)
```

---

## Database Schema

```
sports, products, players, player_products, player_product_variants
pricing_cache         — 24h TTL, ev_low/mid/high per player_product
player_risk_flags     — soft-delete (cleared_at); injury/suspension/legal/trade/retirement
profiles              — mirrors auth.users
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
