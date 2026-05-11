# CardHedger — Questions & Scenarios for the Team

Refined list for a focused conversation with the CH team. Organized by priority and grouped by theme. Each section includes the business impact so we can triage together.

*Last updated: 2026-05-10*

**Status legend:**
- 🟢 **Open** — needs CH input or hasn't been raised yet. These are what to send.
- ✅ **Answered** — closed-out, kept here as historical context. Don't re-send.

**Quick summary of what's still open as of 2026-05-11:**
- **P1 — blocking real products today:** Q14 (Topps Baseball Series 1 vs Series 2 vs Update — no catalog split), Q15 (catalog coverage SLA + Draft Sapphire missing)
- **P1.5 — sales feeds:** Q12 (player-scoped sales feed), Q13 (per-card cross-grade history → enables Grade Ratio Value)
- **P2 — structural:** Q4 (parallel-level card_id coverage), Q5 (multi-player autographs — partial), Q6 (canonical variant naming)
- **P3 — partnership:** Q8 (webhook), Q9 (test fixture), Q10 (dev channel). Q7 (batch card-search) mostly mooted by Q3.

Q1–Q3 + Q11 are fully closed.

---

## Priority 1 — Blocking matching accuracy

These are the specific gaps that *were* causing our ~24% failure rate. **All three resolved via River's 2026-04-20 reply** — keeping them here as historical context only.

---

### 1. ✅ Answered 2026-04-20 — Does `card-search` return a `number` field for autograph sets?

**Original concern:** For autograph sets (BMA-*, CPA-*, BPA-*, FDA-*), we consistently got `number: ""` or null from candidates, breaking code-based disambiguation.

