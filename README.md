# Card Breakerz

Break analysis and slot pricing tool for sports card group breaks. Computes fair-value slot costs per team using live card pricing, set structure, and break configuration.

Built in collaboration with Kyle (Town & Line / CardPulse).

**Live:** [breakerz.vercel.app](https://breakerz.vercel.app)

---

## What it does

Given a sports card product (e.g. 2025-26 Topps Finest Basketball), Card Breakerz:

1. Loads each player's card data and set counts from Supabase
2. Fetches live pricing from the CardHedger API (with 24h cache)
3. Computes odds-weighted EV per player: `hobbyEVPerBox = Σ(variantEV × 1/hobby_odds)`
4. Applies social signal adjustments: `effective_score = clamp(buzz_score + breakerz_score, -0.9, 1.0)`
5. Distributes break cost across teams proportionally
6. Outputs per-team slot costs, RC counts, and BUY/WATCH/PASS signals

**Breakerz Sayz** (`/analysis`) is the consumer-facing deal checker: pick a product, select your team, enter the case count and what the breaker is charging — Claude returns a BUY/WATCH/PASS verdict with a 2–3 sentence AI narrative. The result card surfaces icon-tier player badges, Breakerz Bets editorial scores, risk flag disclosures, and high volatility advisories.

**Social Currency** is an ongoing signal layer on top of the EV model — see [docs/prd-social-currency.md](./docs/prd-social-currency.md). Currently live: Breakerz Bets (editorial B-score), Icon Tier, Risk Flags, and High Volatility. Automated pipeline (C-score from CardHedger top-movers, P-score from Reddit) is Phase 5–6.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router (TypeScript) |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (Postgres) |
| Pricing API | CardHedger |
| Deploy | Vercel (CLI) |

---

## Local development

```bash
# Install dependencies
npm install

# Add environment variables
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
#          SUPABASE_SERVICE_ROLE_KEY, CARDHEDGER_API_KEY

# Run dev server
npm run dev
```

---

## Deploy

Push to GitHub first, then deploy via CLI:

```bash
git push origin main
vercel --prod --yes
```

See [CLAUDE.md](./CLAUDE.md) for full deploy instructions and known gotchas.

---

## Key routes

| Route | Purpose |
|---|---|
| `/` | Homepage — product grid by sport |
| `/analysis` | **Breakerz Sayz** — consumer deal checker (BUY/WATCH/PASS) |
| `/break/[slug]` | Break analysis page — team slots, player EV, deal checker column |
| `/admin/products` | Product listing |
| `/admin/products/[id]` | Product dashboard — readiness stats, odds upload, re-run matching, Breakerz Bets Debrief |
| `/admin/import-checklist` | 3-step checklist import wizard |
| `/admin/products/[id]/players` | Player management — roster, icon tier (★), high volatility (⚡), risk flags (⚑) |
| `/admin/card-lookup` | **Card Lookup** — screenshot an auction listing → AI extracts cert number → CardHedger grade prices + comps + max bid calculator |
| `/api/analysis` | GET: active product list · POST: run Breakerz Sayz analysis |
| `/api/pricing` | Live pricing endpoint (Supabase + CardHedger, 24h cache) |
| `/api/admin/parse-checklist` | PDF/CSV checklist parser |
| `/api/admin/import-checklist` | Upsert players, products, variants |
| `/api/admin/match-cardhedger` | Auto-link variants to CardHedger card IDs (chunked, Claude-powered) |
| `/api/admin/parse-odds` | Topps odds PDF → pull rates (coordinate-aware) |
| `/api/admin/apply-odds` | Write pull rates to variants by fuzzy name match |

---

## Admin: importing a checklist

1. Go to `/admin/import-checklist`
2. Select a product and upload a checklist file (Topps PDF or Panini/Donruss CSV)
3. Review parsed sections — set Hobby/BD sets per section, check for flagged lines
4. Import → runs CardHedger auto-matching on the result
5. Optionally upload a Topps odds PDF to attach pull rates to variants

Supported formats: Topps numbered PDF, Topps code-based PDF, Panini/Donruss CSV, Bowman XLSX, Topps odds PDF.

---

## CardHedger card mapping

Matching is Claude-powered and runs automatically during import and on-demand from the product dashboard (`/admin/products/[id]` → "Re-run Matching").

For any remaining unmatched variants, the product dashboard shows a table of missing card IDs. A manual CLI fallback also exists:

```bash
node scripts/map-cards.mjs
```

---

## Project docs

- [CHANGELOG.md](./CHANGELOG.md) — feature history and release notes
- [CLAUDE.md](./CLAUDE.md) — context for Claude Code sessions (deploy, gotchas, schema)
- [docs/prd-social-currency.md](./docs/prd-social-currency.md) — Social Currency Signal PRD (buzz score pipeline)
- [docs/card-lookup/prd-card-lookup.md](./docs/card-lookup/prd-card-lookup.md) — Card Lookup tool PRD
- [docs/plans/](./docs/plans/) — implementation plans for major features
