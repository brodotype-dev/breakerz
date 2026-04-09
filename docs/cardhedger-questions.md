# CardHedger — Questions & Scenarios for the Team

Refined list for a focused conversation with the CH team. Organized by priority and grouped by theme. Each section includes the business impact so we can triage together.

*Last updated: 2026-04-06*

---

## Priority 1 — Blocking matching accuracy

These are the specific gaps causing our current ~24% failure rate. Fixing any one of them meaningfully moves the needle.

---

### 1. Does `card-search` return a `number` field for autograph sets?

For base/prospect cards (BCP-*, BD-*), `number` comes back populated and our matching is highly accurate. For autograph sets (BMA-*, CPA-*, BPA-*, FDA-*), we consistently get `number: ""` or null from candidates.

**Why it matters:** Without a number to compare, we can't do code-based disambiguation. A query for `BMA-MT` returns candidates but we have no way to confirm which one is "MT" — we're left comparing player names against a code, which fails for players where the name isn't derivable from the initials.

**Question:** Is the `number` field intentionally omitted for autograph sets, or is this a data gap? If it's a data gap, is it on the roadmap to fix?

**Scenario:**
> Query: `"2025 Bowman's Best BMA-MT"`  
> We get back 3–5 candidates, all with `number: null`.  
> We have no way to confirm which candidate is the "MT" player.  
> With `number` populated, we'd match by code suffix and hit ~95%+ confidence instantly.

---

### 2. Are CPA-* Chrome Prospect Autographs indexed in card-search?

For 2025 Bowman Chrome Baseball, queries for CPA-* autographs (e.g. `"CPA-DL 2025 Bowman Chrome"`) return the player's BCP-* base card instead of an autograph result. It's unclear whether CPA cards exist in the catalog under a different code, a different format, or not at all.

**Question:** Are CPA-* autographs in your catalog? If yes, what's the right query pattern to surface them? If no, is there a timeline for coverage?

**Scenario:**
> Query: `"Dylan Listi CPA-DL 2025 Bowman Chrome Baseball"`  
> Expected: a Bowman Chrome autograph card for Dylan Listi  
> Actual: returns BCP-123 base card or nothing  
> Workaround we'd want: either CPA codes indexed separately, or a way to filter by category (auto vs. base)

---

### 3. Is there an endpoint to retrieve all cards in a given set?

Our current approach: search for each card individually using player name + year + set + card number. This is 1000+ API calls per product import, each returning at most 10 candidates.

A "cards by set" endpoint — even something as simple as `?set_name=2025 Bowman Chrome&limit=500` — would let us:
- Pre-load the full CH catalog for a product before matching
- Do our matching client-side (exact `number` + `player_name` comparison), dramatically improving accuracy
- Validate our checklist imports against your data directly

**Question:** Is anything like this available or planned? Even a paginated search filtered by `set_name` would transform our pipeline.

---

## Priority 2 — Structural understanding

These don't block us today but the answers will inform how we architect Phase 2 of our matching (variant-level card_id assignment).

---

### 4. For a given card number, how many card_ids exist — one per parallel?

Example: Jacob Wilson BCP-153 in 2025 Bowman Chrome. The Topps checklist has 100+ parallels (Base, Refractor, Gold /50, Superfractor 1/1, etc.).

**Question:** Does CH have a separate `card_id` for each parallel, or does one `card_id` represent the card across all finishes? And if separate: which parallels do you index? (All of them, or just the ones with enough sales data?)

**Why it matters:** If each parallel has its own `card_id`, we want to search for parallel-specific cards for high-value finishes (Gold /50 and up). For low-value parallels with sparse data, falling back to the base card_id is fine. Knowing your coverage model helps us decide which variants are worth a dedicated search vs. which should just inherit the base card_id.

**Scenario:**
> We have BCP-153 base (card_id: ch_aaa) confirmed via matching.  
> We also have a "Gold Refractor /50" variant row for the same player.  
> Query: `"Jacob Wilson 2025 Bowman Chrome Gold Refractor"`  
> Does this return a distinct card_id for the Gold, or the same as Base?

---

### 5. How do you handle multi-player autograph cards?

We have dual (DA-), triple (TA-), and quad auto (QA-) cards where the XLSX stores the player field as slash-delimited names (e.g. `"Dylan Crews/James Wood"`). Searching by combined name doesn't work. Searching by code alone is inconsistent.

**Question:** Is there a recommended pattern for these? A lookup by card code (`DA-WC`) would be ideal if you index by `number` for multi-player sets.

**Scenario:**
> Card: `DA-WC` — Dylan Crews / James Wood, 2025 Bowman's Best  
> Query by combined name: no reliable results  
> Query by code: `"DA-WC 2025 Bowman's Best"` — returns candidates but `number` is null, can't confirm  
> Ideal: direct lookup by `number: "DA-WC"` within the set

---

### 6. What does the `variant` field contain for base Bowman Chrome Prospect cards?

We've seen `"Base"`, `"Refractor"`, and sometimes empty for cards that Topps calls the base BCP card. Our Claude matching context teaches it that `Retrofractor` (Bowman's term) maps to `Base` or `Lazer Refractor` in your catalog — but we derived this from trial and error.

**Question:** What's your canonical variant name for:
- The base Bowman Chrome Prospect card (BCP-*)
- The standard Refractor parallel
- The Retrofractor (if you index it)

Do you follow Topps' official parallel naming or a normalized taxonomy?

---

## Priority 3 — Efficiency & partnership

---

### 7. Is there a batch card-search endpoint?

We call `/v1/cards/card-search` once per variant. For a 1000-variant product, that's 1000 sequential API calls per matching run. A batch endpoint (array of queries → array of result sets) would reduce matching time from ~15 minutes to ~2 minutes.

---

### 8. Is there a webhook or event feed for new card additions?

Our pricing cache has a 24h TTL. For newly released products, a webhook when cards from a new set are added would let us invalidate cache and re-run matching automatically rather than waiting for a manual refresh.

---

### 9. Are you open to a small test fixture for regression testing?

A known-good dataset — e.g. 50 cards from 2025 Bowman Draft with expected `card_id`s — would let us regression-test query changes without burning live API calls. Happy to share our test queries back if useful.

---

### 10. Is there a developer channel (Slack / Discord)?

We'd love visibility into catalog updates, breaking changes, and what other builders are seeing. Even a low-traffic changelog channel would help.

---

## Context We Should Share With Them

Before or during the conversation, it's worth giving CH a quick picture of what we're doing so the questions land with context:

- We're building a break pricing and deal analysis platform (BreakIQ). We import manufacturer checklists (Topps PDFs, Bowman XLSX, Panini CSV) and match every variant row to a CH `card_id` so we can pull live EV for slot pricing.
- Our current match rate: ~95% on Bowman Draft, ~76% on Bowman's Best. The remaining 24% on Best is almost entirely autograph sets where `number` is null.
- We're running ~1,000–17,000 variants per product import, using a Claude Haiku semantic matching layer on top of your search results.
- Our goal is to get to 95%+ across all product types. The three asks in Priority 1 would likely get us there.
