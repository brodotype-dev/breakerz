# CardHedger Matching Improvements

**Date:** 2026-03-30
**Status:** Partially implemented — Phase 1 deployed, Phase 2 pending

---

## Context

After bulk-importing 10 products (~7,500+ players), CardHedger auto-match rates were 3–29% across all products, despite the user confirming cards are findable in the CardHedger debugger. The matching is not fundamentally broken — cards exist in CardHedger — but query construction was wrong. This doc tracks the investigation findings and improvement roadmap.

---

## Architecture Decision: CardHedger Cannot Replace XLSX Imports

**Question asked:** Can CardHedger serve as a product catalog to skip XLSX imports entirely?

**Answer: No.** CardHedger is a pricing/search API, not a catalog. It has no endpoint to pull "all cards for a given set."

| Capability | XLSX Import | CardHedger |
|---|---|---|
| Full player roster | ✅ | ❌ Search-only |
| All variants + card numbers | ✅ | ❌ |
| Pull odds | ✅ (from Topps PDFs) | ❌ |
| Card identity (`card_id`) | ❌ | ✅ |
| Real-time pricing | ❌ | ✅ |
| Market comps | ❌ | ✅ |

**Correct architecture:** XLSX → checklist import → CardHedger matching (enrichment) → pricing.

---

## Known CardHedger API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/cards/card-search` | Free-text search; only discovery endpoint |
| `POST /v1/cards/all-prices-by-card` | Grade-level price estimates |
| `POST /v1/cards/prices-by-cert` | Graded slab sale history by cert # |
| `POST /v1/cards/prices-by-card` | Price history by day |
| `POST /v1/cards/90day-prices-by-grade` | 90-day aggregate stats (no card_id needed) |
| `POST /v1/cards/comps` | Recent comparable sales |
| `POST /v1/cards/batch-price-estimate` | Batch pricing ≤100 items |
| `GET /v1/download/daily-price-export/{file_date}` | Bulk daily CSV (planned, not yet needed) |
| `GET /v1/cards/top-movers` | Price-gain leaders (blocked — awaiting Kyle) |
| `POST /v1/cards/price-updates` | Delta polling since timestamp (blocked — same) |

---

## Root Causes of Poor Match Rates

### 1. Verbose product name in query (fixed ✅)
**Old:** `"Jacob Wilson 2025 Bowman Chrome Baseball 1"`
**New:** `"Jacob Wilson Bowman Chrome 1"`

The year and sport suffix confused CardHedger's search. Short set name `"Bowman Chrome"` matches how the CH catalog indexes sets.

**File:** `app/api/admin/match-cardhedger/route.ts`
```typescript
const shortSetName = (product?.name ?? '')
  .replace(/^\d{4}(?:-\d{2})?\s+/, '')
  .replace(/\s+(baseball|basketball|football|soccer)\s*$/i, '')
  .trim();
```

### 2. Variant name missing from query (fixed ✅)
Base/parallel type helps Claude disambiguate. Query now includes `variant.variant_name`:

**New:** `"Jacob Wilson Bowman Chrome 1 Refractor Auto /99"`

### 3. Product dashboard .in() URL limit (fixed ✅)
With 900+ players, `.in('player_product_id', ppIds)` silently failed — CH MATCHED showed 0/0 even after successful runs. Fixed with join-based queries in:
- `app/api/admin/match-cardhedger/route.ts`
- `app/api/admin/apply-odds/route.ts`
- `app/admin/products/[id]/page.tsx`

---

## Remaining Improvements (Not Yet Built)

### Phase 2 — Query Tuning

**1. Pass sport param to `searchCards()`**
We have the sport on the product but never send it. This narrows CardHedger results and reduces false matches from other sports.

```typescript
// In lib/cardhedger.ts — cardMatch() already accepts sport, but it's not passed
// In match-cardhedger/route.ts — fetch product sport and pass it:
const { data: product } = await supabaseAdmin
  .from('products')
  .select('name, sport:sports(name)')
  .eq('id', productId)
  .single();

const sport = (product?.sport as any)?.name?.toLowerCase(); // 'baseball' | 'basketball' | 'football'
// Pass to cardMatch() → searchCards(query, sport)
```

**Files:** `app/api/admin/match-cardhedger/route.ts`, `lib/cardhedger.ts`

**2. Expand Claude candidate list from 5 → 10**
More candidates = better chance the right card appears. Claude evaluates all of them.

```typescript
// lib/cardhedger.ts — cardMatch()
const cards = (result.cards ?? []).slice(0, 10); // was 5
```

**3. Fallback retry with player + card number only**
If the full query returns 0 results, retry with just `playerName + cardNumber`. Simpler queries often succeed when set name indexing doesn't match.

```typescript
// lib/cardhedger.ts — cardMatch()
let result = await searchCards(query, sport);
if (!result.cards?.length) {
  // Fallback: player name + card number only
  const fallbackQuery = [playerName, cardNumber].filter(Boolean).join(' ');
  result = await searchCards(fallbackQuery, sport);
}
```

**4. "Re-match all" bulk action on admin products page**
Currently admins must visit each product dashboard and click "Re-run Matching" individually. A bulk action on `/admin/products` would clear `cardhedger_card_id` for all unmatched variants across all products and trigger re-matching in parallel.

---

## Odds Fuzzy Matching Improvements (also deployed ✅)

The PDF subset name → DB variant name matching was using exact substring containment. Replaced with token-overlap scoring with prefix matching:
- `"auto"` matches `"autographs"`, `"refractor"` matches `"refractors"`
- Scores each PDF row against all unique variant names, picks best match ≥ 50% threshold

**File:** `app/api/admin/apply-odds/route.ts`

---

## Verification

After deploying Phase 2 matching improvements, re-run matching on 2025 Bowman Draft Baseball (lowest match rate, 28%). Expected improvement from ~28% → 60%+ auto-match given cards are confirmed present in CardHedger.

Monitor via product dashboard: CH MATCHED tile should show `variantMatched / variantTotal`.
