# Card Breakerz — Claude Context

Sports card break slot pricing and analysis tool. Built with Kyle (Town & Line / CardPulse).

**Before starting any session, read:**
- [README.md](./README.md) — project overview, routes, local dev setup
- [CHANGELOG.md](./CHANGELOG.md) — full feature history and technical decisions
- [docs/BACKLOG.md](./docs/BACKLOG.md) — prioritized work queue

Update CHANGELOG.md at the end of every session with what changed and why.

---

## Current State

All core features and Social Currency Phases 1–4 are live at [breakerz.vercel.app](https://breakerz.vercel.app).

**Admin pipeline** ✅
1. Product creation
2. Checklist import — 3-step wizard, Topps PDF + Panini CSV
3. CardHedger matching — Claude-powered (Haiku), chunked polling, ~90%+ auto-match rate
4. Odds import — coordinate-aware Topps PDF parser; standalone upload on product dashboard
5. Product readiness dashboard — match %, odds status, unmatched variants list, re-run matching
6. Breakerz Bets debrief — natural language → Claude parses player mentions + sentiment → admin review table → saves B-scores to DB

**Social Currency** ✅
- **Phase 1 — B-score:** `breakerz_score` + `breakerz_note` on `player_products`; editorial layer entered via debrief; feeds into slot cost formula
- **Phase 2 — Icon tier:** `is_icon` on `players`; icon players skip the buzz multiplier (structural demand already in EV)
- **Phase 3 — Risk Flags + HV:** `player_risk_flags` table (soft-delete); `is_high_volatility` on `player_products`; disclosure-only, no price effect
- **Phase 4 — Consumer indicators:** ★ / ↑↓ / ⚡ / ⚑ badges on break page TeamSlotsTable and PlayerTable

**Next up (see BACKLOG.md):**
- B-score decay / expiry indicator
- Pricing cache scheduled refresh (Vercel Cron)
- Phase 5: C-score from CardHedger top-movers (blocked on Kyle confirming API structure)

**Active design work:**
- Consumer UI redesign in progress — "Bloomberg terminal for card breaks"
- Design brief at `design-assets/figma-make-prompt.md`
- Figma MCP configured globally — when a Figma file URL is shared, Claude can read it directly

---

## Stack

- **Framework:** Next.js 15 App Router (TypeScript)
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** Supabase (Postgres)
- **Pricing API:** CardHedger (`https://api.cardhedger.com`)
- **AI:** Claude Haiku (`claude-haiku-4-5-20251001`) — analysis narratives, CardHedger matching, Bets debrief parsing
- **Deploy:** Vercel (CLI, not GitHub Actions)
- **Design:** Figma (Figma Make for concept generation; Figma MCP for implementation handoff)

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
| `ANTHROPIC_API_KEY` | Anthropic API key (server only, used for Claude-powered features) |

For local dev, put these in `.env.local` (not committed).

---

## MCP Servers

### Supabase (project-level)
Configured in `.mcp.json` at the repo root. Connects Claude directly to the live Supabase project — use it to inspect tables, run queries, and verify data without leaving Claude Code.

**Project ref:** `zucuzhtiitibsvryenpi`

### Figma (global)
Configured in `~/.claude/mcp.json`. Connects Claude to Figma files via OAuth.

**How to use:** Share a Figma file URL in the chat. Claude can read component structure, design tokens, spacing, and layout to implement designs accurately.

**When to use:** After a design direction has been chosen and refined in Figma — not during early concept exploration. Paste the Figma file URL and ask Claude to implement a specific screen or component.

**Auth:** First use triggers an OAuth flow in the browser. Re-authenticates automatically after that.

---

## Design Workflow

1. **Concept generation** — use Figma Make with the prompt in `design-assets/figma-make-prompt.md`
2. **Direction selection** — pick one of the generated concepts and refine in Figma
3. **Implementation** — share the Figma file URL with Claude; use the Figma MCP to read specs and generate code

Design brief: `design-assets/figma-make-prompt.md`
Direction: "Bloomberg terminal for card breaks" — data-dense, dark-first, monospace numbers, analytical authority

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

### 3. `hobbyEVPerBox` not cached

`pricing_cache` stores `ev_low/mid/high` but not `hobbyEVPerBox` (the odds-weighted EV). Cached loads fall back to `evMid`. The odds-weighted calculation only applies during a live POST fetch. In backlog — requires a schema change to fix.

---

## Key Files

```
lib/
  supabase.ts          — Supabase client (see gotcha above)
  cardhedger.ts        — CardHedger API client (server-side only)
  engine.ts            — Break pricing engine; exports computeSlotPricing,
                         computeTeamSlotPricing, computeEffectiveScore
  checklist-parser.ts  — PDF/CSV checklist parsers
  types.ts             — Shared TypeScript types (Player, PlayerProduct,
                         PlayerWithPricing, PlayerRiskFlag, etc.)

app/
  break/[slug]/        — Public break analysis page (Team Slots, Player Slots tabs)
  analysis/            — Breakerz Sayz deal analyzer
  admin/
    products/          — Product listing
    products/[id]/     — Product readiness dashboard + Breakerz Bets debrief
      BreakerzBetsDebrief.tsx  — Debrief UI (narrative → Claude → review table → save)
      OddsUpload.tsx           — Standalone odds PDF upload
      RunMatchingButton.tsx    — Re-run CardHedger matching
    products/[id]/players/     — Player management, flags, icon/HV toggles
      PlayerFlagsManager.tsx   — Icon ★, HV ⚡, risk flag ⚑ per player

app/api/
  pricing/             — GET: cached pricing; POST: live CardHedger fetch + cache write
  analysis/            — POST: full Sayz analysis (fair value + signal + Claude narrative)
  admin/
    parse-bets-debrief/ — POST: narrative → Claude → matched player scores
    parse-checklist/   — POST: PDF or CSV → ParsedChecklist
    parse-odds/        — POST: Topps odds PDF → ParsedOdds
    import-checklist/  — POST: upsert players, player_products, variants
    match-cardhedger/  — POST: auto-link variants to CardHedger card IDs
    apply-odds/        — POST: write pull rates to variants from odds PDF
    products/          — GET: product list for admin dropdowns

components/breakerz/
  TeamSlotsTable.tsx   — Team slots table with Social Currency badges (★ ↑↓ ⚡ ⚑)
  PlayerTable.tsx      — Player table with Social Currency badges per row
  DashboardConfig.tsx  — Case count + cost config panel
  BreakerComparison.tsx — Breaker Compare tab

design-assets/
  figma-make-prompt.md — Full design brief for Figma Make concept generation

docs/
  BACKLOG.md           — Prioritized work queue + long-term vision
  QA.md                — Manual test checklist (Round 1 results recorded)
  prd-social-currency.md — Social Currency PRD (Phases 1–5)

supabase/
  migrations/          — All schema migrations (apply with: supabase db push --linked)
  schema.sql           — Full schema + seed data
```

---

## Database Schema (summary)

```
sports                → basketball, baseball, football
products              → e.g. "Topps Finest Basketball 2025-26"
players               → cross-product player identity; is_icon boolean
player_products       → player × product; buzz_score, breakerz_score,
                        breakerz_note, is_high_volatility
player_product_variants → card types per player per product; hobby_odds, breaker_odds
pricing_cache         → 24h TTL cache of EV low/mid/high per player_product
player_risk_flags     → soft-delete risk flags (cleared_at); injury/suspension/legal/trade/retirement/off_field
```

---

## Pricing Model

```
effectiveScore = clamp(buzz_score + breakerz_score, -0.9, 1.0)
              → 0 if player.is_icon (icon guard)

hobbyWeight   = hobbyEVPerBox × (1 + effectiveScore)   [0 if hobby_sets = 0]
slotCost      = breakCost × (hobbyWeight / Σ hobbyWeights)
```

`hobbyEVPerBox` = odds-weighted EV: `Σ(variantEV × 1/hobby_odds)`. Falls back to `evMid` when no odds are available or on cached GET loads.

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

## Database Migrations

Supabase CLI is linked and authenticated — no Docker required for migrations.

```bash
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
