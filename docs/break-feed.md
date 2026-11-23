# Break Feed

**What the market is actually breaking, and how much of it we can price.**

Admin-only surface at `/admin/break-feed`. Shipped 2026-11-23 (PR #263).

The headline is deliberately the **gap**, not the coverage. A row we match is
confirmation; a row we can't match is the actionable thing — a product being
sold right now that we have no catalog for, which means we could not value
that spot if a user asked.

---

## The structural finding this is built on

Verified by hand against live sources on 2026-11-22. **The live-break market
splits in two, and only one half can be ingested at all.**

| | Pre-lists breaks? | What we get |
|---|---|---|
| Shop storefronts (Steel City Collectibles) | Yes, as e-commerce products | Product, spot price, spots left, break date, breaker, sport |
| Live platforms (Fanatics Live, Whatnot) | **No, by design** | Show title + time + breaker only |

The evidence for the second row, because it's the part people assume is just a
scraping problem:

- BreakRadar (a working aggregator) states plainly that Whatnot publishes no
  break list before a show starts — seller and time, not a break list.
- Fanatics Live behaves identically. A **named, product-specific** show two
  days out (`GILDED BASEBALL RELEASE DAY w/ EAST WEST!`) renders
  *"This shop is empty (for now). This shop doesn't have anything listed at
  the moment."* The breaker's own pinned comment on that show reads
  *"10-CASER DROPPING TONIGHT! TEXT BROCK FOR PRE-CLAIMS."*

So on live platforms the inventory does not exist until the breaker drops it,
and the real pre-break market happens in texts and DMs, off-platform. That is
not a gap we can close with a better scraper. `price` and `spots_available`
are nullable for this reason and the UI labels which fidelity each row is.

**Show titles are still signal.** They tell us which products are getting
attention and when, which is all the coverage question needs.

---

## Sources

`break_feed_sources` — one row per place we watch. `kind` drives the fetcher.

| kind | identifier | How |
|---|---|---|
| `steel_city` | `break-room` | Alexandria provider `steelcitycollectibles-com / products/list_group_breaks`, paginated |
| `fanatics_live` | shop slug, e.g. `east-west-sports-cards` | Firecrawl markdown scrape of `fanatics.live/shops/<slug>` |

Adding a Fanatics Live shop is an insert, not a deploy.

### Alexandria runs on the key we already have

It is a `POST https://api.firecrawl.dev/v2/scrape` with an `alexandria` body
instead of a `url`, authenticated with the same `FIRECRAWL_API_KEY` as
[lib/waxstat.ts](../lib/waxstat.ts) and
[lib/upper-deck-parser.ts](../lib/upper-deck-parser.ts). No new vendor, no new
key, no new contract. ~15 credits per full refresh (3 pages today).

**Steel City is the only structured group-break provider in the whole
Alexandria library.** The `fanatics-com` provider is retail merchandise
(jerseys), not Fanatics Live breaks, and there is no Whatnot provider. That is
the ceiling on this feed: roughly 45 sports breaks a week from one shop,
everything else being custom scraping.

### Gotcha: Alexandria reports failure inside an HTTP 200

Upstream provider failures come back as an `error` object nested in a 200
envelope (`$.data.alexandria[0].error`) — observed live, a `provider_error`
with `status: 502` that cleared on the next attempt. Reading only the HTTP
status hands you **zero products**, which the disappeared-sweep then reads as
*the entire board came off the market*. `alexandriaError()` checks for it
explicitly and `alexandriaPage()` retries up to 3× with backoff.

---

## Matching: strict, and not an LLM call

[lib/break-feed-match.ts](../lib/break-feed-match.ts). Two rules:

1. Every **core token** of a product name must appear in the title.
2. No **intruder token** may sit inside the span those tokens occupy.

Rule 2 is the important one. It stops `2026 Topps Chrome Baseball` from
claiming a `2026 Topps **Cosmic** Chrome Baseball` listing — one word apart, a
completely different product at a completely different price point. Because
the check is generic, it also rejects Stadium Club, Five Star, Museum,
Inception, Gilded and every other line we've never onboarded, with no
vocabulary list to maintain.

Season is compared when both sides state one. A title naming a different year
is rejected — that's the 2025-vs-2026 Chrome Football case, and matching it
would hide exactly the staleness this surface exists to show.

**Why strict:** the failure modes are asymmetric. A miss shows up here as a
gap to review. A false positive silently claims we can price something we
can't. So the matcher is tuned to miss rather than over-claim.

### Aliases

Retail copy and our catalog diverge in a few known places; these live in a
greppable `TITLE_ALIASES` map rather than being smeared into the logic.

| Our name | What retail calls it |
|---|---|
| 2026 Bowman Sapphire Baseball | Bowman **Chrome** Baseball Sapphire **Edition** |
| O-Pee-Chee Platinum Hockey | OPC Platinum |

### Grouping the gap

`productPhrase()` collapses a title to the product it sells, so three breaks
of the same product rank as one row with a count. `phraseNamesProduct()` then
gates the ranking on a stated year, which keeps recurring live-platform show
brands (`EW NFL MONDAY! PYTS AND BREAKS ALL DAY`, `BIGGEST AND BEST CHARACTER
BREAKS ON FANATICS`) out of it — those are timeslots, not roster decisions,
and they were outranking real signal on the first live pull. They're counted
and noted beneath the table rather than dropped.

Regression suite: `npx tsx scripts/verify-break-feed-match.mjs` — 28 matcher
cases + 8 phrase cases, all built from real captured titles.

---

## Schema

Migration `20261122140000_break_feed.sql`. Both tables are **service-role
only** (`REVOKE ALL FROM anon, authenticated`) per CLAUDE.md gotcha #12 —
nothing here is consumer-facing yet.

`upcoming_breaks`, keyed `(kind, source_ref)`:

- `matched_product_id` / `match_confidence` / `match_reason` — `match_reason`
  is the column that tells us what to onboard next, e.g.
  *"2025 Topps Chrome Football: tokens match but season differs (title 2026)"*
- `price` / `spots_available` — null on live-platform rows, see above
- `sport` — the provider's tag for Steel City (non-sports rows come back null
  and are stored as `non_sports`, a cleaner filter than anything we'd write
  from a title); classified from the title for Fanatics Live, where null
  genuinely means "couldn't tell" and is **not** the same as `non_sports`
