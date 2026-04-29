# Break Analysis v2 + Insight Capture

## Context

After a working session with Kyle (2026-04-28), several gaps in the BreakIQ break analysis surfaced. CardHedger pricing data is good but imperfect for our use case — particularly at release, for mid-tier variants, and for players whose sales don't cleanly entity-match on eBay. More importantly, the current consumer break analysis assumes a single product, a single format (hobby OR BD), and a single team or single player slot. That doesn't match how breaks are actually sold.

Separately, Kyle has a constant stream of market intelligence in his head (eBay browsing habits, breaker behavior, release-week patterns) that we have no mechanism to capture. BreakIQ Bets exists but only encodes player-level sentiment scores — it can't capture asking-price observations, release premiums, or hype tags.

Decisions confirmed with the user:
- **Phase 1 wedge:** Break composition v2 (mixed formats including jumbo, multi-team, multi-player).
- **Format scope:** Mixed formats *and* jumbo as a third format — single product per break for v1.
- **Insight capture:** Phased. Extend the existing global BreakIQ Bets first; dedicated mobile surface comes later.
- **Asking-price tracking:** Capture observed prices *and* show the range to consumers ("Streams asking $12k–$15k, our model says $9k").

## Synthesis of the Kyle session

**Break composition is more complex than "X hobby cases of one product."** Real breaks mix formats: 10 hobby + 5 BD, or hobby + jumbo + BD. Each format has its own case cost and odds. Whales especially buy multiple teams or specific players, sometimes bundle-priced. Players are buyable as standalone slots, not just as part of a team.

**Pricing data has structural gaps.** CardHedger entity matching is imperfect — sales on eBay don't always link to the right player/variant. 1/1 sales pollute averages (Austin Reaves slot at $4,400 because a 1/1 sold for $2,200). Mid-tier (orange/gold) variants are the right anchor for "fair price," but data sparsity is real. Pre-release / release-week resale runs ~20% higher than steady-state, decaying over the first few days — current model has no notion of this.

**Asking price vs. fair price.** Kyle wants consumers to see *both*: what streams are charging AND what BreakIQ thinks. The value prop is the delta — "they're asking $15k for Flagg, we think it's $9k." Just showing fair price without market context makes us look wrong when the market is actually wrong.

**The proactive-data principle.** CardHedger gives us reactive data. Kyle is the proactive source — he's constantly browsing eBay, watching breaks, noticing patterns. The job is to make it cheap enough for him to log observations that we accumulate enough structured input to identify reusable signals worth automating.

## Current State (verified in code)

- `lib/engine.ts:computeSlotPricing` — already returns BOTH `hobbySlotCost` AND `bdSlotCost` per player simultaneously. The single-format limitation is at the analysis/UI layer, not the engine.
- `lib/analysis.ts:runBreakAnalysis` — takes `{ productId, team, askPrice, breakType, numCases }`. Hardcoded single product, single team. Sets `hobbyCases` and `bdCases` to the same value as a defaulting hack, then `breakType` picks one.
- `app/(consumer)/analysis/page.tsx` — single-product dropdown, single-team dropdown, hobby/BD toggle, single askPrice. No multi-team, no player-only mode.
- `app/(consumer)/break/[slug]/page.tsx` — same single-format, single-product dashboard. Uses `<SegmentedControl>` for hobby/BD and a `<CounterInput>` for cases.
- `products` table: `hobby_case_cost`, `bd_case_cost`, `hobby_am_case_cost`, `bd_am_case_cost`. **No jumbo column.**
- `player_product_variants`: has `hobby_sets`, `bd_only_sets`, `hobby_odds`, `print_run`. **No jumbo_sets, no jumbo_odds.** `print_run` is populated — we can detect 1/1s today.
- `lib/cardhedger.ts:computeLiveEV` — aggregates 90-day comps via simple median. **No 1/1 / print-run filter.** This is the source of the Austin Reaves bug.
- `lib/pricing-refresh.ts` — aggregates per-variant EVs into per-player EV by `sets`-weighted average. Currently includes all variants regardless of print run.
- BreakIQ Bets: two flavors — per-product (`/admin/products/[id]` debrief) and global (`/admin/breakiq-betz`). Both parse free text via Claude → `breakerz_score` (-0.5 to +0.5) + `breakerz_note` on player_products. Admin-only. No asking-price or hype-tag concept.
- No mobile-specific admin routes today.

