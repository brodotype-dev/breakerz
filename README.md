# Card Breakerz

Break analysis and slot pricing tool for sports card group breaks. Computes fair-value slot costs per team using live card pricing, set structure, and break configuration.

Built in collaboration with Kyle (Town & Line / CardPulse).

**Live:** [breakerz-next.vercel.app](https://breakerz-next.vercel.app)

---

## What it does

Given a sports card product (e.g. 2025-26 Topps Finest Basketball), Card Breakerz:

1. Loads each player's card data and set counts from Supabase
2. Fetches live pricing from the CardHedger API (with 24h cache)
3. Computes weighted EV per player: `evMid × hobby_sets`
4. Distributes break cost across teams proportionally
5. Outputs per-team slot costs, RC counts, and BUY/WATCH/PASS signals

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
| `/break/[slug]` | Public break analysis page |
| `/admin/import-checklist` | 3-step checklist import wizard |
| `/admin/products/[id]/players` | Manual player management |
| `/api/pricing` | Live pricing endpoint (Supabase + CardHedger) |
| `/api/admin/parse-checklist` | PDF/CSV checklist parser |
| `/api/admin/import-checklist` | Upsert players, products, variants |
| `/api/admin/match-cardhedger` | Auto-link variants to CardHedger card IDs |

---

## Admin: importing a checklist

1. Go to `/admin/import-checklist`
2. Select a product and upload a checklist file (Topps PDF or Panini/Donruss CSV)
3. Review parsed sections — set Hobby/BD sets per section, check for flagged lines
4. Import → runs CardHedger auto-matching on the result
5. Optionally upload a Topps odds PDF to attach pull rates to variants

Supported formats: Topps numbered PDF, Topps code-based PDF, Panini/Donruss CSV, Topps odds PDF.

---

## CardHedger card mapping (manual)

For players missing a `cardhedger_card_id`, use the interactive CLI:

```bash
node scripts/map-cards.mjs
```

Searches CardHedger, shows top results, lets you pick the right one per player.

---

## Project docs

- [CHANGELOG.md](./CHANGELOG.md) — feature history and release notes
- [CLAUDE.md](./CLAUDE.md) — context for Claude Code sessions (deploy, gotchas, schema)
- [docs/plans/](./docs/plans/) — implementation plans for major features
