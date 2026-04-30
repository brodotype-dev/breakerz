# Pre-release product page polish

**Status:** ✅ shipped 2026-04-30. Scope as planned — all three buckets landed in one PR (no schema/engine changes beyond the PSA 9 columns). See CHANGELOG entry of the same date.

## Context

The `pre_release` lifecycle infrastructure shipped 2026-04-27 (migration, admin picker/transitions, cron gates, dormant biweekly cron, consumer `PreReleaseLayout` with countdown + chase cards + 90-day comp table). The bones work but the consumer surface is thin — it reads as a stripped-down version of the live break page rather than a hype-rich pre-launch surface that justifies its own layout.

This pass polishes the pre-release consumer page in three coherent buckets, all rendering on `app/(consumer)/break/[slug]/page.tsx` when `lifecycle_status = 'pre_release'`:

1. **Hype/marketing surface** — make the page feel like a launch event, not a placeholder.
2. **Player intel** — make the 90-day comp table do real work (sort, group, surface top movers, more prominent risk flags).
3. **Phase 3 chip rendering** — pull live `market_observations` (hype_tag + asking_price) onto the page. The capture pipeline (Discord) is already shipping data into `market_observations`; the engine reads are deferred (Phase 3c, not in this plan), but **chip display** for pre-release is a clean slice because pre-release has no engine math to interfere with.

Display-only. No schema changes. No engine changes. No new crons.

---

## What lives where (today)

| File | Role |
|---|---|
| [components/breakiq/PreReleaseLayout.tsx](components/breakiq/PreReleaseLayout.tsx) | Current pre-release component: countdown, ChaseCardsPanel, player checklist with snapshots |
| [app/api/pre-release/player-snapshots/route.ts](app/api/pre-release/player-snapshots/route.ts) | 90-day CH comp fetcher with 24h cache; powers the snapshot map |
| [app/(consumer)/break/[slug]/page.tsx](app/(consumer)/break/[slug]/page.tsx) | Branches on `lifecycle_status`; fetches `chaseCards`, `rawPlayers`, `riskFlagMap` and passes them in |
| [components/breakiq/ChaseCardsPanel.tsx](components/breakiq/ChaseCardsPanel.tsx) | Existing chase tile grid — reused as-is |
| [lib/analysis.ts:225](lib/analysis.ts:225) | Reference implementation of how to query `market_observations` for hype_tag rows scoped to a product |

---

## Plan

### 1. Hype/marketing polish (visual)

All inside `components/breakiq/PreReleaseLayout.tsx`. No new files.