**River's answer:** `number` IS populated across all four prefixes — he sampled 100+ cards per prefix (0/25 BMA, 0/100 CPA, 0/41 BPA, 0/13 FDA null). What we were seeing was the **fuzzy-fallback pattern**: when `/card-search` doesn't find a good match, it falls back to semantic neighbors which may come from unrelated sets with sparser metadata. Brody followed up with concrete failing-case examples; River added the missing rows directly:
- BMA — added: BMA-JJW, BMA-RS, BMA-TB (2025 Bowman's Best Baseball Superfractor /1)
- BPA — added: BPA-PS (Skenes), BPA-SO (Ohtani) (2025 Bowman's Best)
- CPA — 2025-26 Bowman Basketball was being added that week (CPA-AF Flagg, CPA-CC Carr)
- FDA — added: FDA-GG (Vlad Sr/Jr), FDA-FI (Fien dual) (2025 Bowman's Best Family Tree)

**Takeaway:** treat `number: null` returns as a soft signal that we're hitting fuzzy-fallback, not a data gap. When that happens, send River specific examples and he'll trace + backfill.

**Side note from River:** going forward (2026 onward), Bowman Chrome Prospects subset is being merged into the main Bowman Chrome set. Same for Prospect Autographs. Our parsers and CH naming should expect this consolidation in newer products.

---

### 2. ✅ Answered 2026-04-20 — Are CPA-* Chrome Prospect Autographs indexed in card-search?

**Original concern:** Queries for `CPA-DL 2025 Bowman Chrome` were returning the player's BCP-* base card instead of the autograph.

**River's answer:** CPA cards are fully indexed (`CPA-JH` direct returns 144 matches across years/players). The issue was query shape, not coverage:
- **Always include "Auto" or "Autograph"** in the query — without it, the base BCP variant outranks the autograph because base is a stronger token match on player+year+set.
- **Pass the code directly with the dash** (`CPA-JL`, not `CPA JL`) — it's the fastest, most deterministic path and returns every parallel of that card.

**Action taken:** match-flow context updated to always send `Auto`/`Autograph` keyword + code-with-dash for autograph rows.

---

### 3. ✅ Answered 2026-04-20 — Is there an endpoint to retrieve all cards in a given set?

**Original concern:** We were making 1000+ individual `/card-search` calls per product import, one per variant.

**River's answer:** Already exists — use `/v1/cards/card-search` with the `set` parameter (exact name match) and pagination. Example: `{ set: "2024 Bowman Chrome Prospects Baseball", page: 1, page_size: 100 }` returns 9,398 cards across 94 pages with `number` and `card_id` populated on every row.

**Critical caveat:** set names must match CH's exactly. Hobby naming and CH naming diverge (e.g. autographs live under the parent `Prospects` set, not a separate `Autographs` set — autograph status inferred from `CPA-*` prefix + variant string). **If the set name doesn't exist, the filter silently fails and you get the entire 2.9M-card corpus back** — this was the bug that made us think the filter was broken.

**Discovery flow:** `/v1/cards/set-search` returns canonical set metadata. Recommended import flow:
1. Call `/set-search` once per product line → get canonical set name(s)
2. Loop `/card-search` paginated with `{ set: "...", page: N, page_size: 100 }` until exhausted
3. Match locally against the in-memory catalog (`number` / `card_id` / `variant`)

**Status:** this is exactly what our v2 catalog pre-load architecture (shipped 2026-04-21, [docs/catalog-preload-architecture.md](catalog-preload-architecture.md)) does. We're using `ch_set_cache` keyed on the exact CH canonical name from `products.ch_set_name` and the daily catalog-refresh cron paginates `/card-search` per River's flow. Match rate jumped from ~76% to 95%+ on Bowman.

---

### 14. 🟢 Open — Topps Baseball Series 1 vs. Series 2 — no way to differentiate

We hit this trying to ship `2025 Topps Series 1 Baseball` and `2025 Topps Series 2 Baseball` as separate products on our platform. Topps releases them months apart (Series 1 ~February, Series 2 ~June, Update ~December) and breakers price them differently — each break only pulls cards from its specific series. We *have* to treat them as separate products.

**The CH catalog conflates them.** `/set-search` for `"2025 Topps Series"` returns zero matches. The closest hit is the parent set:

```
POST /v1/cards/set-search { "search": "2025 Topps Series", "category": "Baseball" }
→ []

POST /v1/cards/set-search { "search": "2025 Topps Baseball", "category": "Baseball" }
→ "2025 Topps Baseball"
   "2025 Topps Update Baseball"   ← maps to Topps Update (the December drop)
   ... (other 2025 Topps Baseball products)
```

The parent set `2025 Topps Baseball` is **56,407 cards across 565 pages** with card_numbers spanning **1 → 573+** on the first page sample alone — i.e. it contains BOTH Series 1 (canonical card_number range 1–330) and Series 2 (331–660) under one umbrella. The only signal we can see that distinguishes them is the numeric card_number; there's no `series` field on the card object (`description`, `player`, `set`, `number`, `variant`, `card_id`, `image`, `category`, `category_group`, `set_type`, sales counts, `rookie`, `gain`, `prices`).

**Question:** Is there a recommended pattern for splitting Series 1 vs Series 2 vs Update?
- Option A: Are these separate sets in your catalog under non-obvious canonical names we haven't found via `/set-search`?
- Option B: Is there a field on the card object (`set_type`? something hidden?) that flags series?
- Option C: If neither, would you consider either splitting them into `"2025 Topps Series 1 Baseball"` / `"2025 Topps Series 2 Baseball"` / `"2025 Topps Update Baseball"` (canonical name level) OR adding a `series: 1 | 2 | "update"` field on cards in the existing parent set?

**Why it matters:** Today our `2025 Topps Series 1 Baseball` product is matched against `ch_set_name: "2025 Topps Baseball"` (the parent), which pulls **1,249 players × 43,213 variants** — far inflated for a 330-card Series 1 release. Slot pricing, chase-card surfacing, and Recent Sales all leak Series 2 data into a Series 1 break analysis. The workaround we'd otherwise have to ship is a card_number-range filter (`1–330 → Series 1`, `331–660 → Series 2`, prefixed → Update inserts) hardcoded per-year, which is brittle as Topps adjusts series sizes annually.

**Scenario:**
> Product: 2025 Topps Series 1 Baseball (cards #1–330, hobby cases break separately from Series 2)
> Today: matched against `ch_set_name="2025 Topps Baseball"` → 56,407 cards
> Result: pricing pulls in Series 2 sales which are not in the box
> Ideal: `/set-search` returns a `"2025 Topps Series 1 Baseball"` canonical name, OR a card-level `series` field on the existing parent set

---

### 15. 🟢 Open — Catalog coverage SLA + visibility into ingestion pipeline (Bowman Draft Sapphire as the trigger)

**The structural ask.** When a new sealed product hits hobby shelves, how long until it's in CH's catalog, and how do we — as an integrator — see what's covered vs. not before we configure a product? Today we have to discover gaps by failing: configure `ch_set_name`, run matching, watch slot prices come back nonsensical, manually trace it back to a coverage gap. We need a feed (or even just a documented SLA + queryable "by-year, by-brand" inventory) so we can manage user expectations and avoid mis-anchoring to wrong umbrella sets.

**Concrete trigger (2026-05-11):** 2025 Bowman Draft Sapphire Baseball releases publicly and breaks live on every major platform. **CH has no `2025 Bowman Draft Sapphire` (or `2025 Bowman Chrome Draft Sapphire`) canonical set.** Every other year does — verified via `/set-search`:

```
2019 Bowman Chrome Draft Sapphire Baseball  ✅
2019 Bowman Draft Sapphire Baseball          ✅
2020 Bowman Chrome Draft Sapphire Baseball  ✅
2020 Bowman Draft Sapphire Baseball          ✅
2021 Bowman Draft Chrome Sapphire Baseball  ✅
2022 Bowman Chrome Draft Sapphire Baseball  ✅
2022 Bowman Draft Sapphire Baseball          ✅
2023 Bowman Chrome Draft Sapphire Baseball  ✅
2024 Bowman Chrome Draft Sapphire Baseball  ✅
2024 Bowman Draft Sapphire Baseball          ✅
2025 — (none)
```

Full 2025 Bowman Baseball coverage in CH today:

```
2025 Bowman Baseball
2025 Bowman Chrome Baseball
2025 Bowman Chrome Mega Box Baseball
2025 Bowman Chrome Prospects Baseball
2025 Bowman Chrome Sapphire Baseball       ← NOT the Draft Sapphire product
2025 Bowman Draft Baseball
2025 Bowman Draft Chrome Baseball          ← flagship Draft, no Sapphire parallels
2025 Bowman Draft Mega Box Baseball
2025 Bowman's Best Baseball
```

**Downstream impact.** We mis-anchored our `2025 Bowman Draft Baseball Sapphire` product to `2025 Bowman Chrome Sapphire Baseball` (closest-looking umbrella). That's a completely different physical product — Bowman flagship Sapphire features MLB stars + Chrome prospects with `BCP-*` codes; Bowman Draft Sapphire features 2025 draftees only with `BDC-*` codes. Net effect: 14 "Royals" player_products on our break page; 6 of them (Bobby Witt Jr., Caglianone, Salvador Perez, etc.) **aren't in the actual product**. Slot prices computed against the wrong card pool entirely. We didn't catch it for weeks because the failure is silent — `/card-search` happily returns BCP-* cards for "Witt 2025 Bowman" queries, and our search-fallback rung persists those mis-matches to `pp.cardhedger_card_id`.

**Specific asks:**

1. **Timeline for 2025 Bowman Draft Sapphire.** Topps released it late June 2025. When can we expect coverage? Canonical name suggestion: `2025 Bowman Draft Chrome Sapphire Baseball` (matching the 2019, 2021, 2022, 2023, 2024 pattern).
2. **Catalog inventory endpoint.** Does CH expose a queryable list of "every set you have for year=2025, brand=Bowman" so we can detect coverage gaps proactively instead of through user complaints? `/set-search` works for discovery if we know the name to search for, but doesn't surface what we DON'T have.
3. **Typical SLA from product release to ingestion.** Some products land in CH within days (the Topps Series 1/2 umbrella was there immediately); others take weeks (Draft Sapphire is now ~10 months post-release). Is there a documented cadence, a backlog we can see, or factors that prioritize one product over another?
4. **Interim handling when coverage is missing.** For products you haven't ingested yet, do Sapphire parallels live under the flagship Chrome umbrella temporarily (e.g., would `2025 Bowman Draft Chrome Baseball` contain Sapphire variants tagged differently)? Or are they entirely absent until the dedicated set is created? We checked `BDC-185` Hammond in `2025 Bowman Draft Chrome Baseball` — only flagship Chrome parallels (Refractor, Yellow Refractor, Yellow Geometric, etc.); zero Sapphire-flavored variants (`Yellow Sapphire /75`, `Gold Sapphire /50`, etc.).
5. **Notification for new sets.** Q8 already asks about a webhook for new cards; this is the set-level corollary. Even an RSS feed or weekly "new sets added" digest would let us close the loop.

**Why this matters beyond Bowman Draft Sapphire.** This isn't a one-product issue — it's the integration risk that we have no way to know what's missing. Every new Topps or Panini release has the same exposure window: we configure a product, miss that it isn't yet in CH, and our slot prices are silently anchored on the closest-matching parent umbrella (which is almost always wrong for a Sapphire / Update / parallel-variant product). The "Find on CH" admin search ranks by 30d sales volume, so a stale 2022 entry will out-rank a non-existent 2025 entry — making the wrong choice look like the right one.

**Scenario:**
> Product: 2025 Bowman Draft Sapphire Baseball (released late June 2025, breaking live as of 2026-05)
> Topps checklist: 200 base prospects (BDC-1..200) × 6 Sapphire color parallels + 30 CPA-* autos × 6 Sapphire parallels + 18 SS-* + 15 SSA-* = ~1,500 unique card configurations
> CH coverage: 0 of those 1,500 are in CH today
> Closest match the admin tool found: `2022 Bowman Draft Sapphire Baseball` (3 years old, wrong roster entirely)
> Our system: silently anchored to `2025 Bowman Chrome Sapphire Baseball` (different product, MLB stars + Chrome prospects with BCP-* codes)
> Real user impact: every break analysis for this product reads as if it were Bowman Chrome Sapphire — pricing a slot of Royals 2025-draftee prospects against Bobby Witt Jr. MLB veteran sales.

---

## Priority 1.5 — Sales feeds (added 2026-05-09)

Two related questions about how we surface recent sales data on consumer surfaces. Triggered by a real bug: on the Wemby player page (`/player/[id]`) for our most-tracked basketball player across 9 live products, the "Graded" tab shows 0 sales while "Raw" shows 25. Wemby has obvious graded volume on a year-old Topps Chrome Sapphire product, so something in our query path is missing it.

---

### 11. ~~Is `grade` on `/v1/cards/comps` a filter or a hint?~~ ✅ Answered 2026-05-09

**Answer (probed directly): `grade` is a clean filter.** Calls for `grade='PSA 10'` against Wemby Sapphire base (`1771934708315x...`) returned 4 PSA 10 sales (no other grades mixed in); `grade='PSA 9'` returned 2 PSA 9 sales; `grade='Raw'` returned 12 raw sales. Filter is doing exactly what we expected.

The "Graded 0" symptom we were investigating turned out to be **on our side**: [app/api/player-profile/route.ts](../app/api/player-profile/route.ts) was merging all grades into one pool and slicing top-25-by-date globally. With raw ~3× the sales volume of graded for active players, the top 25 was always entirely raw. Fixed 2026-05-09 by bucketing per grade group before slicing. No CH ask needed.

Keeping the question here for context — the failure mode was easy to misread as a CH issue and the resolution is worth knowing for future debugging.

---

### 12. 🟢 Open — Is there a player-scoped sales feed?

To populate "Recent Sales for Wemby across all his products," we currently:
1. Pull every `cardhedger_card_id` for every variant of every player_product.
2. Heuristically pick 1–3 "best" variants per product (we score numeric card_number ahead of alphanumeric, then shortest variant_name).
3. Fan out *N cards × 3 grades* parallel calls to `/v1/cards/comps` (capped at 15 cards × 3 = 45 calls).
4. Dedupe by `(date, price, grade, platform)`, sort newest-first, slice to 25.

This breaks two ways:
- The "best base" heuristic mis-picks when graded volume actually lives on chase parallels with non-numeric card numbers (e.g. an Aqua Refractor /99 has more graded sales than the base).
- We're hammering you with 45 calls per player page-view to render a 25-row panel.

**Question:** Is there (or could there be) a `player_id`-scoped sales endpoint — e.g. "last 50 sales for player X across all card_ids, optionally filtered by grade or set"? Even something paginated would let us drop our heuristic + fan-out entirely.

**Adjacent ask:** Alternately, does `/v1/cards/comps` (or another endpoint) accept multiple `card_id`s and/or multiple grades per call? A single batch call returning `[{card_id, grade, sales[]}]` would collapse our 45-call fan-out to 1.

**Scenario:**
> Goal: render "Last 25 sales for Victor Wembanyama, any product, any grade"
> Today: 9 products × 3 candidate variants × 3 grades = up to 81 calls (capped at 45)
> Ideal: 1 call — `/v1/players/{player_id}/recent-sales?limit=25`

---

### 13. 🟢 Open — Per-card cross-grade history for Grade Ratio Value modeling

Card Ladder publishes a "Grade Ratio Value" model ([docs/competitor-intel/cardladder-vs-breakiq-analysis.md](competitor-intel/cardladder-vs-breakiq-analysis.md)) that derives a stale card's price from the historical multiplier between grades — e.g. for a PSA 10 that hasn't sold in a year, look at when it *did* sell vs. a Raw or PSA 9 sale of the same card around the same time, and apply that ratio to the most recent comp grade's sale.

For us, this would replace hard-coded `evMid × 2.5` (PSA 10 fallback) and `× 0.35` (Raw fallback) multipliers with card-specific ratios — a meaningful accuracy gain on chase parallels where the population multiplier is most often wrong.

**Question:** Does any current endpoint return pair-wise per-grade sales history for a single `card_id`? Specifically, given one `card_id`, can we get "all sales across Raw / PSA 9 / PSA 10 with dates and prices, grade-tagged" so we can compute the historical ratio in-app?

**Why it matters:** This would unlock a real algorithmic improvement that's been validated in the wild by Card Ladder. The data is already on your side — we just need it shaped so we can derive ratios per card_id rather than per population.

---

## Priority 2 — Structural understanding

These don't block us today but the answers will inform how we architect Phase 2 of our matching (variant-level card_id assignment).

---

### 4. 🟢 Open — For a given card number, how many card_ids exist — one per parallel?

Example: Jacob Wilson BCP-153 in 2025 Bowman Chrome. The Topps checklist has 100+ parallels (Base, Refractor, Gold /50, Superfractor 1/1, etc.).

**Question:** Does CH have a separate `card_id` for each parallel, or does one `card_id` represent the card across all finishes? And if separate: which parallels do you index? (All of them, or just the ones with enough sales data?)

**Why it matters:** If each parallel has its own `card_id`, we want to search for parallel-specific cards for high-value finishes (Gold /50 and up). For low-value parallels with sparse data, falling back to the base card_id is fine. Knowing your coverage model helps us decide which variants are worth a dedicated search vs. which should just inherit the base card_id.

**Scenario:**
> We have BCP-153 base (card_id: ch_aaa) confirmed via matching.  
> We also have a "Gold Refractor /50" variant row for the same player.  
> Query: `"Jacob Wilson 2025 Bowman Chrome Gold Refractor"`  
> Does this return a distinct card_id for the Gold, or the same as Base?

---

### 5. 🟢 Open (partial) — How do you handle multi-player autograph cards?

> **Partial answer (2026-04-20):** River added several FDA dual-auto rows for 2025 Bowman's Best Family Tree (FDA-GG, FDA-FI). The remaining open piece is the *general pattern* — what's the canonical query for DA-/TA-/QA- multi-player autos beyond the specific cards River backfilled? Code-with-dash + "Auto" keyword (per Q2's resolution) is likely the answer; needs confirmation.

We have dual (DA-), triple (TA-), and quad auto (QA-) cards where the XLSX stores the player field as slash-delimited names (e.g. `"Dylan Crews/James Wood"`). Searching by combined name doesn't work. Searching by code alone is inconsistent.

**Question:** Is there a recommended pattern for these? A lookup by card code (`DA-WC`) would be ideal if you index by `number` for multi-player sets.

**Scenario:**
> Card: `DA-WC` — Dylan Crews / James Wood, 2025 Bowman's Best  
> Query by combined name: no reliable results  
> Query by code: `"DA-WC 2025 Bowman's Best"` — returns candidates but `number` is null, can't confirm  
> Ideal: direct lookup by `number: "DA-WC"` within the set

---

### 6. 🟢 Open — What does the `variant` field contain for base Bowman Chrome Prospect cards?

We've seen `"Base"`, `"Refractor"`, and sometimes empty for cards that Topps calls the base BCP card. Our Claude matching context teaches it that `Retrofractor` (Bowman's term) maps to `Base` or `Lazer Refractor` in your catalog — but we derived this from trial and error.

**Question:** What's your canonical variant name for:
- The base Bowman Chrome Prospect card (BCP-*)
- The standard Refractor parallel
- The Retrofractor (if you index it)

Do you follow Topps' official parallel naming or a normalized taxonomy?

---

## Priority 3 — Efficiency & partnership

---

### 7. ⚠️ Largely Mooted — Is there a batch card-search endpoint?

> **Update (2026-04-20):** Q3's resolution effectively closed this. With the `set` filter on `/card-search`, we paginate the full set in ~94 calls instead of running 1000+ per-variant searches. The catalog pre-load architecture ([docs/catalog-preload-architecture.md](catalog-preload-architecture.md)) makes this a non-issue for product imports. We'd still benefit from a true batch endpoint for ad-hoc multi-card lookups (slab analysis, card-lookup tool), but it's no longer blocking. Demoting to background.

---

### 8. 🟢 Open — Is there a webhook or event feed for new card additions?

Our pricing cache has a 24h TTL. For newly released products, a webhook when cards from a new set are added would let us invalidate cache and re-run matching automatically rather than waiting for a manual refresh.

---

### 9. 🟢 Open — Are you open to a small test fixture for regression testing?

A known-good dataset — e.g. 50 cards from 2025 Bowman Draft with expected `card_id`s — would let us regression-test query changes without burning live API calls. Happy to share our test queries back if useful.

---

### 10. 🟢 Open — Is there a developer channel (Slack / Discord)?

We'd love visibility into catalog updates, breaking changes, and what other builders are seeing. Even a low-traffic changelog channel would help.

---

## Context We Should Share With Them

Before or during the conversation, it's worth giving CH a quick picture of where we are. Updated post-2026-04-20 reply.

- We're a break pricing and deal analysis platform (BreakIQ) — see [getbreakiq.com](https://getbreakiq.com), private beta. We import manufacturer checklists (Topps PDFs, Bowman XLSX, Panini Master Checklist) and match every variant row to a CH `card_id` so we can pull live EV for slot pricing.
- **Match rate, post-River's Q3 reply + our v2 catalog pre-load (2026-04-21):** ~95%+ across Bowman / Topps Chrome variants. Q1's fuzzy-fallback explanation + Q2's "always include Auto + dash" rule + Q3's set-filter + canonical-name lookup all rolled up cleanly.
- **Current pain points:** consumer surfaces want player-scoped sales feeds (Q12) and per-card cross-grade history (Q13). Both would unlock real product features (richer Recent Sales panel; Grade Ratio Value pricing model — see [docs/competitor-intel/cardladder-vs-breakiq-analysis.md](competitor-intel/cardladder-vs-breakiq-analysis.md) for the algorithmic motivation).
- We're running ~1,000–17,000 variants per product import. Per-CH-card price cache shipped 2026-05-09 ([CHANGELOG](../CHANGELOG.md)) — daily cron is now timeout-safe and incrementally persists.
