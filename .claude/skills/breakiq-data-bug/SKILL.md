---
name: breakiq-data-bug
description: Use this skill whenever Brody reports a bug in BreakIQ data, pricing, matching, or any backend pipeline — pricing values that look wrong (too high / too low / stale / missing), CardHedger matches that landed on the wrong variant or the wrong tier, missing player rows, missing odds, cron jobs that didn't run or completed with err=N, EV math that disagrees with the slot price, score modulation that ignored a risk flag or hype tag, Discord `/insight` writes that didn't apply, schema/RLS/migration failures, pre-release vs live vs dormant lifecycle issues, my-chase or my-breaks records that vanished, or anything where "the number on screen is wrong but the page rendered fine". Triggers include phrases like "pricing is", "EV is wrong", "match landed on", "wrong variant", "no match", "cron didn't", "stale pricing", "ch_set_cache", "missing player", "missing odds", "fair value seems off", "B-score didn't change after", "risk flag isn't being applied", "hype tag isn't moving the price", "asking-price didn't", "RLS", "migration failed". Do NOT use this skill for layout, button, redirect, or auth flow issues — that's breakiq-ui-bug.
---

# BreakIQ Data / Pricing / Pipeline Bug Playbook

The data side of BreakIQ is a chain of independent stages, each writing into the next:

```
Checklist parse  →  player_products + player_product_variants
CH catalog       →  ch_set_cache
CH matching      →  variant.match_tier + variant.cardhedger_card_id
CH pricing       →  pricing_cache  (ev_low / ev_mid / ev_high + confidence)
Risk + hype      →  player_risk_flags + market_observations
Engine math      →  /api/pricing (cache read) → /break/[slug] render
Discord insights →  pending_insights → market_observations / risk_flags / breakerz_score
```

When a number looks wrong, the bug is in exactly one of those stages. Find it before changing code.

## Triage order

1. **Get the exact symptom.** Which product? Which player? Which variant if known? What's on screen vs. what should be there? "Pricing is off" is not a bug report.
2. **Check the cache, not the engine.** `/api/pricing` is a pure read. If the number is wrong on screen, `pricing_cache` already has the wrong number — the engine isn't recomputing live. Query it directly first:
   ```sql
   select * from pricing_cache where player_product_id = '<id>' order by fetched_at desc limit 5;
   ```
3. **Walk the chain backwards** from the bad number: cache → matching → catalog → checklist. The first stage where the data looks wrong is the bug.
4. **Check `cron_run_log`** before assuming refresh ran. The pricing cron logs every orchestrator invocation. Stale threshold is 26h daily / 17d biweekly. The `<CronStatusPanel>` on `/admin/products` reads this table.
5. **Use the Supabase MCP for inspection,** not blind code changes. Read the actual rows. Brody's project refs:
   - Production: `zucuzhtiitibsvryenpi`
   - Staging: `isqxqsznbozlipjvttha`

## Common-cause map by symptom

### "Pricing looks wrong on the consumer page"
- `pricing_cache` row exists but stale → cron didn't fire or fanned out to the wrong host. Check `cron_run_log` and the SSO-fan-out gotcha (must use `NEXT_PUBLIC_APP_URL`, not `req.url`, with forced `www` and `redirect: 'manual'`).
- `pricing_cache` row missing → matching never landed. Check `player_product_variants.match_tier` for that player. `no-match` means CH never priced it.
- `evMid` looks reasonable but slot cost is wild → score modulation. `lib/score-modulation.ts` folds `risk_flag` rows + `hype_tag` market_observations into `effectiveScore`. Most-negative risk wins (no stacking), hype tags stack with linear decay over `decay_days`.
- 1/1 SuperFractor sale yanked the average → `lib/pricing-refresh.ts` and `lib/analysis.ts` exclude `print_run <= 1` from per-player aggregated EV. If a 1/1 still shows up in the weighted slot math, the variant isn't tagged 1/1 — fix the import, not the engine.
- "Confidence is `null` on rows that should have it" → `pricing_cache.confidence` is sales-weighted across priced variants; fallback rungs in `lib/pricing-refresh.ts` write null. Check which rung actually fired.

