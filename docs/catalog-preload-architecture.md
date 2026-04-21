# Catalog Pre-load Architecture — CH Matching v2

**Status:** In progress (started 2026-04-21)
**Supersedes:** the ad-hoc `mode: 'set-catalog'` path in `app/api/admin/match-cardhedger/route.ts`
**Driving context:** [River @ CardHedger email, 2026-04-21](./cardhedger-matching.md#reference--river-email-2026-04-21) — confirmed that `/v1/cards/set-search` and `/v1/cards/card-search?set=...` with pagination both exist, and that our 76% match ceiling was misdiagnosed as structural. It wasn't. It was fuzzy-fallback noise on per-variant searches.

---

## The mental shift

**v1 (current):** fuzzy search CH once per variant row, hope the right card is in the top 10, ask Claude to pick it.

**v2 (this doc):** fetch the entire CH set catalog once, cache it in Postgres, match our checklist rows **locally** against it. Claude only runs on variants we genuinely can't resolve with local logic.

| | v1 | v2 |
|---|---|---|
| CH API calls per 1,000-variant product | ~1,000 fuzzy searches | ~94 paginated set pulls (once; then cache) |
| Claude Haiku calls | ~1,000 | ~0–50 (ambiguous fallbacks only) |
| False matches from fuzzy fallback | frequent | impossible (we only match within the known set) |
| `number: null` contamination | common | cannot happen (set results have populated numbers) |
| New manufacturer onboarding | write a TypeScript class | add a descriptor (JSON/TS) |

---

## Data model

### `ch_set_cache` (new)

One row per (ch_set_name, card_id). Stores the flattened CH card data we care about for matching.

```sql
CREATE TABLE ch_set_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ch_set_name  text NOT NULL,               -- canonical CH set name (e.g. "2025 Bowman Chrome Prospects Baseball")
  card_id      text NOT NULL,               -- CH card_id
  number       text,                        -- "BCP-153", "CPA-JH", "87"
  player_name  text,
  variant      text,                        -- "Base", "Refractor", "Gold Refractor", ...
  year         text,
  category     text,                        -- "Baseball" | "Basketball" | ...
  rookie       boolean,
  raw          jsonb,                        -- full CH row for future-proofing
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ch_set_cache_card_id_uniq
  ON ch_set_cache (ch_set_name, card_id);
CREATE INDEX ch_set_cache_lookup_idx
  ON ch_set_cache (ch_set_name, number);
CREATE INDEX ch_set_cache_lookup_variant_idx
  ON ch_set_cache (ch_set_name, number, lower(variant));
```

### `ch_set_refresh_log` (new)

Observability on catalog pulls — how long they took, how many cards, whether they succeeded. Needed for the cron.

```sql
CREATE TABLE ch_set_refresh_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ch_set_name    text NOT NULL,
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  pages_fetched  integer,
  cards_fetched  integer,
  success        boolean,
  error          text
);
```

### No changes to `products`, `player_product_variants`, etc.

`products.ch_set_name` already exists (added 2026-04-20). `player_product_variants.cardhedger_card_id` and `match_confidence` continue to serve as match output.

---

## Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ Product created / edited                                         │
│   ↓                                                              │
│ Admin picks canonical CH set name                                │
│   - Uses existing "Find on CH" widget (calls /set-search)        │
│   - Writes products.ch_set_name                                  │
│   ↓                                                              │
│ Admin clicks "Refresh CH Catalog"                                │
│   - POST /api/admin/refresh-ch-catalog { productId }             │
│   - Loader fetches full set via paginated /card-search           │
│   - Upserts into ch_set_cache                                    │
│   - Writes ch_set_refresh_log row                                │
│   ↓                                                              │
│ Admin clicks "Match CH" (existing button)                        │
│   - For each unmatched variant:                                  │
│     Tier 1: exact (number, variant) in ch_set_cache → conf 0.98 │
│     Tier 2: (number, synonym(variant)) in cache → conf 0.92     │
│     Tier 3: number-only (pick Base) → conf 0.85                 │
│     Tier 4: card-code-as-player → number-only lookup → conf 0.83│
│     Tier 5: Claude Haiku with in-set candidates → conf from LLM │
│     Tier 6: no-match, log diagnostic                            │
│   ↓                                                              │
│ Pricing cache refresh (unchanged downstream)                     │
└─────────────────────────────────────────────────────────────────┘

Parallel: nightly cron hits /api/cron/refresh-ch-catalogs
  - Refresh ch_set_cache for every ACTIVE product with a ch_set_name
  - Respects rate limit (serial per set, 2s between sets)
  - Logs to ch_set_refresh_log
```

---

## `lib/cardhedger-catalog.ts`

Single module owning the catalog lifecycle.

```ts
// Resolve canonical set name via /set-search. Returns candidates for admin UI picker.
export async function findCanonicalSet(query: string, category?: string): Promise<CanonicalSetCandidate[]>

// Paginate through a full set; upsert into ch_set_cache.
// Concurrent page fetches (10 at a time) bounded by CH rate limits.
export async function refreshSetCatalog(
  setName: string,
  opts?: { productId?: string; maxPages?: number }
): Promise<{ cardsFetched: number; pagesFetched: number; durationMs: number }>

// Local lookup — the hot path during matching.
export async function lookupCatalog(setName: string): Promise<CatalogIndex>

// CatalogIndex is a precomputed structure with O(1) number lookup
// and (number, variant) lookup:
interface CatalogIndex {
  byNumber: Map<string, CatalogCard[]>;           // one number can have many variants
  byNumberVariant: Map<string, CatalogCard>;      // key: `${number}::${lowerVariant}`
  all: CatalogCard[];
}
```

---

## `lib/card-knowledge/` → descriptors

Today: one TypeScript class per manufacturer with `cleanVariant()`, `reformulateQuery()`, `claudeContext()` methods.

Tomorrow: a small data structure per manufacturer + a generic matcher that applies it.

```ts
// lib/card-knowledge/descriptors.ts
export interface ManufacturerDescriptor {
  id: string;                                  // 'bowman', 'panini', 'default'
  name: string;
  matches: RegExp;                              // product-name match

  // Variant normalization
  stripPatterns: RegExp[];                      // removed before comparison
  insertSetNames: RegExp[];                     // whole-variant match = skip
  variantSynonyms: Record<string, string[]>;    // canonical → CH-equivalents

  // Card-code-as-player detection
  cardCodePattern?: RegExp;
  autoPrefixes?: RegExp;                        // append "Autograph" when searching CH

  // Multi-player detection
  multiPlayerIndicator?: RegExp;

  // Claude fallback context (only used when Tiers 1–4 miss)
  claudeRules?: string;
}
```

**Why data, not classes:**
- A new manufacturer = one object literal, not a new file + registry edit.
- Can be moved to DB later (v3) with zero API surface change.
- Easier to diff, review, and A/B test rule changes.
- Pure data is trivially testable.

The generic matcher lives in `lib/card-knowledge/match.ts` and consumes the descriptor + `CatalogIndex`. `getManufacturerDescriptor(productName)` replaces `getManufacturerKnowledge(productName)`.

---

## Telemetry

`player_product_variants.match_tier text` (new column) records which tier produced the match:
`exact-variant | synonym | number-only | card-code | claude | no-match`

This lets us measure lift empirically and spot regressions without re-reading logs. Surfaced in the existing admin matching UI.

---

## Cron

`app/api/cron/refresh-ch-catalogs/route.ts` runs daily. Iterates `products WHERE is_active AND ch_set_name IS NOT NULL`, refreshes each. Serialized per-set to respect CH rate limits. Logs to `ch_set_refresh_log`.

`vercel.json` entry:
```json
{ "path": "/api/cron/refresh-ch-catalogs", "schedule": "0 6 * * *" }
```

(6 AM UTC — 2 hours after pricing cache cron, to keep loads separate.)

---

## What we keep from v1

- `cardMatch()`, `claudeCardMatch()`, `tokenCardMatch()` — still used for Tier 5 Claude fallback. The Claude prompt now receives **in-set catalog candidates** instead of fuzzy search results, which should make it dramatically more accurate.
- The chunked polling UI in the admin page — unchanged. Still processes variants in batches of 40.
- The hard year filter — still applies in the Claude fallback.
- The two-tier code-in-query detection — still a useful fast path when catalog lookup misses.

## What we drop from v1

- `BowmanKnowledge` / `DefaultKnowledge` classes → descriptor data.
- Per-variant fuzzy CH searches as the primary matching strategy → only a Tier 5 fallback.
- The in-memory `mode: 'set-catalog'` pre-load in the matching route → moved to persistent `ch_set_cache`.
- `knowledge.reformulateQuery()` for card codes → now just a lookup in `CatalogIndex.byNumber`.

---

## Rollout

1. Migration: `ch_set_cache` + `ch_set_refresh_log` + `player_product_variants.match_tier`.
2. Build `lib/cardhedger-catalog.ts`; unit-test `refreshSetCatalog` against a real small set (e.g. Bowman's Best).
3. Refactor `lib/card-knowledge/` to descriptors (Bowman descriptor = seeded from current `BowmanKnowledge`; Panini + Default descriptors live alongside it).
4. Build the tiered local matcher in `lib/card-knowledge/match.ts`.
5. Rewire `app/api/admin/match-cardhedger/route.ts` to: load `CatalogIndex` for the product's `ch_set_name`, run the tiered matcher per variant, record `match_tier`.
6. Admin UI: "Refresh CH Catalog" button + status badge on product page.
7. Cron route + `vercel.json` entry.
8. Measure on a re-run of an already-matched product (Bowman's Best is the obvious target). Lift over 76% = validation.
9. Run against Panini product to unblock Panini onboarding — the forcing function for the descriptor format.

---

## Open questions

- **Pagination concurrency ceiling.** We use 10 concurrent page fetches in the existing `mode: 'set-catalog'` path. CH has never pushed back, but we should confirm with River before turning the cron loose on all active products.
- **Stale cache policy.** Is 24h good enough, or do we need per-product opt-out (e.g. an archived product doesn't need nightly refresh)? Defaulting to `is_active = true` filters most of that naturally.
- **Set name drift (2026 Bowman Chrome Prospects merge).** When CH moves CPA-* cards under the parent Bowman Chrome set, any products pointing to "2026 Bowman Chrome Prospects Baseball" may return fewer cards. The descriptor's 2026 matching logic handles this at match time, but the catalog pull will need the admin to update `ch_set_name`. Worth a one-time sweep when CH announces the switch.
- **Catalog row deletion policy.** When CH removes a card (rare but possible), our `upsert` won't delete stale rows. On refresh, we should mark rows not present in the latest pull as `stale = true` or delete them. Decision: delete + re-insert per set on refresh (simpler than diffing).
