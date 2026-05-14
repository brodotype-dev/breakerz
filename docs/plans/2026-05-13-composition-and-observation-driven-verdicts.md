# Composition-as-primitive + observation-driven verdicts

*Status: planned 2026-05-13. Not yet shipped.*

## Context

Dan Reed's `/break-price` IG DM screenshot ("Bowman delight/hobby — 25 casers, 20 delight 5 hobby per break") parsed as 23 single-format `format: 'hobby'` rows. Each row's per-team price actually covers a **bundled mix** (20 BD + 5 hobby per slot), not a pure-hobby slot. Two consequences:

1. **Silent mis-classification.** Market Delta Watch comparing $625 Diamondbacks against pure-hobby fair value is meaningless — the ask covers two formats simultaneously.
2. **Real SME data lost if we just drop it.** Per the strategy doc's data-feedback-loop principle (CLAUDE.md), walking away from valid intel because we can't price it perfectly is anti-loop. Capture now, use it now (narrative), price it later (calibration).

A first-draft plan proposed adding `'mixed'` to the `BreakFormat` enum and stapling a sidecar `format_mix` field. That works but is structurally noisy — `'mixed'` is a meta-classification, not a format, and it pollutes every consumer surface that switches on the enum (TS exhaustiveness landmines).

Stepping all the way back: **the engine and break-log schema already model bundles as composition vectors.** `runBreakAnalysis({formats: {hobby, bd, jumbo}})` ([lib/analysis.ts:34](../../lib/analysis.ts)) takes a sparse vector of case counts. `user_breaks.formats` ([lib/types.ts](../../lib/types.ts)) stores the same shape. `my-breaks` CSV export columns are already `Hobby Cases / BD Cases / Jumbo Cases`. The only places still using single-format-as-discriminator are `market_observations.payload.format` and the Discord parser ParsedUpdate types. They're the lagging surfaces. Bringing them into alignment with the rest of the system is the structurally honest fix.

A second insight that fell out of the architecture conversation: **observations don't need to display directly to be useful.** They're calibration data for the engine and narrative context for the AI verdict — not a lookup table users have to "match" by configuring the exact same mix. That reframe collapses the original two-slice plan's "wait for 20 mixed observations" trigger into a smoother slice ladder with parallel value paths.

## Architectural primitive

**`composition` replaces single `format` for asking-price and odds observations. A new `source_type` field captures the epistemic kind of the observation.**

```ts
// market_observations.payload — JSONB, no schema migration
type SlotComposition = {
  hobby?: number | null;   // case count per slot when known; null when format involved but ratio unknown
  bd?: number | null;
  jumbo?: number | null;
};

type ObservationSourceType =
  | 'competitor_listing'  // captured from a live stream / posted listing — what the market is asking
  | 'breaker_estimate'    // SME read on what a slot SHOULD be priced at (Dan Reed's IG DM)
  | 'historical_sale';    // a completed sale — what the market actually paid
```

`source_type` is independent from the existing `source` enum (`ebay_listing | stream_ask | social_post | other`) which captures the *channel* the observation came through. `source_type` captures the *epistemic kind* of the observation. Slice 2a will weight these differently in calibration; slice 2b can also use it to color the narrative ("recent SME estimates" vs "recent competitor asks").

| Source quote | Composition emitted |
|---|---|
| Whatnot stream — "$45 for Diamondbacks" (no format mentioned) | `{hobby: null}` (defaults to hobby per existing convention) |
| "Bowman hobby per-team" | `{hobby: null}` |
| Dan Reed — "delight/hobby, 20 delight 5 hobby per break" | `{bd: 20, hobby: 5}` |
| "Delight/hobby case mix" (no per-slot ratio) | `{bd: null, hobby: null}` |

Rules the parser must encode:
- Single-key composition with `null` value = "this format, count not specified" (the common case)
- Multi-key composition = mixed bundle
- `null` values mean "format involved, ratio unknown"
- Numeric values mean "case count per slot, explicitly stated by source"