### "Match landed on the wrong variant or didn't match at all"
- Variant has `match_tier` written by the v2 ladder. Tier order: `exact-variant → synonym → number-only → card-code → claude → no-match`. If a card matched on `claude` that should have matched on `exact-variant`, the catalog is missing that variant or the descriptor is wrong.
- Check `ch_set_cache` for the canonical CH set name. If the set isn't there, run "Refresh CH Catalog" on the product, or hit `/api/admin/refresh-ch-catalog`.
- `products.ch_set_name` MUST be set before `pre_release → live` transition; if matching is failing for a freshly-live product, that field may be wrong. Use the "Find on CH" widget in the product form to set the exact canonical name.
- Manufacturer-specific knowledge in `lib/card-knowledge/`. Bowman/Topps prefixes and naming are in `bowman.ts`. Panini (Prizm/Donruss/Optic) uses the `Master Checklist` sheet — see `docs/manufacturer-rules/panini.md`. Don't add classes here, only descriptor data.
- Combined-name rows (`Skubal / Blanco / Valdez`) are subset cards, not real entities — auto-flagged `insert_only=true` at import and excluded from team filters. If one is leaking into team math, the import flag didn't set.

### "Cron didn't run / no pricing refresh last night"
- Read `cron_run_log` first. Don't assume.
- Pricing cron fires 5x staggered between 4–6:30 AM UTC. Each invocation has a 270s budget, picks the stalest products (by `pricing_cache.fetched_at`), throttles to 3 concurrent CH workers.
- The classic silent failure: orchestrator fan-out POSTs to the `*.vercel.app` deployment URL hit Vercel Deployment Protection (SSO 401) before reaching the app. Orchestrator returns 200 with `processed=N ok=0 err=N`. Detection is `pricing_cache` writes in the cron window. Fix: fan-out resolves to `NEXT_PUBLIC_APP_URL` with forced www-prefix and `redirect: 'manual'`.
- Middleware lets `Authorization: Bearer ${CRON_SECRET}` bypass the `/admin/login` redirect on `/api/admin/*`.
- Catalog cron is separate, daily 3 AM UTC at `/api/cron/refresh-ch-catalogs`.
- Dormant pricing refresh is biweekly (1st + 15th) at `/api/cron/refresh-dormant-pricing`. Pre-release products skip all daily crons.

### "B-score / risk flag / hype tag didn't change anything"
- Score modulation runs at **render time** in `lib/score-modulation.ts` — there's no DB column for the modulated score. If `/break/[slug]` shows the wrong slot cost after a flag was added, the flag is either not active (`cleared_at IS NOT NULL`), or wrong scope, or the page is RSC-cached.
- Discord `/insight` writes to `pending_insights` first, then on ✅ applies to the relevant table. If a sentiment change "didn't take", check `pending_insights.status`.
- Sentiment scope can be `'global'` or `'product'`. Variant-scope hype + asking-price are captured but **engine doesn't read variant scope yet** (Phase 3c) — accumulating as field intel only.
- Asking-price is **display-only**. If you expect it to move fair value, it doesn't — yet.
- Odds observations from `/insight` are stored in `market_observations` but engine doesn't read them yet either.

### "Missing players / missing odds"
- Players come from the checklist parse. Topps PDF, Bowman XLSX, Panini XLSX (Master Checklist). See `lib/checklist-parser.ts`.
- Odds come from a separate Topps PDF parse via `app/api/admin/parse-odds/route.ts` (uses `pdf2json`, lazy-required). Panini doesn't publish odds — engine is null-safe.
- If a player exists in the checklist but not in `player_products`, the parser dropped them — usually a header-detection bug or a combined-name row.

### "RLS denied a read I expected to work"
- All 11 tables have RLS enabled. Most consumer-owned tables are owner-only (`user_breaks`, `user_chase_list`, `pricing_feedback`).
- Server reads should use the cookie-aware client (`lib/supabase-server.ts`) so the user JWT carries through. If a server action returns empty, check whether it's using the service-role client (`lib/supabase.ts`) or the cookie client.
- Admin actions need `requireRole('admin')` from `lib/auth.ts`.

