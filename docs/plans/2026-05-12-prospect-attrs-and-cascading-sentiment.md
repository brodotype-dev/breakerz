# Prospect attributes (objective) + multi-scope sentiment (Discord-only) — a two-track player-attribute layer

## Context

Kyle shared `~/Downloads/2026_Bowman_BreakIQ_CrossRef.xlsx` — a player-level cross-reference for 2026 Bowman Baseball mixing objective player attributes (MLB Pipeline Top 100 rank, NPB signee status, graduated MLB rookie status) with subjective interpretation (PDF Team Tier `GREAT/GOOD/OK/BAD/AWFUL`, suggested PYT multiplier `0.7x–5.0x`).

**Brody's product-management concern:** consuming Kyle's tier interpretation as a bulk import makes BreakIQ "an SME's opinion times data" instead of a transparent data product. Kyle's attribution gets laundered into anonymous engine constants.

**Final framing (Brody-confirmed):** clean two-track architecture.

- **Track A — Objective:** import-friendly. Pipeline rank, NPB signee, graduated_rc, 1st Chrome / 1st Auto flags. These come from external institutions (MLB Pipeline, ESPN Big Board, NHL Central Scouting). Bulk-import via admin CSV is fine — the source attribution is the institution, not a person.
- **Track B — Subjective:** Discord-only. Team tier intuition, product hype, "this combo is stacked" calls. These flow exclusively through `lib/insights-parser.ts` (BreakIQ Insights) so every contribution is attributed to a real Discord user with a real narrative. **No bulk-import path for Layer 2.** The friction is intentional — Kyle has to actually type "/insight Royals are stacked this year" to put that opinion into the engine. His name and his words go on the record for every one.