- `first_seen_at` / `last_seen_at` / `disappeared_at` — a break that sold out
  is still evidence of what the market wanted, so rows are marked, never
  deleted

The disappeared-sweep only runs when **every** source refreshed cleanly, so a
partial failure can never mark a live board as gone.

---

## Refresh

- **Nightly cron** `/api/cron/refresh-break-feed`, 09:00 UTC (after the
  pricing window, which owns 03:00–06:40).
- **Admin button** on `/admin/break-feed`.
- **Script/manual**: `POST /api/admin/refresh-break-feed` accepts either an
  admin session or `Authorization: Bearer $CRON_SECRET`.

---

## First live pull (2026-11-23)

88 rows (68 Steel City + 20 Fanatics Live) → 66 sports, 22 non-sports →
**3 matched. 5% coverage.**

```
 5x  2026 Topps Chrome Football      football   2025 Topps Chrome Football: season differs (title 2026)
 3x  2026 Topps Museum Collection    baseball   no product in our catalog matches
 2x  2026 Topps Cosmic Chrome BB     baseball   no product in our catalog matches
 2x  2026 Panini Absolute Football   football   no product in our catalog matches
 2x  2026-27 UD Black Diamond        hockey     no product in our catalog matches
```

36 distinct unmatched products; 17 show-brand titles set aside.

The read: we're a release cycle behind in several lines. The May 2026
"most-recent-Bowman-per-sport" scoping decision
([private-beta-scope.md](./private-beta-scope.md)) has aged out — the market
is breaking 2026 Chrome Football while we price 2025. This list is the
onboarding queue, ranked by how many breakers are running each product.

---

## Not built

- **Consumer "upcoming breaks" panel** on product and player pages. Cheap once
  the ingest exists (player → `player_products` → product → breaks comes free
  off existing checklists), but it would render empty on 10 of 11 products
  today. Gated on coverage, not on effort.
- **Pre-filled logging.** A known break could prefill product, format counts,
  breaker and date into `/my-breaks?view=new`, leaving only team and ask price
  — most of the manual-work complaint. Same gate.
- **Per-team slot asks from shop detail pages.** The list endpoint gives a
  break-level price; per-team breakdown inside a PYT would need
  `products/get_product` per break. Unverified, and a real multiplier on
  `market_observations` if it works.