---

## Phase 1: Break Composition v2 (the immediate ship)

### Schema changes (`supabase/migrations/`)

1. `products`: add `jumbo_case_cost numeric`, `jumbo_am_case_cost numeric` (both nullable). Mirrors the hobby/bd pattern.
2. `player_product_variants`: add `jumbo_sets integer`, `jumbo_odds numeric` (both nullable). Mirrors `hobby_sets` / `hobby_odds`.
3. Backfill is a no-op — products without jumbo just leave the columns null and the format won't render.

Catalog hydration (`lib/variants-from-catalog.ts`, `lib/cardhedger-catalog.ts`) needs to know which CH variants are jumbo-only. **Open lookup question for the catalog logic** — defer the actual jumbo detection rules to a small follow-up; for v1 ship the schema and let admins manually mark jumbo via the variant editor if needed. Most of the value comes from the format mix UX, not perfect jumbo hydration.

### Engine + analysis changes

`lib/engine.ts`:
- Extend `BreakConfig` → `{ hobbyCases, bdCases, jumboCases, hobbyCaseCost, bdCaseCost, jumboCaseCost }`.
- `computeSlotPricing` gains a third pool calculation parallel to the hobby pool. `jumboWeight` uses the same `effectiveScore` multiplier as hobby (whereas BD uses raw `evMid` — keep that asymmetry; jumbo behaves like hobby).
- Add `jumboSlotCost`, `jumboPerCase` to the per-player and per-team return shape.
- `computeTeamSlotPricing` sums `jumboSlotCost` into `totalCost`.

`lib/analysis.ts:runBreakAnalysis` — new signature:
```ts
runBreakAnalysis({
  productId,
  teams: string[],                          // multi-select
  extraPlayerProductIds?: string[],         // standalone player slots
  formats: { hobby: number, bd: number, jumbo: number },
  caseCosts: { hobby?: number, bd?: number, jumbo?: number },  // override; defaults to AM > MSRP
  askPrice: number,                         // bundle ask
})
```
- Compute slot pricing once for the product (engine returns all formats).
- Sum each selected team's costs across the requested formats.
- Add each `extraPlayerProductIds` player's per-format slot cost.
- Compute one bundle `fairValue` and one `signal` against the bundle `askPrice`.
- Claude prompt expands to cover the multi-team / multi-player composition.

API surface (`app/api/analysis/route.ts`): accept the new shape; keep one POST, fail closed on legacy single-team payloads with a clear error so the client must update.

### UX

`app/(consumer)/analysis/page.tsx` (configure-a-break entry):
- Product picker stays single-select (single-product per break for v1).
- Replace team dropdown with multi-select chips ("+ Lakers, + Mavericks, + 76ers").
- Add `+ Add player slot` row → searchable picker pulling from this product's `player_products`. Selected players show as removable chips.
- Replace hobby/BD toggle with three counter inputs: Hobby cases, BD cases, Jumbo cases. Hide a counter if the product doesn't have that format's case cost.
- Show case cost per format with a "use AM price" checkbox per format (defaults on when AM is set; falls back to MSRP).
- Single ask-price input labeled "Bundle price" with a hint: "Total you'd pay for this combination."

`app/(consumer)/break/[slug]/page.tsx`:
- Replace `breakType` segmented control with the same three-format counter UI.
- Team slots table shows hobby + BD + jumbo columns conditional on what the product supports; total column.
- Counter changes drive the existing `useMemo(computeSlotPricing)` recomputation.

### Data quality fix bundled into Phase 1

