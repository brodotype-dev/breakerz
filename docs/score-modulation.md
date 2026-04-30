# Score Modulation — risk_flags + hype_tags into effectiveScore

Live reference for how `risk_flag` rows and `hype_tag` market observations
fold into the engine's `effectiveScore` alongside `buzz_score` and
`breakerz_score`. Plan: [docs/plans/2026-04-29-break-analysis-v2.md](./plans/2026-04-29-break-analysis-v2.md).

## Math

```
effectiveScore = clamp(
  buzz_score + breakerz_score + risk_score_adj + hype_score_adj,
  -0.9, 1.0
)                                                    (0 if is_icon)
```

`risk_score_adj` and `hype_score_adj` are runtime-only, attached to
`PlayerWithPricing` upstream of `computeSlotPricing`. Not persisted.

### Risk

`computeRiskAdjustment(activeFlags)` returns the **single most-negative**
flag's adjustment (no stacking):

| flag_type   | adj    |
|-------------|--------|
| retirement  | -0.80  |
| suspension  | -0.50  |
| legal       | -0.40  |
| injury      | -0.30  |
| off_field   | -0.25  |
| trade       | -0.15  |

Tune in [`lib/score-modulation.ts`](../lib/score-modulation.ts).

### Hype

`computeHypeAdjustment(observations)` sums per observation:

```
contribution = direction × strength × HYPE_MAX × decayFactor
decayFactor  = max(0, 1 - daysSinceObserved / decay_days)   (linear)
```

| tag              | direction |
|------------------|-----------|
| release_premium  |   +1      |
| underhyped       |   +1      |
| cooled           |   -1      |
| overhyped        |   -1      |

`HYPE_MAX = 0.30` caps any single observation's contribution. Multiple
hype tags **do** stack (release_premium + underhyped both push +).

Scope mapping at consumer-fetch time:
- `scope_type='product'` → applies to every player in the pool
  (mathematically a no-op for slot **shares** — uniform bumps cancel —
  but does affect the clamped score; matters once cross-product or
  fair-value-vs-ask comparisons land)
- `scope_type='team'` → applies to every player whose `player.team` matches `scope_team`
- `scope_type='player'` → applies to player_products whose `player_id` matches `scope_id`
  (note: `scope_id` is `players.id`, NOT `player_products.id`)

## Where it runs

- **`/break/[slug]` (consumer):** [app/(consumer)/break/[slug]/page.tsx](<../app/(consumer)/break/[slug]/page.tsx>) loads `player_risk_flags` + `market_observations` in parallel, computes adj, and merges into `rawPlayers` before `setRawPlayers`. The existing `useMemo(computeSlotPricing)` runs on the augmented input.
- **`/analysis` (BreakIQ Sayz):** [lib/analysis.ts](../lib/analysis.ts) does the same in `runBreakAnalysis` before `computeSlotPricing`. The pool-wide flags fetch is reused for the bundle-level `riskFlags` response (no second round-trip).

## What does NOT change

- `pricing_cache` schema and `lib/pricing-refresh.ts` — the cache stores per-variant `ev_low/mid/high`, not slot shares. Engine math runs at render time, so signals take effect on next page load with no cache invalidation.
- `/api/pricing` — pure cache read, no engine math, untouched.
- Admin UI — risk flags managed where they always have been; hype tags come in via Discord (`/insight`).
- Database — no migration.

## Tuning

Edit constants in [`lib/score-modulation.ts`](../lib/score-modulation.ts) and ship a PR. No admin UI; no hot-reload. The clamp range `[-0.9, 1.0]` lives in [`lib/engine.ts`](../lib/engine.ts) and stays unchanged.
