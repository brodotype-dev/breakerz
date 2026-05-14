# Side-by-side comparison UI on `/break/[slug]`

*Status: shipped 2026-05-14. Slice A + Slice B both landed in the same PR. Slice C (`/analysis` overlay) deferred until observation volume picks up.*

## Context

Execution-roadmap step #3 (`docs/strategy/execution-roadmap.md:66`) — "Highest single user-perceived impact in the entire roadmap." Makes the differentiated number visible *on the surface users already use* by rendering observed breaker asks next to our slot fair value.

Before this PR, the consumer break page rendered TeamSlotsTable rows with our slot cost + a blank ask-price input that users typed into to get a signal. Observed asks from `/break-price` Discord captures sat in `market_observations` (`observation_type='asking_price'`, scope_type='team'), but the page-level fetch was gated to pre-release products only (used purely for the pre-release hero chips). On live products the data was silently ignored.

Data reality at ship time: 1 asking_price observation in prod. Same volume floor as slice 2b. The UI ships now because (a) every new `/break-price` capture surfaces as a comparison row immediately; (b) the empty state stays clean — no observations means nothing renders, so there's no noise; (c) the per-team fair-value rollup wired up here also unblocks the admin captures-panel delta column (slice B).

## What shipped

### Slice A — consumer side-by-side (`/break/[slug]`)

- **Ungated observation fetch** in [app/(consumer)/break/[slug]/page.tsx](../../app/(consumer)/break/%5Bslug%5D/page.tsx). The `if (isPreReleaseProduct)` wrap that previously skipped asking-price observations on live/dormant products is gone — fetch runs on every lifecycle. `expires_at` + `superseded_at` guards stay.
- **`askObservationsByTeam` + `targetComposition` memos** in page.tsx, computed off `askingPriceObsRows` and the active `config` state.
- **New TeamSlotsTable props** ([components/breakiq/TeamSlotsTable.tsx](../../components/breakiq/TeamSlotsTable.tsx)):
  - `askObservations?: Map<string, AskingPriceObsRow[]>` keyed by team name
  - `targetComposition?: SlotComposition` from `configToComposition({hobby, bd, jumbo})`
- **Per-team observation sub-row** rendered between the team row and the expanded player rows when ≥1 observation survives composition + recency ranking. Content:
  - Price range (`$L–$H` or single value when listings agree)
  - Observation count + source-type breakdown (`N listings, M estimates, K sales`)
  - Recency (`today` / `1d ago` / `Nd ago`)
  - Composition label when any observation has a multi-format composition (e.g. `bd 20 + hobby 5`)
  - **"Use $X" pre-fill pill** — sets the team's ask input to the median price of the top-ranked observation and fires `observed_ask_prefilled` PostHog event
  - **"vs herd: ±X%"** chip — appended when the user has typed an ask AND there's a ranked observation. Color-coded (red overcharge / green steal / neutral within ±5%).
- **PostHog event** `observed_ask_prefilled` in [lib/posthog-events.ts](../../lib/posthog-events.ts): `{ product_id, team, prefilled_price, observation_count, source_type }`.
- **Empty state**: nothing renders. Clean by default. Decided over a CTA-style hint to avoid spammy chrome when most teams have zero observations.

### Slice B — admin per-row delta on Market Delta Watch captures panel

- **New helper** [lib/team-fair-value.ts](../../lib/team-fair-value.ts) exporting:
  - `getTeamFairValuesForProduct(productId)` → builds PlayerWithPricing-shaped rows from `pricing_cache`, runs `computeSlotPricing` + `computeTeamSlotPricing` with a 1-case-of-each reference config, applies lifecycle market markup via `getMarketMarkup`, returns `{ teams: Map<team, TeamFairValue> }` where each entry has pure model + market-adjusted slot costs for all three formats.
  - `getTeamFairValuesForProducts(ids[])` — dedupes + parallelizes for the captures panel.
- **Captures panel** ([app/admin/market-delta/page.tsx](../../app/admin/market-delta/page.tsx)):
  - `obsRows` query now selects `product_id` so the snapshot lookup can run.
  - One `getTeamFairValuesForProducts` call covers every distinct product across the recent 50 captures.
  - New `Δ vs model` column in the captures grid (13 cols, up from 12). Color-coded: red ≥+20%, green ≤−20%, neutral between, dash when not computable.
  - Hover tooltip surfaces the reference fair value or the skip reason.
  - Skip cases (render `—`): non-team scope, mixed composition, missing `product_id`, no `pricing_cache` rows yet for the product.