- **Countdown hero**: keep position but upgrade. Show `D · HH · MM` when ≥1 day, switch to `HH · MM · SS` ticking when same-day, "🔴 Live now" pulse when `daysUntilRelease === 0` or negative (admin hasn't flipped to live yet — visible nudge that lets the consumer know launch is happening). Use the sport gradient already pulled from `getSportStyle()` in the parent — accept `gradient` + `primary` as props instead of hardcoding purple.
- **Pre-release sub-hero**: a small 1-line ribbon under the countdown showing release-window context: "Hobby launches **Tue Jun 18** · MSRP $200/box · Expected case price $1,400". Pull `release_date`, `hobby_msrp`, `hobby_case_cost` (and AM equivalents if set) — already on `Product`. Skip rows where the data isn't present.
- **"Watching" widget** (replaces empty whitespace between chase cards and roster): top 3 players by `raw_avg_90d` (use the same `snapshots` map already fetched). Card-style with player name + raw avg + a one-line teaser ("90d avg $480 raw, $1.2k PSA 10"). Skipped entirely if no snapshots have history.
- **Empty state polish**: existing "Checklist not loaded yet" stays but gets the same border-treatment as the other panels for consistency.

Keep all CSS variables and the existing terminal-surface theme. No new colors except the sport gradient already in scope.

### 2. Player intel improvements

Still inside `PreReleaseLayout.tsx`. The roster table grows; no new component needed yet (split out only if it crosses ~150 lines).

- **Sort selector** above the table: `Raw avg desc` (default), `PSA 10 desc`, `Alphabetical`, `Rookies first` (current default). 4-option `<SegmentedControl>` — the component is already imported in the parent break page; can be reused here.
- **Group-by-team toggle**: chip control next to sort. Off by default. When on, render players grouped under team headers (sticky-ish team labels), still respecting the current sort within each group.
- **Filter chips**: `All / Rookies only / Has history / Has risk flag`. Single-select chip row. Current behavior = "All".
- **Risk flag treatment**: the current 9px red pill is too easy to miss. Bump to 11px, swap to a filled background with subtle pulse on `injury` and `suspension` (most consumer-relevant flag types). Tooltip on hover shows the full `note` from `player_risk_flags`. The data is already in `riskFlagMap`.
- **Graded breakout column** (already partly there): split the existing "PSA 10 avg" cell into PSA 9 / PSA 10 micro-cells when the snapshot has both. Snapshot endpoint currently only requests Raw + PSA 10 — extend it to also request PSA 9 (`get90DayPrices` accepts a grade param). Add `psa9_avg_90d` / `psa9_sales_90d` to the `pre_release_player_snapshots` table — small migration. **This is the only schema change in the plan.**
- **Top performer flair**: top 3 sorted players get a small ▲1 / ▲2 / ▲3 rank badge. Pure visual, no DB.

### 3. Phase 3 chip rendering (display-only)

Pre-release-specific subset of Phase 3c from `docs/plans/2026-04-29-break-analysis-v2.md`. Engine reads stay deferred — we're only rendering the chips here.

- **Server-side fetch in `app/(consumer)/break/[slug]/page.tsx`**: add a parallel `supabase.from('market_observations').select(...).eq('product_id', productId).gt('expires_at', nowIso).is('superseded_at', null)` call alongside the existing `chaseCards` / `players` / `riskFlagMap` fetches. Limit to lifecycle = pre_release to avoid touching the live page in this PR. Two result sets: `hype_tag` rows and `asking_price` rows. Pass both into `PreReleaseLayout` as props.
  - **Reuse pattern from [lib/analysis.ts:225](lib/analysis.ts:225)** — same shape, same filters.
- **Hype-tag chips**: next to player name in the roster (and on the "Watching" widget tiles). Map `payload.tag` → label + color: `release_premium` (orange, ▲), `cooled` (gray, ▼), `overhyped` (yellow, ⚠), `underhyped` (green, ★). Tooltip shows the source narrative if present in `payload.source_note`.
- **Product-scope hype-tag chips**: any `scope_type='product'` rows render as a single banner above the chase cards: "🔥 Release premium tag active — last logged 2 days ago by @kyle". Most direct hype signal.
- **Asking-price chip**: any `asking_price` row with `scope_type='product'` and recent `observed_at` renders next to the sub-hero ("Streams asking **$1,400–$1,600/case** · 3 obs"). Variant-scope asking-price for pre-release → skipped (no variants live yet, those rows shouldn't exist for pre-release products).
- **No writes, no engine math, no scoring.** This is the pre-release version of the deferred Phase 3 display slice.

---

## Critical files to modify

```
components/breakiq/PreReleaseLayout.tsx       — primary surface; absorbs all 3 buckets
app/(consumer)/break/[slug]/page.tsx          — adds market_observations fetch + props for pre-release branch
app/api/pre-release/player-snapshots/route.ts — adds PSA 9 to CH fetch, persists psa9_avg / psa9_sales
supabase/migrations/<new>_pre_release_psa9.sql — adds psa9_avg_90d / psa9_sales_90d columns to pre_release_player_snapshots (nullable; no backfill)
```

Possibly:
```
lib/types.ts — extend the Snapshot row type if exported anywhere shared
```

---

## Out of scope (explicitly)

- **Engine reads** for hype/asking-price/odds (Phase 3c proper) — pre-release has no engine running, so this PR doesn't unblock it. Live page chip rendering also stays deferred.
- **Variant-name → variant_id resolution** — pre-release products generally don't have populated variants yet.
- **Admin readiness checklist** ("ch_set_name set? checklist imported? chase cards set?") — useful but separate workstream; not in the consumer-polish scope answered.
- **Pre-order / notify-me capture** — could be a follow-up; no email infra changes here.
- **Auto-flip pre_release → live on release_date** — already noted as a future feature flag in the doc; outside this pass.
- **Schema or behavior changes for live or dormant products.**

---

## Verification

1. Apply the PSA 9 migration to staging Supabase (`isqxqsznbozlipjvttha`).
2. Pick a product in staging and flip its `lifecycle_status` to `pre_release` (or use one already in pre-release). Make sure it has chase cards + a checklist + a few risk flags.
3. Hit `/break/[slug]` while logged in:
   - Countdown hero renders sport-gradient with correct day/HH:MM:SS logic across `release_date` ≥ tomorrow / today / yesterday.
   - Sub-hero ribbon reads release date + MSRP + case cost when set; collapses cleanly when fields are missing.
   - "Watching" widget shows top 3 players by raw avg, hides if no history rows.
   - Sort/filter/group controls all change the rendered roster correctly. Defaults to Raw avg desc.
   - Risk-flag pills are visibly more prominent; injury/suspension pulse; tooltip shows full note.
   - PSA 9 column populates for players with PSA 9 sales; falls back gracefully when only Raw / PSA 10 exist.
4. Insert a few `market_observations` rows manually for the test product:
   - One product-scope `hype_tag` (`release_premium`, strength 1, decay_days 14, expires_at = now+14d).
   - One player-scope `hype_tag` for a roster player.
   - One product-scope `asking_price` row with `payload.observed_price_low/high` and `source: 'stream_ask'`.
   - Confirm chips/banner render and tooltips show source notes.
   - Set `superseded_at` on one row → confirm it disappears.
5. Pick a product in `live` lifecycle and confirm none of the new visual changes leak in (the live page reads its own branch).
6. Pick a product in `dormant` lifecycle and confirm same — no leak.
7. `/break/[slug]/page.tsx` server fetch: confirm in network tab that the new `market_observations` query is gated to pre-release products (skipped for live/dormant) so we don't add latency to the live path.