`BreakFormat` enum stays clean (`'hobby' | 'bd' | 'jumbo'`) — it's the alphabet, not the noun. "Mixed" is never a stored value; it's a *display computation* (`Object.keys(composition).length > 1 ? 'Mixed' : keys[0]`) on the rare consumer-facing surface that needs a single-token label.

## Three slices, ordered by ship-readiness

### Slice 1 — Composition capture (this PR)

Ships the schema cleanup, parser changes, backfill, and admin display. No engine math change. No new pricing logic.

**1. ParsedUpdate type changes** in [lib/insights-parser.ts](../../lib/insights-parser.ts):
   - `asking_price` and `odds_observation` ParsedUpdate types: replace `format: BreakFormat` with `composition: SlotComposition`
   - Add `SlotComposition` and `ObservationSourceType` types to [lib/types.ts](../../lib/types.ts) alongside existing `BreakFormat`
   - **`source_type` is NOT emitted by the parser** — it's derived deterministically from the existing `source` enum at apply time. Keeps the parser prompt simple and avoids asking Claude to make a judgment call from a screenshot.

**2. Parser prompt updates** — `parseInsights` (~line 280) and `parseBreakPrice` (~line 870):
   - Replace existing `format` field guidance with composition guidance — verbatim rules from the table above
   - Parser continues to emit the existing `source` enum (`ebay_listing | stream_ask | social_post | other`) — no change there
   - **Drop** the `parseBreakPrice` "multi-format bundle → return empty" rule (~line 855). Replaced by the composition emission rules.
   - **Keep** the multi-team bundle drop rule (single combined ask spanning teams) — that's a different shape we still can't price.

**2b. `source_type` derivation** — happens at apply time, not parse time. Define a small mapping function in [lib/types.ts](../../lib/types.ts) or a new helper module:

   ```ts
   function deriveSourceType(source: ObservationSource): ObservationSourceType {
     switch (source) {
       case 'stream_ask':   return 'competitor_listing';
       case 'ebay_listing': return 'competitor_listing';
       case 'social_post':  return 'breaker_estimate';   // SME DMs typically arrive as social_post (Dan Reed pattern)
       case 'other':        return 'competitor_listing'; // safe default
     }
   }
   ```

   Trade-off accepted: not 100% accurate — a `social_post` could also be a competitor's tweet showing their slot prices, which is really a listing. We're trading strict accuracy for determinism and zero-cost classification. If the mapping turns out to be wrong often enough to skew calibration in slice 2a, revisit then with an explicit slash-command override.

**3. Validation updates** in `parseInsights` (~line 386) and `parseBreakPrice` (~line 919):
   - Replace `validFormats` set check with `validateComposition(comp)` — at least one key present, all keys are in `BreakFormat` enum, all values are `null` or positive number, ≤ 50 cases per format (sanity bound).
   - `source_type` is NOT validated here — it's derived at apply time, so the parser path never sees it.

**4. `summarizeUpdate` rewrite** ([lib/insights-parser.ts](../../lib/insights-parser.ts) ~line 503):
   - Composition rendering:
     - Single-key, null value: `hobby`
     - Single-key with explicit count: `hobby ×3`
     - Multi-key: `bd 20 + hobby 5`
     - Multi-key with null values: `bd + hobby (mixed ratio)`
   - The proposal preview rendered to Discord uses the parser-emitted fields only (`composition` + `source` channel) since the parser hasn't applied yet. `source_type` isn't shown in the preview — it becomes meaningful only after the row lands in `market_observations` (admin dashboard renders it from there).
   - Format: `(${composition}, ${source})` — example: `(bd 20 + hobby 5, social_post)`

**5. Apply path** in [app/api/discord/interactions/route.ts](../../app/api/discord/interactions/route.ts) `applyUpdates`:
   - Replace `payload.format` write with `payload.composition` for both `asking_price` and `odds_observation` cases
   - Compute `payload.source_type = deriveSourceType(payload.source)` and write alongside composition
   - JSONB column, zero migration

