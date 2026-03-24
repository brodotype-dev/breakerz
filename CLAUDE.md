# Card Breakerz — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

**Before starting any session, read:**
- [README.md](./README.md) — project overview, routes, local dev setup
- [CHANGELOG.md](./CHANGELOG.md) — full feature history and technical decisions

Update CHANGELOG.md at the end of every session with what changed and why.

---

## Current State

The admin import pipeline is fully functional end-to-end:

1. **Product creation** ✅
2. **Checklist import** ✅ — 3-step wizard, Topps PDF + Panini CSV
3. **CardHedger matching** ✅ — Claude-powered (haiku), chunked polling, ~90%+ auto-match rate
4. **Odds import** ✅ — coordinate-aware Topps PDF parser; standalone upload on product dashboard
5. **Product readiness dashboard** ✅ — match %, odds status, unmatched variants list, re-run matching

**Known gaps / likely next work:**
- Odds-weighted EV: incorporate `hobby_odds` into the pricing engine (`evMid × (1/odds)` as a pull-rate weight)
- Match review UI: manual override for low-confidence variants (low priority — Claude matching handles most cases)
- Pricing refresh: currently manual (pricing_cache has 24h TTL); no scheduled refresh exists yet

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
cd ~/Documents/GitHub/breakerz
vercel --prod --yes
```

**Production URL:** `https://breakerz.vercel.app`

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
| `ANTHROPIC_API_KEY` | Anthropic API key (server only, used for Claude-powered CardHedger matching) |

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

### 2. PDF parsing on Vercel

Do NOT use `pdf-parse` — it pulls in `canvas` at runtime which requires `DOMMatrix` and other browser globals unavailable in Node.js. Webpack aliases don't intercept the runtime `require`.

**Use `pdf2json` instead** — pure JS, no canvas, exposes x/y coordinates per text item (required for column detection in the odds parser):

```typescript
export const dynamic = 'force-dynamic';

async function extractOddsPdfData(buffer: Buffer): Promise<ParsedOdds> {
  const PDFParser = require('pdf2json'); // lazy require inside handler
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataReady', (data) => {
      // data.Pages[n].Texts[i] → { x, y, R: [{ T: urlencoded text }] }
      resolve(/* ... */);
    });
    parser.on('pdfParser_dataError', (err) => reject(err));
    parser.parseBuffer(buffer);
  });
}
```

The odds PDF parser is coordinate-aware: it detects the Hobby Box column x-position from the first full data row (≥10 `1:` tokens, `colonItems[1].x`), then extracts only hobby odds per row. See `app/api/admin/parse-odds/route.ts`.

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
    products/          — Product listing page
    products/[id]/     — Product readiness dashboard (match %, odds status, pricing, unmatched list)
      OddsUpload.tsx   — Standalone odds PDF upload (independent of import wizard)
      RunMatchingButton.tsx — Re-run CardHedger matching with chunked progress UI
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
                          (Base Auto, XRC Auto, etc.) each with own CardHedger ID,
                          match_confidence (0–1), hobby_odds, breaker_odds
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

## Database Migrations

Supabase CLI is linked and authenticated — no Docker required for migrations.

```bash
# Create a new migration
# Filename: supabase/migrations/YYYYMMDDHHMMSS_description.sql

# Push to linked project (will prompt Y/n)
cd /tmp/breakerz-next
supabase db push --linked

# If a migration partially failed and needs to be re-run:
supabase migration repair --status reverted <timestamp> --linked
supabase db push --linked
```

Migration files live in `supabase/migrations/`. Always commit them to the repo after applying.

---

## Repo

`https://github.com/brodotype-dev/breakerz.git`

Push to GitHub **before** deploying — Vercel builds from the GitHub repo, not from local files.