### Slice C — deferred

`/analysis` standalone deal checker and `<AnalysisResultPanel>` per-team rows. Same overlay concept, but composition is custom per analysis run (multi-team bundles), the comparison story is messier, and we want to validate the consumer-page surface first. Picked up after this ships and we have ≥10 captures.

## Pure helpers extracted

Slice 2b's `lib/observation-context.ts` had three useful helpers buried in it that were server-only by accident (it imports `supabaseAdmin`). Moved to [lib/observation-ranking.ts](../../lib/observation-ranking.ts) so the client surfaces can use them without dragging Supabase into the bundle:

- `compositionSimilarity(target, candidate)` — 1.0 / 0.5 / 0.0 scoring
- `recencyWeight(observedAt, now?)` — linear decay over `OBSERVATION_LOOKBACK_DAYS = 30`
- `renderComposition(comp)` — human-readable label
- `configToComposition(formats)` — break-config → sparse SlotComposition

Plus a new `bestCompositeScore(target, observations)` for callers that just want "is there a match worth showing" without ranking the full list. `observation-context.ts` re-imports the helpers; no behavior change for slice 2b.

## Files touched

| File | Change |
|---|---|
| [app/(consumer)/break/[slug]/page.tsx](../../app/(consumer)/break/%5Bslug%5D/page.tsx) | Ungate observation fetch; memo `askObservationsByTeam` + `targetComposition`; pass to TeamSlotsTable |
| [components/breakiq/TeamSlotsTable.tsx](../../components/breakiq/TeamSlotsTable.tsx) | New props; private `rankObservations` helper; per-team observation sub-row; pre-fill pill; vs-herd chip |
| [lib/observation-ranking.ts](../../lib/observation-ranking.ts) | NEW. Pure ranking + rendering helpers |
| [lib/observation-context.ts](../../lib/observation-context.ts) | Re-imports from observation-ranking.ts; no behavior change |
| [lib/team-fair-value.ts](../../lib/team-fair-value.ts) | NEW. Server-side per-team fair-value rollup for admin |
| [app/admin/market-delta/page.tsx](../../app/admin/market-delta/page.tsx) | Δ vs model column + batched fair-value lookup |
| [lib/posthog-events.ts](../../lib/posthog-events.ts) | Add `observed_ask_prefilled` |

No schema changes, no new migrations, no new API routes. Pure read path on top of existing `pricing_cache` + `market_observations`.

## What we explicitly skip

- Editing/adding observations from the UI — capture stays Discord-only.
- Predictive "expected ask" overlay — we only show observed values.
- Historical chart of asks over time on the consumer page (admin territory).
- Composition-aware fair value for mixed observations — slice B labels mixed captures as `—`. Per-mix engine reference math is queued.
- Per-format observation filter UI on consumer side — composition-similarity does the filtering invisibly.

## Verification

1. **Local empty state**: hit `/break/2025-topps-chrome-baseball` (zero observations). TeamSlotsTable renders unchanged; no sub-rows.
2. **Local populated state**: hit `/break/2025-bowman-chrome-baseball`. Los Angeles Dodgers row shows `Breakers asked $625 · 1 obs (1 listing) · 1d ago` plus a `Use $625` pill. Click pill → input pre-fills → signal renders against slot cost.
3. **Vs-herd delta**: with the pill clicked at $625 and the model slot at (say) $480, the chip shows `vs herd: −23%` in green.
4. **Admin captures delta**: visit `/admin/market-delta`. The Dodgers capture row in the recent-50 panel shows `Δ vs model` color-coded next to the ask price. Hover surfaces the reference fair value.
5. **PostHog**: one prefill click lands `observed_ask_prefilled` with full property bag.
6. **Pre-release regression check**: visit a pre-release product. `PreReleaseLayout` still gets `askingPriceObsRows` for the hero chips (only helpers moved, not behavior).
7. **Type + build**: `npx tsc --noEmit` clean; `npm run build` clean.

## Out-of-scope follow-ups

- Captures-panel filter by delta bucket (overcharge/steal/neutral).
- "Open break" link on Market Delta captures jumping to the consumer page.
- `/analysis` + `<AnalysisResultPanel>` observation overlay (slice C).
- Composition-aware fair value for mixed observations (per-mix engine reference math).
- Confidence chip on the observation sub-row (count × recency aggregate).
