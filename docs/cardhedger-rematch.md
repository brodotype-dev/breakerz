# CardHedger re-matching + additions feed

How we recover CH card matches after CardHedger changes their card-match / adds
cards, and how we know when to do it.

## When to re-match

- River (CH) emails that they shipped **card-match changes** ("rerun any suspect
  matches or non-matches").
- The **CardHedger Additions** panel on `/admin/data-health` flags a set you
  track with an "⚡ tracked → re-match" badge (CH added cards to a set we depend
  on — see the feed section below).
- A product's CH coverage on `/admin/data-health` looks low (lots of unmatched
  variants) and a probe shows CH actually has the set.

Re-matching is safe: the matcher only touches **unmatched** variants
(`cardhedger_card_id IS NULL`), so it can add matches but never break existing
ones. Catalogs are refreshed nightly (3 AM UTC), so by the time you re-match,
`ch_set_cache` already reflects CH's current catalog.

## How matching works (context)

Our matcher is a **local tier-ladder against the cached CH catalog**
(`ch_set_cache`, populated from CH's `getCardsBySet`), NOT CH's `/card-match`
endpoint. Tiers: exact-variant → synonym → number-only → card-code → claude →
no-match. So "CH improved card-match" helps us via their improved **catalog
data** (which the nightly refresh pulls), and re-running our matcher picks it up.

## How to re-match

`/api/admin/match-cardhedger` accepts admin-cookie auth **or**
`Authorization: Bearer <CRON_SECRET>` (added 2026-06-04, PR #186), so it's
drivable by script as well as the admin "Run Matching" button.

Driver: [`scripts/drive-rematch.mjs`](../scripts/drive-rematch.mjs)

```bash
node scripts/drive-rematch.mjs <productId>
```

It multi-passes (the route's `IS NULL` window shifts as matches land, so one
pass skips some) until the unmatched count stops shrinking. Reads `CRON_SECRET`
+ `NEXT_PUBLIC_APP_URL` from `.env.local` and forces the `www` host (the apex
307-redirects — CLAUDE.md gotcha). After re-matching, kick a pricing refresh so
the recovered cards price:

```bash
curl -s -X POST "https://www.getbreakiq.com/api/admin/refresh-product-pricing" \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  -d '{"productId":"<productId>"}'
```

**Result on first run (2026-06-04):** 2025 Topps Chrome Football went ~50% →
99.3% matched (+2,489 cards, 0 review queue). The remaining all-unmatched
products (Topps Motif Basketball, O-Pee-Chee Platinum Hockey) are **CH catalog
gaps**, not matcher failures — request those sets from CH.

## The additions feed (knowing when CH adds cards)

CH has no release calendar, but `/v1/cards/additions-summary` reports what they
added per day (t-1) — `{category, set_name, subset, variants, added_date,
card_count}`.

- Wrapper: `getAdditionsSummary(startDate, endDate?)` in `lib/cardhedger.ts`.
- Nightly cron `/api/cron/refresh-ch-additions` (02:30 UTC) pulls a 4-day
  window and upserts into `ch_additions` (idempotent on
  `(added_date, set_name, subset)`, so a missed night self-heals).
- `/admin/data-health` renders the last 14 days via `getRecentCHAdditions`
  (`lib/ch-coverage.ts`) and flags additions whose `set_name` matches an active
  product's `ch_set_name` — the re-match signal.

So the loop is: **CH adds cards → additions panel flags the tracked set → run
`drive-rematch.mjs` for that product → pricing refresh.**