`lib/pricing-refresh.ts` and `lib/analysis.ts` aggregation: **filter out variants with `print_run <= 1` when computing per-player aggregated EV.** Single-line filter on the `variants.filter(...)` step before the sets-weighted average. Eliminates the Austin Reaves bug. Variant-level EV for actual 1/1 cards is preserved (those still get displayed if a player is searched directly), but they no longer pollute slot pricing.

Mid-tier (orange/gold) anchor: parked. Kyle was directionally right but data sparsity needs analysis before we change the weighting basis. Add a one-line follow-up note in `docs/pricing-architecture.md`.

### Critical files to modify

- `supabase/migrations/<new>_jumbo_format.sql`
- `lib/types.ts` — `BreakConfig`, `PlayerWithPricing`, `TeamSlot` (add jumbo fields)
- `lib/engine.ts:computeSlotPricing`, `computeTeamSlotPricing`
- `lib/analysis.ts:runBreakAnalysis` — new multi-team / multi-player / multi-format signature
- `lib/pricing-refresh.ts` — print_run ≤ 1 filter in variant aggregation
- `app/api/analysis/route.ts` — request schema
- `app/(consumer)/analysis/page.tsx` — multi-select team chips + player picker + format counters
- `app/(consumer)/break/[slug]/page.tsx` — format counters replace segmented control
- `components/breakiq/TeamSlotsTable.tsx`, `components/breakiq/PlayerTable.tsx` — show jumbo column conditionally
- `lib/types.ts` — `Product` adds `jumbo_case_cost`, `jumbo_am_case_cost`
- `app/admin/products/[id]/edit/` — admin editor adds jumbo cost fields

### Verification (Phase 1)

- Migration applies on staging Supabase (`zucuzhtiitibsvryenpi` is prod — apply to staging first).
- Pick a product without jumbo (e.g., a Topps Series 4): jumbo counter hidden, hobby+BD mix works, slot costs add up to bundle.
- Pick a product where we manually set `jumbo_case_cost`: counter appears, jumbo slot costs render.
- Configure a 2-team + 1-player bundle: total slot cost = sum of selected teams + standalone player; signal computed against bundle ask price.
- Reaves regression: pick a product where a 1/1 sale was inflating his slot. Verify his per-slot cost drops to a sane value with the print_run filter on.
- Old-shape API request (legacy `team: string`) returns a 400 with a clear error.

---

## Phase 2: Insight Capture v2 (extends global BreakIQ Bets)

### What the parser learns to extract

Today the global BreakIQ Bets parser (`/api/admin/parse-bets-global`) only emits `{ player_id, suggested_score, reason_note, confidence }`. Extend the prompt + output schema to ALSO emit:

1. **Asking-price observations** — `{ scope: 'team' | 'player' | 'variant', scope_id, format: 'hobby'|'bd'|'jumbo', observed_price_low, observed_price_high, source_note, confidence }`. e.g. "Cooper Flagg PYP is going for 12 to 15k on most streams this week."
2. **Hype tags** — `{ scope_type, scope_id, tag: 'release_premium' | 'cooled' | 'overhyped' | 'underhyped', strength: 0–1, decay_days }`. e.g. "Bowman Concan crystallized was hot at $8k release week, now $7k and not bidding" → `cooled`, decay 14d.
3. **Risk flags** — already a table; surface it from the same capture flow ("Wemby is injured, downgrade") instead of requiring a separate admin route.

The review screen gets new sections matching each output type, defaulting to confidence ≥ 0.5 = included, with edit/exclude controls per row.

### Storage

New table `market_observations`:
```
id uuid pk
observation_type text  -- 'asking_price' | 'hype_tag'
scope_type text        -- 'product' | 'team' | 'player' | 'variant'
scope_id uuid
product_id uuid (fk)   -- always set so we can filter per product
payload jsonb          -- type-specific shape
source_user_id uuid (fk profiles)
source_narrative text  -- the raw quote that produced this observation
confidence numeric
observed_at timestamptz default now()
expires_at timestamptz -- default now() + 14 days; hype tags can override via decay_days
superseded_at timestamptz
```