Both tracks contribute to the same `effectiveScore` clamp. Together they let the engine express how breakers actually think — combining institutional consensus (Pipeline rank) with SME judgment (Kyle's instincts about specific rosters) — without conflating the two.

**User confirmed:**
- **Multi-sport** (MLB, NFL, NBA, NHL) — platform capability
- **Keep** the existing `[-0.9, +1.0]` effectiveScore clamp
- **Subjective signals MUST flow through Discord** (BreakIQ Insights) to preserve attribution — no bulk-import shortcut for Layer 2

---

## Track A — Objective prospect attributes (bulk-importable)

### Schema

Add to `players` (sport-agnostic):
- `prospect_rank integer NULL` — ordinal rank within sport's pipeline (1 = top)
- `prospect_status text NULL` — `'graduated_rc' | 'international_signee' | NULL`
- `prospect_rank_source text NULL` — institutional provenance: `"MLB Pipeline 2026-05"`, `"ESPN Big Board 2025-11"`, `"NHL Central Scouting 2026-04"`, `"PFF Top 50 2026"`
- `prospect_rank_updated_at timestamptz NULL`

One column set, all sports. The 1st Chrome / 1st Auto flags are NOT stored — derivable at query time from `player_product_variants.card_number` prefix (`CPA-*`, `BMA-*`, etc.).

### Code — `lib/prospect-score.ts` (new)

```ts
export const PROSPECT_RANK_TIERS = [
  { maxRank: 10,  bump: 0.60 },
  { maxRank: 30,  bump: 0.40 },
  { maxRank: 100, bump: 0.20 },
];

export const PROSPECT_STATUS_BUMP: Record<string, number> = {
  graduated_rc:         0.15,
  international_signee: 0.10,
};

export const SPORT_PROSPECT_MULTIPLIER: Record<string, number> = {
  baseball:   1.0,
  basketball: 0.9,
  football:   0.7,
  hockey:     0.6,
};

export const PROSPECT_SCORE_CAP = 0.70;

export function computeProspectAdjustment(p: {
  prospect_rank: number | null;
  prospect_status: string | null;
  sport: string | null;
}): number {
  const sportMul = SPORT_PROSPECT_MULTIPLIER[(p.sport ?? '').toLowerCase()] ?? 0;
  if (!sportMul) return 0;
  let base = 0;
  if (p.prospect_rank != null) {
    const tier = PROSPECT_RANK_TIERS.find(t => p.prospect_rank! <= t.maxRank);
    if (tier) base += tier.bump;
  }
  if (p.prospect_status && PROSPECT_STATUS_BUMP[p.prospect_status]) {
    base += PROSPECT_STATUS_BUMP[p.prospect_status];
  }
  return Math.min(PROSPECT_SCORE_CAP, sportMul * base);
}
```

### Importer — `app/api/admin/import-prospect-ranks/route.ts` (new)

Accepts CSV with columns: `sport, player_name, prospect_rank, prospect_status, source`. Fuzz-matches `(player_name, sport_id)` to existing `players` rows (lowercase + diacritic-strip + edit-distance ≤ 2, reusing the BACKLOG team-name normalization fuzz-match utility). Unmatched rows surface for admin review.

**Source attribution is institutional.** Every import requires `source` ≠ a personal name. Acceptable: `"MLB Pipeline 2026-05"`. Rejected: `"Kyle"`.

For Kyle's CrossRef specifically — Phase 1 import path:
- The `Players (Full)` sheet gives us `prospect_rank` (from "Top 100" column), `prospect_status` (graduated MLB / NPB → mapped to enum), and `prospect_rank_source = "MLB Pipeline May 2026 via Kyle CrossRef"`
- The Team Summary / PDF Tier columns are SKIPPED at import time — those are Track B territory (see below)

### Per-sport landscape — Track A specifics

| Sport | Rank source | graduated_rc semantics | international_signee semantics |
|---|---|---|---|
| **MLB** | MLB Pipeline Top 100 (monthly) | Was Top 100, now active MLB in RC year (Anthony, Caglianone, Burns) | NPB / KBO / Cuban defectors (Imai, Okamoto, Murakami) |
| **NFL** | Consensus pre-draft (Kiper/Jeremiah/PFF/247Sports) | Drafted this past spring, currently in RC NFL year | Rare — International Pathway Program |
| **NBA** | ESPN Big Board / 247Sports composite | Drafted, in RC NBA year | EuroLeague imports (Wemby, Doncic precedent) |
| **NHL** | NHL Central Scouting / TSN McKenzie / EliteProspects | First Upper Deck Young Guns RC year — note: doesn't always align with prospect-rank year due to AHL development time | KHL / SHL / Liiga / Czech imports (heavy use) |

Sport-specific data lives in `prospect_rank_source` strings; no schema branching.

---

## Track B — Multi-scope sentiment via Discord (Discord-only by design)

### What this extends

`lib/insights-parser.ts` (the Discord `/insight` Claude parser, already in production). Today it handles:
- `sentiment` (player-scope or player-in-product-scope) — updates `breakerz_score`
- `hype_tag` (product-scope or variant-scope)
- `asking_price` (variant-scope eBay listings, stream asks, etc.)
- `risk_flag` (player-scope injury / suspension / legal / trade / retirement)
- `odds_observation` (product-scope pull rate intel)

### What we add

Three new scope-tagged sentiment types in the same parser, written to the same `market_observations` table:

| New observation_type | Example trigger phrase | Stored on |
|---|---|---|
| `team_sentiment` | "Royals are stacked this year" | `scope_team='Kansas City Royals'`, `product_id=NULL` |
| `product_sentiment` | "2026 Bowman Baseball is going to be huge" | `scope_team=NULL`, `product_id=<2026 Bowman pp_id>` |
| `team_product_sentiment` | "Pirates in 2026 Bowman are loaded" | `scope_team='Pittsburgh Pirates'`, `product_id=<2026 Bowman>` |

Each captures the same payload shape as existing hype observations:
```jsonc
{
  "direction": +1 | -1,
  "strength": 0..1,
  "decay_days": 14..60,
  "tag": "stacked_roster" | "loaded_class" | "buzz_dampening" | ...
}
```

Discord workflow stays identical: Kyle posts `/insight`, Claude parses it into proposed observations, bot replies with ✅/❌ buttons, on approval the observation lands in `market_observations` with `source_user_id`, `source_narrative`, `observed_at`.

### Bulk-import path for product-launch analyses

For product launches, SMEs realistically do batch analyses (like Kyle's CrossRef). Forcing 30 individual Discord messages is friction that ensures the work gets skipped, not done.

**Two valid Track B entry points, same governance:**

1. **Ad-hoc Discord** (`/insight ...`) — primary mode for ongoing intel. Low-friction, immediate, public to the channel.
2. **Bulk admin import** (`/api/admin/import-bulk-sentiment`) — for launch-time analyses. CSV upload with **per-row personal attribution**.

The bulk importer enforces the same governance as Discord:

- Every row REQUIRES a `source_user_id` (admin selects "from Kyle" / "from Brody" from a dropdown of allowlisted contributors at upload time)
- Every row REQUIRES a `source_narrative` — the SME's actual take in their own words, not an auto-generated label. CSV rejects rows where `source_narrative` is empty, generic ("good team"), or templated from a tier letter
- Each import is logged with an `import_batch_id` traceable to: who uploaded, when, what file, what SME authorship was claimed
- Same `observation_type` set (`team_sentiment` / `product_sentiment` / `team_product_sentiment`)
- Same decay clocks (default 30 days, configurable per row)
- Same supersedence logic — if Kyle does a follow-up analysis 30 days later, new observations supersede old via the `superseded_at` mechanism

**CSV columns:** `sport, team_name, product_slug (optional), direction, strength, decay_days, source_narrative`. The admin upload form prompts for `source_user_id` once (applies to all rows in the batch).

**What's blocked at the bulk-import level:**

- ❌ Anonymous imports (`source_user_id` required)
- ❌ Generic narratives (each row's `source_narrative` must be ≥30 chars of SME-specific reasoning)
- ❌ Auto-generated content from tier letters alone (the importer rejects "GREAT → +1, 0.8" without a written justification per row)
- ❌ Institutional sources (`source="MLB Pipeline"` is rejected for Track B; that's Track A territory)

**Kyle's CrossRef mapping in this flow:**

- Team Summary sheet → CSV per row with Kyle's actual scouting notes per team in `source_narrative`
- "GREAT / GOOD / OK / BAD / AWFUL" tier maps to direction+strength but is NOT sufficient on its own — Kyle still writes a narrative per row explaining WHY he says GREAT vs GOOD
- "OK" tier rows are dropped (no observation written)
- All rows imported as `source_user_id=Kyle, import_batch_id=<batch>, source_narrative="<Kyle's per-team take>"`

The friction stays at the same point — Kyle still has to articulate his reasoning per team. The mechanism just allows him to do it in a spreadsheet first instead of 30 Discord messages.

### Analysis input — a Claude skill that captures SME narration, outputs a structured Markdown file

The bulk importer's biggest failure mode is unstructured SME input. The traditional answer (a locked XLSX template with dropdowns) misreads how SMEs actually work in 2026 — Kyle and contributors like him don't sit down and fill spreadsheets. They talk to Claude. They drop a voice memo. They ramble through their notes.

The right tool is a **Claude skill** that turns that natural workflow into a structured artifact. Skill captures the narration → skill formats the output → output is a `.md` file the SME uploads to the bulk importer. No XLSX, no dropdowns, no data-validation gymnastics in Excel.

#### Skill — `.claude/skills/breakiq-product-analysis/SKILL.md`

**Source of truth lives in the repo** for version control and maintenance. **Distributed to non-developer SMEs (Kyle, future contributors) as a zip** they load into Claude desktop / Claude Cowork via the standard skill-install flow. SMEs never touch git, the repo, or `npm install` anything.

**Distribution flow:**

- Skill source: `.claude/skills/breakiq-product-analysis/` (Brody maintains here)
- Build step: `scripts/package-analysis-skill.mjs` zips the skill folder into `public/breakiq-product-analysis-skill-v{N}.zip` (versioned filename for cache-busting)
- Brody runs the script after meaningful changes; commits the new zip into the repo's `public/` directory so it ships with Vercel deploys
- Kyle downloads the latest zip from `https://getbreakiq.com/breakiq-product-analysis-skill-v{N}.zip` (admin can paste the link into Slack/email/wherever Kyle works)
- Kyle loads the zip into his Claude environment via the standard skill-install UI — that's it. No CLI, no terminal, no developer ceremony

**Runtime portability constraint:** because Kyle's Claude environment doesn't have the BreakIQ Supabase MCP, the skill **cannot query the DB at runtime** for product/team data. Everything the skill needs to operate must be bundled as static reference files in the zip.

This shifts two things from the earlier design:

- Active-product list moves from "runtime DB query" → "SME types the product name; skill normalizes heuristically to the slug." Frontmatter `product_slug` is validated at import time (admin side) when the `.md` is uploaded back to BreakIQ
- Canonical team names per sport are bundled as a static reference file. Acceptable drift — team rosters change rarely; team names almost never. Brody regenerates the zip and re-shares if anything material changes

**Triggers:** "I want to analyze 2026 Bowman", "let me record my take on this product", "product breakdown for the [team] in [product]", "going through the teams for [product]", or explicit invocation `/breakiq-product-analysis`.

**Workflow the skill drives:**

1. **Confirm product** — asks "Which product are you analyzing?" SME types the name; skill normalizes to a slug heuristically (e.g. "2026 Bowman Baseball" → `2026-bowman-baseball`). Confirms with SME before writing to frontmatter.
2. **Confirm SME identity** — picks from allowlisted contributors (Kyle / Brody / others); maps to `source_user_id`. Allowlist bundled in the zip's reference files
3. **Optional product-level take** — "Do you want to give an overall take on this product before going team by team?" If yes, captures narrative → product_sentiment
4. **Team-by-team loop** — for each team in the product's roster:
   - "What's your take on the [Royals] in [2026 Bowman]?"
   - SME narrates freely (voice memo, typed paragraph, bullet stream, whatever)
   - Skill EXTRACTS: tier guess (GREAT/GOOD/OK/BAD/AWFUL), direction (+1/0/-1), strength (0..1), narrative (the SME's verbatim words, lightly cleaned)
   - Skill CONFIRMS with the SME before moving on ("I heard you say the Royals are GREAT with strong positive direction at 0.8 because [verbatim]. Sound right?")
   - If SME says no or wants OK (neutral), skill drops the row
5. **Sanity-check pass** — at the end, skill summarizes ("8 teams GREAT, 4 GOOD, 12 OK (dropped), 4 BAD, 2 AWFUL") and asks for confirmation
6. **Output the artifact** — writes a structured `.md` file to a default location (e.g. `~/Downloads/breakiq-analysis-{product-slug}-{date}.md`)

**Skill reference files (all bundled in the zip, no runtime DB access):**

- `reference/tier-guide.md` — what each tier means + example narratives that earned each tier in past analyses
- `reference/canonical-teams.md` — exact team name strings per sport (so the skill outputs "Kansas City Royals" not "Royals" or "KC Royals")
- `reference/output-format.md` — the canonical Markdown structure the bulk importer expects, with one fully-filled example
- `reference/sme-allowlist.md` — list of approved SMEs the skill should accept for `analysis_by` frontmatter
- `reference/products.md` — snapshot of currently-active products with slugs; intentionally a periodic-regen artifact, not live

#### Output Markdown shape

```markdown
---
analysis_for: 2026 Bowman Baseball
analysis_by: Kyle
analysis_date: 2026-05-12
sport: baseball
product_slug: 2026-bowman-baseball
---

# Product-level take

**tier:** GREAT
**direction:** +1
**strength:** 0.7
**decay_days:** 60

> 2026 Bowman is the loaded class. Griffin, McGonigle, Clark, Holliday, De Vries all in one product — this is going to print money for the next 18 months. Comparable in upside to 2020 Bowman but with deeper top-tier depth.

# Per-team takes

## Kansas City Royals · GREAT · +1 · 0.8

> Caglianone graduates this year but Hammond's CPA + Mitchell's 1st Chrome + the rest of the depth makes Royals one of the best PYT plays in the product. Don't get cute, just pay.

## Pittsburgh Pirates · GREAT · +1 · 0.8

> Konnor Griffin is the #1 prospect in baseball plus Florentino at #50 plus the Pirates' insistence on stockpiling power arms. Top-of-the-class slot for the next two years minimum.

## Detroit Tigers · GREAT · +1 · 0.85

> McGonigle and Clark are both top-10 prospects. Two #1-overall-quality bats in one team's chunk of a product is generational.

## Athletics · GOOD · +1 · 0.6

> Leo De Vries is the headliner at #4 but the rest is thinner than the headline suggests. Worth a chase, not worth doubling up.

## Atlanta Braves · OK · 0 · 0
<!-- Dropped at import: tier=OK is neutral -->

## ...
```

**Importer parses this shape** directly. YAML frontmatter → batch metadata. H1 "Product-level take" → product_sentiment observation. Each H2 → team_sentiment observation with `scope_team` from the heading, direction/strength from the metadata line, narrative from the blockquote. OK-tier sections are skipped per the dropped-row rule.

#### Why this beats XLSX

- **Matches actual SME workflow** (voice/conversation, not spreadsheets)
- **Narratives are richer** — Kyle's full sentences instead of cramming into a CSV cell
- **Single artifact for two audiences** — same Markdown file is both human-readable (Kyle can share it with breakers as his analysis writeup) AND machine-readable (importer extracts the structured pieces)
- **No drift between schema and template** — the skill IS the schema. When the importer evolves, the skill's reference files update; no separate XLSX to regenerate
- **Discoverable in Claude Code** — Kyle opens his terminal in the repo, says "analyze 2026 Bowman," skill auto-triggers
- **Tier shorthand preserved** — skill enforces the GREAT/GOOD/OK/BAD/AWFUL vocabulary; SME doesn't have to remember direction/strength conversions; the skill computes them and asks for confirmation

**Tier → direction/strength mapping** (encoded in the skill's reference, surfaced during the confirmation step):

| Tier | Default direction | Default strength | Treatment |
|---|---|---|---|
| GREAT | +1 | 0.8 | Strong positive |
| GOOD | +1 | 0.5 | Moderate positive |
| OK | 0 | 0 | **Row dropped at import** — neutral generates no observation |
| BAD | -1 | 0.4 | Moderate negative |
| AWFUL | -1 | 0.7 | Strong negative |

The narrative is the source of truth. Tier is shorthand. Skill overrides happen in conversation ("the Royals are GOOD but I'm REALLY confident, bump that strength to 0.7") — natural language, not cell editing.

### Engine cascade — `lib/cascading-sentiment.ts` (new)

Reads active (non-superseded, non-expired) observations of the three new scopes for a given player_product, plus the existing player-scope hype/sentiment observations. Sums with per-scope caps:

| Scope | Cap | Why this cap |
|---|---|---|
| Player (existing hype + sentiment) | ±0.50 | Most specific; SME pointing at one player |
| `team_product_sentiment` | ±0.25 | Narrow intersection — stronger weight allowed |
| `team_sentiment` | ±0.20 | Larger blast radius (all players on that team across all products) |
| `product_sentiment` | ±0.15 | Largest blast radius (all players in that product) |
| **Combined cascade cap** | **±0.65** | Sums to under +1.0 ceiling with prospect_score |

Per-sport multiplier scales the cascade contribution the same way as prospect_score:

```ts
SPORT_CASCADE_MULTIPLIER: Record<string, number> = {
  baseball: 1.0, basketball: 0.9, football: 0.7, hockey: 0.6,
};
```

### Engine integration — `lib/engine.ts`

Two new parameters in `computeEffectiveScore`:

```ts
export function computeEffectiveScore(
  buzzScore, breakerzScore, isIcon,
  riskScoreAdj = 0, hypeScoreAdj = 0,
  prospectScoreAdj = 0,   // Track A
  cascadeScoreAdj = 0,    // Track B
) {
  if (isIcon) return 0;
  return Math.max(-0.9, Math.min(1.0,
    (buzzScore ?? 0) + (breakerzScore ?? 0)
    + (riskScoreAdj ?? 0) + (hypeScoreAdj ?? 0)
    + (prospectScoreAdj ?? 0) + (cascadeScoreAdj ?? 0)
  ));
}
```

Per-sport multiplier applies to both — they're separate inputs but tuned with the same sport-awareness.

---

## Why the two tracks deserve separate channels

Same engine math, different governance:

| Concern | Track A (objective) | Track B (subjective) |
|---|---|---|
| **Who can write** | Admin via CSV import; (future) automated scraper | Allowlisted Discord contributors via `/insight` **OR** admin bulk-import-with-attribution for launch analyses |
| **Attribution** | Institutional (`"MLB Pipeline 2026-05"`) | Personal (`source_user_id` = Kyle's Discord ID) |
| **Decay** | Slow (90d default) — consensus data shifts slowly | Faster (30d default) — opinions go stale |
| **Audit trail** | One row per import batch | One row per observation, with `source_narrative` |
| **Override-able** | New import overwrites the player attribute cache | New observation supersedes prior (via `superseded_at`) |
| **What it captures** | "This player ranks here in their pipeline" | "This SME thinks this team / product / combo is hot" |

Mixing them risks Kyle's opinion being treated like consensus data, or consensus data being treated like one expert's take. The separation makes both inputs honest.

---

## Cascade output transparency (mandatory before shipping)

The "why is this slot priced this way" surface — auditable to source for every contribution:

```
Konnor Griffin · 2026 Bowman Baseball — slot weight breakdown:
  evMid (CH):                        $245
  buzz_score:                        +0.00
  breakerz_score:                    +0.00
  Risk flags:                        +0.00
  Hype tags:                         +0.00
  Track A — prospect_score:          +0.42
    └─ prospect_rank #1 (MLB Pipeline 2026-05)
  Track B — cascade sentiment:       +0.13
    ├─ team: "Pirates stacked"      +0.10 (Kyle Discord 2026-05-10, 28d left)
    └─ product: "2026 Bowman hot"   +0.03 (Brody Discord 2026-05-11, 45d left)
  Effective score:                   +0.55
  Slot weight: evMid × 1.55 = $379.75
```

Build this UI concurrently with the engine integration, not after. SMEs need to trust the cascade or they'll stop contributing.

---

## Phased rollout

### Phase 1 — Track A schema + Kyle's CrossRef objective import (~1 day)
- Migration: 4 new columns on `players`
- `lib/prospect-score.ts` module
- `app/api/admin/import-prospect-ranks/route.ts`
- Engine integration: thread `prospectScoreAdj` through `computeEffectiveScore` + `computeSlotPricing`
- Import Kyle's CrossRef Players (Full) sheet — Pipeline rank, NPB, graduated_rc only. Source attribution = `"MLB Pipeline 2026-05 via Kyle CrossRef"`. NOT importing the PDF Team Tier or PYT Multiplier columns.

### Phase 2 — Track B Discord parser extension + cascade reader (~1 day)
- Parser rules in `lib/insights-parser.ts` for `team_sentiment`, `product_sentiment`, `team_product_sentiment`
- Migration: extend CHECK constraint on `market_observations.observation_type`
- `lib/cascading-sentiment.ts` reader + per-scope caps + sport multiplier
- Engine integration: thread `cascadeScoreAdj` through `computeEffectiveScore`
- Discord ✅/❌ approval flow uses existing infrastructure (no new code)

### Phase 2.5 — Claude skill (zip-distributable for non-dev SMEs) + Markdown bulk importer (~1.5 days)

**Skill source (in-repo, version-controlled):**
- `.claude/skills/breakiq-product-analysis/SKILL.md` — skill that walks SMEs through product analysis conversationally, outputs a structured `.md` file
- `.claude/skills/breakiq-product-analysis/reference/tier-guide.md` — tier semantics + example narratives
- `.claude/skills/breakiq-product-analysis/reference/canonical-teams.md` — exact team name strings per sport
- `.claude/skills/breakiq-product-analysis/reference/output-format.md` — canonical Markdown shape with one fully-filled example
- `.claude/skills/breakiq-product-analysis/reference/sme-allowlist.md` — approved SME names for `analysis_by`
- `.claude/skills/breakiq-product-analysis/reference/products.md` — periodic snapshot of active products + slugs

**Skill distribution (zip-export pipeline):**
- `scripts/package-analysis-skill.mjs` — packages the skill folder into `public/breakiq-product-analysis-skill-v{N}.zip` with versioned filename for cache-busting
- Brody runs the script after meaningful changes; commits the new zip into `public/` so Vercel deploys ship it
- Kyle downloads from `https://getbreakiq.com/breakiq-product-analysis-skill-v{N}.zip` (Brody shares the link via Slack/email when a new version exists)
- Kyle loads the zip into Claude desktop / Claude Cowork via the standard skill-install UI — no CLI, no developer ceremony

**Server side (Markdown ingestion):**
- `lib/analysis-markdown-parser.ts` — parses the skill's output: YAML frontmatter → batch metadata, H2 sections → per-team observations
- `app/api/admin/import-bulk-sentiment/route.ts` — accepts a `.md` file upload; parses via the markdown parser; validates against per-row attribution requirement; writes observations
- `app/admin/products/[id]/BulkSentimentUpload.tsx` — admin UI panel on the product dashboard, mirroring OddsUpload / HydrateVariantsButton / RefreshPricingButton. File picker (`.md`) + SME-from-allowlist dropdown + preview screen showing each parsed observation (with verbatim narrative) before commit. Validates that uploaded markdown's frontmatter `product_slug` matches the page's product (or rejects with a clear "wrong product" error)
- Reject rules: empty/generic narratives (<30 chars in the blockquote), anonymous batches, institutional sources in frontmatter, unknown teams (after canonicalization), out-of-range strengths, frontmatter `product_slug` ≠ page's product
- `import_batch_id` logged with file hash, uploader, claimed SME, timestamp, skill version (from frontmatter), row counts
- Validates against same observation_type CHECK constraint + scope caps as the Discord path

### Phase 3 — Transparency UI (~½ day)
- `/api/pricing` response includes per-player cascade breakdown
- Admin `/admin/products/[id]/sentiment-breakdown` panel renders it
- Consumer surface decision deferred — may show simplified version on `/break/[slug]`

### Phase 4 — Multi-sport ingestion (per-sport effort, ongoing)
- Per-sport CSV templates for NBA Big Board, NFL consensus, NHL Central Scouting
- Tune `SPORT_PROSPECT_MULTIPLIER` and `SPORT_CASCADE_MULTIPLIER` from initial sales-data feedback

### Phase 5 (deferred) — Automated Pipeline ingestion
- Scraper for mlb.com/pipeline with diff detection
- Same for ESPN Big Board, NHL Central Scouting
- Writes via the same `import-prospect-ranks` flow

---

## What we are explicitly NOT building

- ❌ **PDF Team Tier bulk import** — Kyle's GREAT/GOOD/OK/BAD/AWFUL is subjective. Track B Discord path only.
- ❌ **PYT Multiplier as a stored field** — derived from cascade math, not hardcoded.
- ❌ **LTWR import** — subjective ranking; even sketchier than the PDF Tier. Skip entirely.
- ❌ **1st Chrome / 1st Auto flags as stored fields** — derivable from variant card_number prefixes.
- ❌ **Track B bulk import WITHOUT per-row personal attribution** — the bulk importer exists (for launch analyses) but rejects anonymous rows, generic narratives, and tier-letter-only entries. Every observation traces to a real human's named take.
- ❌ **Per-sport schema branching** — same columns + same observation table for all four sports.
- ❌ **Mixing prospect_rank source attribution with personal names** — institution-only for Track A.

---

## Critical files

### New
- `supabase/migrations/<ts>_players_prospect_attributes.sql` — 4 new columns on `players`
- `supabase/migrations/<ts>_observation_type_cascade.sql` — extend CHECK constraint
- `lib/prospect-score.ts` — Track A scoring module
- `lib/cascading-sentiment.ts` — Track B observation reader + per-scope caps
- `lib/analysis-markdown-parser.ts` — parses the skill's `.md` output into structured observations for the importer
- `.claude/skills/breakiq-product-analysis/SKILL.md` — Claude skill source (zip-exportable for SMEs)
- `.claude/skills/breakiq-product-analysis/reference/{tier-guide,canonical-teams,output-format,sme-allowlist,products}.md` — skill reference files (bundled in the zip)
- `scripts/package-analysis-skill.mjs` — packages the skill folder into a versioned `.zip` for SME distribution
- `public/breakiq-product-analysis-skill-v1.zip` — first packaged version of the skill, served by Vercel for SME download
- `app/api/admin/import-prospect-ranks/route.ts` — Track A CSV importer with institutional-attribution requirement
- `app/api/admin/import-bulk-sentiment/route.ts` — Track B Markdown importer with per-row personal-attribution requirement
- `app/admin/products/[id]/sentiment-breakdown/page.tsx` — transparency UI
- `app/admin/products/[id]/BulkSentimentUpload.tsx` — admin panel on the product dashboard (file picker + SME dropdown + parsed-observation preview before commit). Same pattern as `OddsUpload.tsx` / `HydrateVariantsButton.tsx` already on that page

### Modified
- `lib/insights-parser.ts` — new parser rules for team/product/team_product sentiment scopes
- `lib/engine.ts` — add `prospectScoreAdj` and `cascadeScoreAdj` to `computeEffectiveScore` + `computeSlotPricing`
- `lib/types.ts` — `PlayerWithPricing.prospect_score_adj` + `cascade_score_adj` + `prospect_breakdown` (for UI)
- `lib/pricing-refresh.ts` — populate both adjustments per pp at refresh
- `app/api/pricing/route.ts` — include breakdown in response
- `app/api/discord/interactions/route.ts` — dispatcher for new scope types
- `docs/score-modulation.md` — document both tracks + per-scope caps + sport multipliers

### Reused unchanged
- `market_observations` table — new types via constraint relaxation only
- `lib/score-modulation.ts` — existing risk + hype paths unchanged
- `lib/market-markup.ts` + `freshnessMultiplier` — composes multiplicatively, no changes
- Discord ✅/❌ approval flow — handles new observation types transparently

---

## Verification

1. **Track A migration** — `\d players` shows 4 new columns; defaults NULL.
2. **Track A import** — convert Kyle's `Players (Full)` sheet to CSV (rank, status, source columns only). Run through importer. Verify 17 active Top 100 MLB players + 6 graduated_rc + 3 international_signee land in `players` with `prospect_rank_source="MLB Pipeline May 2026 via Kyle CrossRef"`. Verify no PDF Tier or PYT Multiplier data made it into the DB.
3. **Track A scoring** — write SQL setting Konnor Griffin's `prospect_rank=1`. Re-refresh pricing. His `prospect_score_adj` should compute to `1.0 (baseball) × 0.60 (rank tier 1-10) = +0.60`. Pirates team slot rises proportionally.
4. **Source-attribution governance** — try to import a CSV with `source="Kyle"`. Importer should reject with "source must be an institutional attribution (e.g. 'MLB Pipeline 2026-05'), not a personal name."
5. **Track B parser** — Discord: `/insight Royals are stacked this year`. Bot proposes a `team_sentiment` observation with direction=+1, strength=0.6, decay=30, scope_team="Kansas City Royals". On ✅, lands in `market_observations`. Next pricing refresh should bump all Royals pps by `1.0 × 0.20 × 0.6 × decay = +0.12`.
6. **Cascade combination** — for a Royals player who's also a Top 100 prospect: prospect_score_adj (+X) + cascade_score_adj (+0.12) sum into effectiveScore, both visible in breakdown UI.
7. **Cap enforcement** — layer 5 positive team_sentiment observations on one team. Verify the team-scope sum never exceeds +0.20 contribution.
8. **Decay** — write observation with decay_days=10. Verify contribution decays to 0 by day 10.
9. **Per-sport multiplier** — same Track A + Track B setup on a hockey pp shows 60% of the contribution that the same data shows on a baseball pp.
10. **Transparency UI** — `/api/pricing` response includes `prospect_breakdown` AND `cascade_breakdown` arrays. Admin diagnostic at `/admin/products/[id]/sentiment-breakdown` renders both with source attribution for every contribution.
11. **Track B bulk-import governance** — upload a CSV missing `source_user_id` → rejected. Upload a CSV with row narratives ≤30 chars → those rows rejected with row-numbers surfaced. Upload a CSV with `source` = institutional name → rejected. Upload a clean CSV with Kyle as source + per-row narratives → 30 team_sentiment observations land, all attributable, all linked to one `import_batch_id`.
12. **Bulk-import vs Discord parity** — the bulk-imported observations behave identically to Discord-written observations: same caps, same decay, same supersedence, same effect on engine math.
13. **Skill round-trip** — open Claude Code in the repo. Type "analyze 2026 Bowman Baseball". Skill auto-triggers, picks the product, asks for SME identity, walks team-by-team capturing narration. At end, outputs `~/Downloads/breakiq-analysis-2026-bowman-baseball-2026-05-12.md`. Inspect file: YAML frontmatter complete, each H2 is a canonical team name with `tier · direction · strength` line and a blockquote narrative.
14. **Markdown parser round-trip** — upload the skill's output `.md` to the bulk importer. Parser extracts frontmatter (sport, product, SME, date), creates one product_sentiment observation from the H1 section, creates 30 team_sentiment observations from H2 sections, drops OK-tier rows automatically. Preview screen shows each parsed observation with the verbatim narrative for confirm.
15. **Composition with freshness multiplier** — pre-release product: pricing_cache evMid reflects BOTH freshness premium (~1.15) AND prospect + cascade boosts. Verify multiplicatively.

---

## What this changes — short answer to "does this materially improve the model?"

**Yes — and the architecture matters as much as the new signal.**

The two tracks together let the engine express:
1. **Institutional consensus** about prospect quality (Track A: MLB Pipeline, ESPN Big Board, etc.)
2. **SME judgment** about teams / products / specific combos (Track B: Kyle's Discord intel)

Without conflating them.

For **fresh prospect products** (Bowman, Bowman Draft, NBA pre-Topps-Chrome, NFL post-draft): both tracks contribute meaningfully because CH data is thin. Track A captures "Konnor Griffin is the #1 prospect." Track B lets Kyle say "Pirates farm system is stacked, AND specifically 2026 Bowman is the loaded class."

For **mature products**: both tracks fade naturally. Prospect_rank still nudges but is small relative to settled CH prices. Cascade observations decay (30-60 days) and need to be re-confirmed via Discord to stay alive.

**For the product's identity:** this stays a data product. Track A is institutional data, transparently consumed via published formula. Track B is SME data, attributed to specific people with specific narratives at specific times. Neither becomes "BreakIQ's secret sauce that's actually Kyle's gut" — both are auditable, time-bounded, and override-able. Kyle's tier in the CrossRef doesn't become hardcoded engine constants; it becomes 30 dated Discord observations that decay if not re-confirmed. That's the line that matters.

**For multi-sport scaling:** Track A's schema is sport-agnostic; per-sport multipliers and per-sport rank sources handle the variation. Track B works automatically across sports — same Discord parser, same scope types, just different team/product names in the scope keys.

**For risk management:** the transparency UI is the safety net. If a slot looks weird, every contribution traces to a source. The model never becomes a black box.