### "Migration failed"
- CLI is linked to production. `supabase db push` to apply, `supabase migration repair --status reverted <timestamp>` to undo a failed apply.
- Files in `supabase/migrations/`. Naming is `YYYYMMDDHHMMSS_description.sql`.
- Don't re-run a migration that already partially applied — repair first.

## Inspection cheat sheet

```sql
-- Latest pricing for a player_product
select fetched_at, ev_low, ev_mid, ev_high, confidence
from pricing_cache
where player_product_id = '<id>'
order by fetched_at desc limit 5;

-- Match-tier distribution for a product
select match_tier, count(*)
from player_product_variants v
join player_products pp on pp.id = v.player_product_id
where pp.product_id = '<id>'
group by 1 order by 2 desc;

-- Cron health
select cron_name, status, processed, ok, err, started_at, finished_at
from cron_run_log
order by started_at desc limit 20;

-- Active risk flags for a player
select flag_type, severity, source, created_at, decay_days
from player_risk_flags
where player_id = '<id>' and cleared_at is null;

-- Recent hype tags (product-scope)
select payload->>'tag' as tag, payload->>'direction' as dir,
       payload->>'strength' as strength, decay_days, observed_at
from market_observations
where kind = 'hype_tag' and product_id = '<id>'
order by observed_at desc limit 20;

-- Pending Discord insights
select kind, status, payload, created_at
from pending_insights
order by created_at desc limit 20;
```

## Verification before declaring it fixed

1. **Reproduce the wrong number** in the database first. If you can't see it in the data, you can't fix it.
2. **Re-run the affected stage** (refresh pricing, refresh catalog, re-import checklist) and read the row again — don't trust UI cache.
3. **Spot-check a second player or product** to confirm the fix isn't player-specific.
4. **For engine-math changes**, walk through one example by hand and compare to the rendered number.
5. **Don't ship a pricing-engine change without re-running cron on at least one live product** and inspecting `pricing_cache` before/after.

## Logging the fix

- Every data fix → CHANGELOG entry with the symptom, the root cause stage, and what changed.
- If the bug exposed a missing invariant (e.g. "1/1s should never enter weighted EV"), add it to the relevant doc in `docs/` so it's findable next time.
- Recurring failure modes (silent cron, RLS bite, CH shape mismatch) → save a feedback memory.

## Files most often touched for data bugs

```
lib/engine.ts
lib/analysis.ts
lib/pricing-refresh.ts
lib/cardhedger.ts
lib/cardhedger-catalog.ts
lib/card-knowledge/
lib/checklist-parser.ts
lib/score-modulation.ts
lib/insights-parser.ts
app/api/pricing/route.ts
app/api/admin/refresh-product-pricing/route.ts
app/api/admin/refresh-ch-catalog/route.ts
app/api/admin/parse-odds/route.ts
app/api/admin/pricing-breakdown/route.ts
app/api/cron/refresh-pricing/route.ts
app/api/cron/refresh-ch-catalogs/route.ts
app/api/cron/refresh-dormant-pricing/route.ts
app/api/discord/interactions/route.ts
supabase/migrations/
```

## Reference docs to load on demand

- `docs/pricing-architecture.md` — full pricing pipeline (cache-read consumer + cron fan-out writer)
- `docs/cardhedger-matching.md` — CH matching v1 legacy notes
- `docs/catalog-preload-architecture.md` — CH matching v2 (current)
- `docs/cardhedger-questions.md` — open questions for the CH team
- `docs/score-modulation.md` — risk + hype math
- `docs/product-lifecycle.md` — pre_release / live / dormant
- `docs/manufacturer-rules/bowman.md`, `docs/manufacturer-rules/panini.md`
- `docs/plans/2026-05-06-cardhedger-data-audit.md` — open P1/P2/P3 punch list
