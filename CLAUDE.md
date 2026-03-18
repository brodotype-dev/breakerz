# Card Breakerz — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

**Before starting any session, read:**
- [README.md](./README.md) — project overview, routes, local dev setup
- [CHANGELOG.md](./CHANGELOG.md) — full feature history and technical decisions

Update CHANGELOG.md at the end of every session with what changed and why.

---

## Stack

- **Framework:** Next.js 15 App Router (TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** Supabase (Postgres)
- **Pricing API:** CardHedger (`https://api.cardhedger.com`)
- **Deploy:** Vercel (CLI, not GitHub Actions)

---

## Deploy

Always deploy from local via CLI — do not push to GitHub and wait for CI:

```bash
cd /tmp/breakerz-next
vercel --prod --yes
```

**Production URL:** `breakerz-next.vercel.app`

**Important:** Push to GitHub (`git push origin main`) before deploying. Vercel builds from the GitHub repo — local-only commits won't be included in the build.

---

## Environment Variables

Set in Vercel project dashboard (already configured — do not re-add):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only, bypasses RLS) |
| `CARDHEDGER_API_KEY` | CardHedger API key (server only, provided by Kyle) |

For local dev, put these in `.env.local` (not committed).

---

## Known Gotchas

### 1. Supabase + Vercel Build

The Vercel-Supabase integration injects env vars under **both** `NEXT_PUBLIC_SUPABASE_URL` **and** `SUPABASE_URL`. `lib/supabase.ts` must use `??` fallbacks to handle both:

```typescript
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_ACCESS_KEY;
```

Without the fallbacks, builds fail with `supabaseUrl is required`.

### 2. pdf-parse + Vercel Build

`pdf-parse` loads canvas bindings at module evaluation time and crashes the build with `DOMMatrix is not defined`. Fix: `require('pdf-parse')` must be **inside the handler function**, not at the top of the file. Also add `export const dynamic = 'force-dynamic'` to any route that uses it.

```typescript
// ✗ breaks build
const pdfParse = require('pdf-parse');

// ✓ correct
export const dynamic = 'force-dynamic';
export async function POST(req) {
  const pdfParse = require('pdf-parse'); // inside handler
  ...
}
```

---

## Key Files

```
lib/
  supabase.ts          — Supabase client (see gotcha above)
  cardhedger.ts        — CardHedger API client (server-side only)
  engine.ts            — Break pricing engine (slot cost formula)
  checklist-parser.ts  — PDF/CSV checklist parsers
  types.ts             — Shared TypeScript types

app/
  break/[slug]/        — Public break analysis page (Team Slots default)
  admin/
    import-checklist/  — 3-step checklist import wizard
    products/[id]/players/ — Manual player management

app/api/
  pricing/             — Live pricing route (Supabase + CardHedger, 24h TTL cache)
  admin/
    parse-checklist/   — POST: PDF or CSV → ParsedChecklist
    parse-odds/        — POST: Topps odds PDF → ParsedOdds
    import-checklist/  — POST: upsert players, player_products, variants
    match-cardhedger/  — POST: auto-link variants to CardHedger card IDs
    apply-odds/        — POST: write pull rates to variants from odds PDF
    products/          — GET: product list for admin dropdowns

scripts/
  map-cards.mjs        — Interactive CLI to manually map CardHedger IDs to players
                         Run: node scripts/map-cards.mjs

supabase/
  schema.sql           — Full schema + seed data
```

---

## Database Schema (summary)

```
sports              → basketball, baseball, football
products            → e.g. "Topps Finest Basketball 2025-26"
players             → cross-product player identity
player_products     → player × product (hobby_sets, bd_only_sets, insert_only)
player_product_variants → multiple card types per player per product
                          (Base Auto, XRC Auto, etc.) each with own CardHedger ID
pricing_cache       → 24h TTL cache of EV low/mid/high per player_product
```

**Supabase project ref:** `zucuzhtiitibsvryenpi`
MCP server configured in `.mcp.json` — connects Claude directly to Supabase.

---

## Pricing Model

```
hobbyWeight  = evMid × hobby_sets
slotCost     = breakCost × (hobbyWeight / Σ hobbyWeights)
```

When variants exist, EV is a total-set-weighted average across all variant card IDs before being fed into the engine.

---

## Checklist Import Formats

| Format | Detection |
|---|---|
| Topps PDF — numbered | `   10 Player Name   Team®` |
| Topps PDF — code-based | `SM-AB Player Name   Team®` |
| Panini/Donruss CSV | Header row with `ATHLETE`, `CARD SET`, `SEQUENCE` columns |
| Topps odds PDF | Lines with `1:N` tokens |

Upload at `/admin/import-checklist`. After import, run CardHedger match from Step 3.

---

## MCP

`.mcp.json` connects Claude Code to the live Supabase project via the Supabase MCP server.
Use it to inspect tables, run queries, and verify data without leaving Claude Code.

---

## Repo

`https://github.com/brodotype-dev/breakerz.git` — push after deploying, not before.