Risk flags continue to live in `player_risk_flags` — the parser writes to that existing table when it detects a flag.

### Consumer surface

On `/break/[slug]`:
- Per team slot row, when `market_observations` of type `asking_price` exist within `expires_at` for that team or its top players, show a small "Streams asking $12k–$15k" chip next to fair value. On click → opens a popover with the source notes and observation count.
- Per player row, show hype-tag chips next to existing badges (★ ↑↓ ⚡ ⚑) — `🔥 hot @ release` for `release_premium`, `🥶 cooled` for `cooled`. Tooltip shows the source note.
- Asking-price observations are **display-only** for v1 — they don't yet feed back into the model's weighting. We accumulate the data and revisit weighting once we have volume.

### Auth + scope expansion

Today BreakIQ Bets is admin-only. Add a `contributor` role to `user_roles` (it doesn't exist yet — only `admin` does per CLAUDE.md). Contributors can create observations but not approve/feature them. Admins (Kyle, Brody) keep full access. Wire `requireRole('admin' | 'contributor')` on the parse + save endpoints.

### Critical files (Phase 2)

- `supabase/migrations/<new>_market_observations.sql` — new table + RLS policies (admins read/write all; contributors write only their own; consumers read non-expired)
- `app/api/admin/parse-bets-global/route.ts` — extend Claude prompt + output schema
- `app/admin/breakiq-betz/page.tsx` + `GlobalBreakIQBetsDebrief.tsx` — review UI for the three output types
- `app/admin/breakiq-betz/actions.ts` — `saveMarketObservations()` server action
- `lib/auth.ts` — add `contributor` to role checks
- `app/(consumer)/break/[slug]/page.tsx` — fetch + render asking-price chip + hype tags
- `components/breakiq/TeamSlotsTable.tsx`, `PlayerTable.tsx` — chip slots
- `lib/types.ts` — `MarketObservation`, observation payload union types

### Verification (Phase 2)

- Paste a multi-topic narrative ("Flagg PYP is 12–15k on streams. Bowman Concan crystallized cooled off, was 8k at release now 7k. Wemby injured.") → review screen shows three sections (asking-price, hype tag, risk flag) with the right scopes.
- Save → records appear in `market_observations` and `player_risk_flags`.
- Open the relevant `/break/[slug]` → asking-price chip renders, hype tag shows on the right player row, risk flag shows in the existing flag UI.
- Stale observation (manually set `expires_at` to past) does not render.
- Contributor role can save; consumer role gets 403.

---

## Phase 3: Dedicated mobile capture surface (deferred, after Phase 2 has run for a few weeks)

Once we know which observation types Kyle uses most often and which take the most clicks today, build `/m/insights` (or PWA-installable equivalent) optimized for one-handed phone use:
- Voice-to-text first input, single tap to start.
- Quick category chips (asking price, hype, risk, sentiment) so Kyle can narrow Claude's parsing scope.
- Save-as-you-go (don't require parse → review → save for every observation).
- "Last 24h" feed of his observations so he can edit/retract.

Out of scope for the immediate plan — flagged so we don't build it speculatively before Phase 2 reveals the right ergonomics.

---

## Out of scope (explicitly)

- **Multi-product breaks** (one break spanning multiple SKUs): user chose single-product for v1.
- **Mid-tier (orange/gold) weighted anchor:** Kyle's instinct is right but needs a data analysis to confirm coverage per player before changing weighting.
- **Release-window premium decay model:** captured as a hype tag (Phase 2) but the model doesn't auto-apply it yet.
- **Asking-price feeding back into fair-value weighting:** display-only in Phase 2; model weighting decision parked until we have volume.

## Documentation touch-points (per CLAUDE.md convention)

- Save this plan file at `docs/plans/2026-04-29-break-analysis-v2.md` (copy from `~/.claude/plans/`) at end of plan mode.
- Architecture doc: `docs/break-analysis-v2.md` (live reference).
- CHANGELOG entry per phase shipped, linking to both.
- CLAUDE.md: index entry + one-line summary in Current State.