**6. One-time backfill** — new script `scripts/backfill-composition.mjs`:
   - For every existing `market_observations` row with `payload.format` set, write `payload.composition = {[payload.format]: null}` and `payload.source_type = 'competitor_listing'` (the safe default for legacy rows — all existing observations were captured before SME-estimate semantics existed) and remove `payload.format`. Reversible via the same script with a `--reverse` flag.
   - **Decision: Dan Reed's 23 mis-classified rows get deleted, not backfilled.** Add a cleanup step that filters by `created_at` window + source (likely `social_post`) + product (Bowman) and removes them. Dan re-submits via `/break-price` after deploy. Cleaner long-term — we don't bake in a guessed composition.

**7. Admin Market Delta Watch** ([app/admin/market-delta/page.tsx](../../app/admin/market-delta/page.tsx)):
   - `/break-price captures` panel chip rendering: render composition via the new `summarizeUpdate` shape, including the `source_type` tag (`listing`/`estimate`/`sale`)
   - Add a small counter at the top: `N pure-format · M mixed observations · N_listing listings · N_estimate estimates · N_sale sales` so we can see capture distribution at a glance
   - Add a filter dropdown to the captures panel: All / Listings only / Estimates only / Sales only — lets us audit the SME-estimate stream separately from the competitor-listing stream

### Slice 2b — AI verdict narrative enrichment (next, ~1-2 days after slice 1)

Ships the read-only enrichment of the AI verdict prompt. No engine change, no calibration math. Just smarter narrative. **Gated behind an admin toggle** so we can A/B verdict narratives with vs. without observation context during beta and gut-check whether the enrichment lands as helpful or as noise.

**1. New helper** `lib/observation-context.ts`:
   - `getRecentObservationsForVerdict(productId: string, composition: SlotComposition): Promise<ObservationContext>`
   - Queries `market_observations` for the product, last 30 days, top 5 most recent, weighted toward similar composition shape (same set of keys, time-decay by recency)
   - Returns a structured context block ready to splice into the AI prompt
   - **Threshold:** if fewer than 3 observations, returns a minimal context (no range citation, just a "limited recent observations" flag)
   - **`source_type` aware:** the returned context distinguishes listings from estimates ("3 competitor listings: $400–$700 / 1 breaker estimate: $625"). Lets the prompt color the narrative voice appropriately.

