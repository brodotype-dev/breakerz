# CardHedger Entity Matching — First Principles Analysis

## What We're Actually Trying to Do

Connect two independently-built catalogs with no shared key:

- **BreakIQ side:** a checklist row — player name, card number, section name (e.g. "Chrome Refractor"), product year/set
- **CardHedger side:** a card record — card_id, player_name, set_name, number, variant, year

The only way in is CH's free-text search. No bulk export, no "list all cards in set", no direct key lookup. Top 10 results only. This is a retrieval problem, not a join.

---

## The Entity Hierarchy (What CH Actually Models)

```
Product  →  Player  →  Card (card_number)  →  Variant/Parallel  →  card_id
```

Example for 2025 Bowman Chrome:
```
2025 Bowman Chrome Baseball
  └── Jacob Wilson
       └── BCP-153 (card number, same across ALL parallels)
            ├── Base              → card_id: ch_aaa
            ├── Refractor         → card_id: ch_bbb
            ├── Gold /50          → card_id: ch_ccc
            └── Superfractor 1/1  → card_id: ch_ddd
```

**Key insight:** the card number is the same for every parallel of the same player's card. Only the variant/finish changes. This is the axis we're currently failing to exploit.

---

## What the Checklist Gives Us

After import, each `player_product_variants` row contains:
- `playerName` (from `players` join)
- `card_number` — "BCP-153", "CPA-JW", or null
- `variant_name` — **the XLSX section name**, e.g. "Chrome Refractor", "Base", "Gold Refractor Autographs /50"
- `product.year` + `product.name` + `product.sport`

The section name is a close (but not identical) proxy for CH's `variant` field. It needs cleaning — that's what `BowmanKnowledge.cleanVariant()` already does.

---

## The Core Problem With the Current Approach

**We match at the wrong granularity.** Currently: one independent CH search per variant row. For a player with 10 parallel variants, that's 10 separate searches — each constructing its own query from scratch, with no shared context.

**What this causes:**
1. If a query construction is slightly off for one variant, it affects only that variant — but there's no consistent "source of truth" for who the player even is in CH's catalog
2. All 10 searches might return the same top-10 CH results, but Claude picks the same card 10 times (wasted API cost and latency)
3. No fallback hierarchy — if a Gold /50 parallel doesn't exist in CH, that row gets no card_id instead of falling back to the base card

---

## The Better Mental Model: Two Phases

### Phase 1: Entity Resolution (per player, not per variant)
**Goal:** Find CH's canonical card_id for this player's card in this set — the "anchor."

Query: `playerName year shortSetName [cardNumber if alphanumeric code]`  
No variant in the query. We just want: "give me Jacob Wilson's 2025 Bowman Chrome card."

This search happens **once per player**, not once per variant. Produces an anchor card_id with high confidence.

### Phase 2: Variant Assignment (per variant)
**Goal:** Map each checklist section row to the right CH card_id.

Start with the anchor as fallback. For each variant:
- **Base** → use anchor directly
- **Known parallels** (Refractor, Gold, etc.) → search `anchorQuery + cleanedVariant`, accept if confident, fall back to anchor
- **Autographs** → separate search with auto-specific query (card code only for Bowman)
- **Insert sets / short prints** → already handled by cleanVariant() stripping section names

**Result:** Every variant has a card_id. Most point to the base or a known parallel. No variant is orphaned just because CH doesn't have that specific print run cataloged.

---

## The Card Number Problem (Current Ceiling)

The current structural limits (76% ceiling on Bowman's Best) break down as:

| Failure type | Root cause | % of failures |
|---|---|---|
| Code-only rows (BMA-MT) | `playerName` field contains the card code, not a name — CH doesn't expose `number` for autograph sets so Tier 1 fails, Tier 2 has no name to compare | ~20% |
| Multi-player autos (DA-/TA-/QA-) | Slash-delimited names; CH can't match these | ~3–4% |
| True no-match | Card genuinely not in CH catalog | ~0–1% |

**For code-only rows:** The card code IS the strongest identifier we have. The right approach is:
1. Search CH by code alone: `year setName BMA-MT`
2. If CH returns a candidate with a `number` field matching "MT" suffix — accept it
3. If CH still doesn't expose `number` for autos — this is a CH API gap, not fixable on our side

**For multi-player:** Already handled (reformulated to code-only query). Still fails because CH doesn't index these well. Match Review UI is the real answer here.

---

## The Variant Matching Sequence (Revised)

```
For each product:
  For each player in product:
    [Phase 1] entity_search(playerName, year, setName, cardNumber_if_alpha_code)
      → anchor_card_id (or null if no match)
    
    For each variant of that player:
      if variant_name is insert set name → skip (no meaningful CH card)
      elif variant_name is "Base" or equivalent → use anchor_card_id
      elif anchor_card_id exists:
        variant_search(anchor_query + cleanedVariant)
          → if confidence >= 0.7 → use variant card_id
          → else → fall back to anchor_card_id
      else:
        current behavior (independent search per variant)
```

**What this buys us:**
- Fewer total CH API calls (1 anchor search + targeted variant searches vs. N independent searches)
- No orphaned variants — anchor fallback means every variant gets a usable card_id even if CH doesn't have that specific parallel
- Easier to audit — if an anchor is wrong, all variants for that player are wrong → easier to spot in Match Review UI

---

## What We're NOT Changing

- `BowmanKnowledge.cleanVariant()` — already correct, keep it
- `BowmanKnowledge.reformulateQuery()` for code-only player names — keep it
- The Claude Haiku semantic tier — it's good, just needs the right candidates
- The confidence thresholds (0.7 auto, 0.5 review) — appropriate
- The insert set name stripping — already works

---

## What CH Would Need to Unblock the Rest

The remaining ~24% structural failures require CH to:
1. Return the `number` field for autograph set cards (fixes code-only rows)
2. Index CPA-* Chrome Prospect Autograph codes (fixes Bowman Chrome autos)
3. Possibly: a "cards by set" endpoint to enable pre-loading the full catalog for a product before matching

This is Kyle's conversation with the CH team. These are the three asks worth making.

---

## The Pricing Implication

For the pricing engine, the per-variant card_id matters most for odds-weighted EV:
```
hobbyEVPerBox = Σ(variantEV × 1/hobby_odds)
```

If a Gold /50 variant has its own card_id pointing to the Gold /50's actual market price (much higher than base), the slot cost is more accurate. If it falls back to the base card_id, we're underpricing.

**Practical reality:** CH has sparse data for most parallels below Gold. For Base, Refractor, and Gold — worth a specific card_id. For everything else — base card_id fallback is fine and probably more accurate than using a CH card with 1 recent sale.

---

## Files Relevant to Any Implementation

- `lib/cardhedger.ts` — `cardMatch()`, `searchAndComputeEV()`, `computeLiveEV()`
- `lib/card-knowledge/index.ts` — `getManufacturerKnowledge()`
- `lib/card-knowledge/bowman.ts` — `BowmanKnowledge` (cleanVariant, reformulateQuery, claudeContext)
- `app/api/admin/match-cardhedger/route.ts` — the matching pipeline (chunked, 8 concurrent)
- `docs/cardhedger-matching.md` — full architecture doc