**2. Admin toggle for verdict enrichment:**
   - New row in `app_settings` table (or a single-row `feature_flags` table if we don't have one — most likely create `feature_flags(key text primary key, enabled boolean, updated_at timestamptz)`)
   - Key: `verdict_observation_context_enabled` — boolean, default `false` on first deploy
   - Admin toggle UI: tiny on/off switch in the admin settings nav or as a row on Market Delta Watch (lower-risk to colocate with the captures panel where the data feeding it lives)
   - Verdict pipeline reads the flag at request time. Flag = off → today's narrative behavior. Flag = on → enriched context spliced into prompt.
   - PostHog event `verdict_observation_context_applied` fires when the flag is on AND ≥3 observations were available — lets us segment beta retention with vs. without enrichment.

**3. Wire into the existing verdict generation path.** Find where `runBreakAnalysis`'s narrative is generated (likely in `lib/analysis.ts` or wherever the AI prompt for the verdict is assembled — needs scan to confirm). Append the observation context to the prompt with explicit grounding instruction:

   > *"The observations below are recent market signals for this product. `listing` rows are what competitors are asking; `estimate` rows are SME reads on what the slot is worth; `sale` rows are completed prices. Reference these patterns where relevant — speak to ranges and recency, never name individuals or platforms. Do not invent observations not listed here. If fewer than 3 are listed, soften any market-range claims."*

**4. No consumer UI surface change.** The verdict still renders as today — the prose narrative just gains market context where available.

**Risks designed around:**
- Cherry-pick small N → enforced via threshold (≥3 observations to cite a range)
- Stale observations → time-decay-weighted selection, 30-day cutoff
- Source credibility → not addressed in 2b; recency is proxy. Add when we have enough volume to need it.
- Hallucination → explicit prompt instruction + system message reinforcement
- SME naming in consumer copy → prompt forbids it explicitly

### Slice 2a — Calibration aggregator (deferred, after slice 2b validates)

Ships the periodic aggregator that adjusts engine markup constants based on observed asks. This is the slice that closes the "model gets smarter as observations accumulate" loop at the math layer (vs. 2b which closes it at the narrative layer).

**Design open until 2b ships and we've seen real observation patterns.** Likely shape:
- Cron job, 24h or weekly cadence
- Reads `market_observations` per product, computes weighted-average implied markup vs. `pricing_cache.snapshot_fair_value`
- Writes back to either `products.market_markup_override` (new column) or a new `product_markup_calibration` lookup table
- `MARKET_MARKUP_BY_LIFECYCLE` constant in [lib/market-markup.ts](../../lib/market-markup.ts) becomes a fallback when no per-product calibration exists
- Market Delta Watch becomes the audit panel: "after this week's calibration, is our model still tracking the herd?"

**Trigger to ship:** when slice 2b is in production and we want to start influencing the math layer rather than just the narrative layer. No row-count threshold — even one observation can nudge a constant a tiny amount, weighted by sample size.

### Slice 3 (later) — Structured consumer displays

Optional later layer where individual or aggregate observations surface visually to consumers:
- "We've seen Bowman BD-heavy slots asking $400-$700 this week" — aggregate range chip
- "3 breakers asking similar slots right now" — count badge
- Never raw individual observations on the consumer side (too noisy, no exact-match expectation needed)

Defer until 2b is proven and we have user feedback on whether structured displays add signal beyond the narrative voice.

## Critical files

**Slice 1:**
- [lib/types.ts](../../lib/types.ts) — `BreakFormat` enum (UNTOUCHED), new `SlotComposition` + `ObservationSourceType` types added
- [lib/insights-parser.ts](../../lib/insights-parser.ts) — ParsedUpdate types (~50, ~90), `parseInsights` prompt + validation (~280, ~386), `parseBreakPrice` prompt + validation (~870, ~919), `summarizeUpdate` (~503)
- [app/api/discord/interactions/route.ts](../../app/api/discord/interactions/route.ts) — `applyUpdates` `asking_price` + `odds_observation` cases
- [app/admin/market-delta/page.tsx](../../app/admin/market-delta/page.tsx) — captures panel chip rendering, distribution counter, source-type filter dropdown
- *(new)* `scripts/backfill-composition.mjs` — backfill legacy rows + Dan Reed cleanup

**Slice 2b:**
- [lib/analysis.ts](../../lib/analysis.ts) — verdict generation path (where the AI prompt is assembled — scan to confirm)
- *(new)* `lib/observation-context.ts` — recent-observation retrieval + grounded context block builder
- *(new migration)* `feature_flags` table — `verdict_observation_context_enabled` row
- *(new component)* admin toggle UI — likely colocated on `/admin/market-delta` next to the captures panel
- [lib/posthog-events.ts](../../lib/posthog-events.ts) — new `verdict_observation_context_applied` event

**Slice 2a (deferred):**
- [lib/market-markup.ts](../../lib/market-markup.ts) — markup constants become fallbacks; per-product calibration writes here or to a new lookup table

## Existing infrastructure to reuse

- `runBreakAnalysis({formats: composition})` — engine input is **already** composition-shaped; no engine change for any slice
- `market_observations.payload` JSONB — no schema migration for any slice
- `summarizeUpdate` single render path — used by both `/insight` and `/break-price` previews; one rewrite covers both
- `pending_insights` apply/reject flow — no change

## Verification

After slice 1 deploy:

1. **Re-run Dan Reed's IG DM** through `/break-price` (no narrative). Expected: 23 ParsedUpdate rows with `composition: {bd: 20, hobby: 5}` and `source: 'social_post'`. Proposal preview shows `(bd 20 + hobby 5, social_post)`.
2. **Run a clean single-format Whatnot screenshot.** Expected: rows with `composition: {hobby: null}` and `source: 'stream_ask'`. Proposal preview: `(hobby, stream_ask)`.
3. **Apply the mixed proposal.** Expected: `market_observations.payload.composition` = the mix, `payload.source = 'social_post'`, `payload.source_type = 'breaker_estimate'` (derived from source via the mapping function), `payload.format` field absent.
3a. **Apply the stream proposal.** Expected: `payload.source = 'stream_ask'`, `payload.source_type = 'competitor_listing'`.
4. **Visit `/admin/market-delta`.** Expected: distribution counter shows mixed-vs-pure split AND listing/estimate/sale counts. Filter dropdown filters captures correctly.
5. **Run backfill script in dry-run mode** against staging. Expected: prints planned mutations without writing. Then run live on staging, verify a sample of legacy rows now have `composition` shape + `source_type: 'competitor_listing'` + no `format`. Verify Dan Reed's 23 rows are gone.
6. **Type-check:** `npx tsc --noEmit` clean across touched files.

After slice 2b deploy:

7. **With toggle OFF:** run `/analysis` on any product. Expected: verdict narrative is byte-for-byte unchanged from pre-2b behavior.
8. **With toggle ON, 3+ recent observations:** run `/analysis` on a Bowman product. Expected: the AI verdict narrative cites a range or pattern naturally, distinguishes listing vs estimate voice where the data warrants it. Spot-check that no individual SME is named.
9. **With toggle ON, 0-2 recent observations:** run `/analysis`. Expected: narrative softens claims (no fabricated ranges).
10. **Adversarial check.** With toggle ON, run `/analysis` on a product where the only recent observation has a wildly different composition than the user's config. Expected: narrative either skips citing it or caveats it explicitly. No hallucinated comparison.
11. **PostHog confirmation:** `verdict_observation_context_applied` event fires only when toggle is on AND ≥3 observations were available.

## What this is NOT

- Not adding "delight" as a separate format — `bd` already covers it ([CLAUDE.md](../../CLAUDE.md))
- Not extending `BreakFormat` enum — composition is the new primitive
- Not changing how `/break-price` handles multi-team bundles ("Yankees + Red Sox + Dodgers $2400") — that's a different shape, drop rule stays
- Not changing any consumer surface that already renders single formats (PlayerTable, AnalysisResultPanel, etc.) — they read from engine output, not from observations
- Not building structured consumer displays of observations — slice 3, deferred
- Not building the calibration aggregator — slice 2a, deferred until 2b proves the use case

## Risk register

| Risk | Mitigation | Slice |
|---|---|---|
| TS exhaustiveness gaps from `'mixed'` enum value | Don't add it. Composition is a separate field. | 1 |
| Dan Reed's existing 23 mis-classified rows in production | Backfill script's cleanup step deletes them; Dan re-submits | 1 |
| Parser emits inconsistent compositions for ambiguous source text | Explicit rules in prompt for each case (table above) + validation rejects malformed | 1 |
| Backfill script corrupts good data | Dry-run mode + reversible flag + run on staging first | 1 |
| Observations queue indefinitely with no consumer use | Slice 2b is the first consumer; ships within ~1-2 days of slice 1 | 2b |
| AI hallucinates observation ranges | Explicit grounding instruction + minimum-N threshold | 2b |
| Stale observations dominate narrative | Time-decay weighting in `getRecentObservationsForVerdict` | 2b |
| SMEs named in consumer copy | Prompt forbids; spot-check in verification step 7 | 2b |
| Calibration aggregator drifts engine in unintended ways | Don't ship it until 2b validates the data quality | 2a |

## Decisions (resolved 2026-05-13)

1. **Dan Reed's 23 mis-classified rows: delete, not backfill.** Cleanup step in the backfill script removes them; Dan re-submits via `/break-price` after deploy.
2. **Slice 2b ships gated behind an admin toggle.** Lets us A/B verdict narrative with vs without observation context during beta. Toggle defaults to off on first deploy.
3. **`source_type` captured in slice 1, not deferred — derived deterministically from `source`, not inferred by Claude.** Mapping: `stream_ask`/`ebay_listing`/`other` → `competitor_listing`, `social_post` → `breaker_estimate`. Trades strict accuracy for determinism and zero classification cost. If the mapping skews calibration enough to matter in slice 2a, revisit with an explicit slash-command override at that point.
