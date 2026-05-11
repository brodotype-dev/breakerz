# 2026-05-10 — Topps Series 1 / Series 2 split (and the broader "subset product" question)

**Status:** P0 — Series 1 is shipping wrong data in production right now. Implementation in progress 2026-05-10.
**Linked:** [BACKLOG.md P0 entry](../BACKLOG.md), [docs/cardhedger-questions.md Q14](../cardhedger-questions.md), [docs/catalog-preload-architecture.md](../catalog-preload-architecture.md)

---

## The problem

`2025 Topps Series 1 Baseball` ([slug `topps-series-1-baseball-2025`](https://getbreakiq.com/break/topps-series-1-baseball-2025)) has:

- `ch_set_name = "2025 Topps Baseball"` — CH's umbrella set covering both Series 1 (#1–330) and Series 2 (#331–660). Confirmed via `/v1/cards/set-search`: there is no `"2025 Topps Series 1 Baseball"` canonical name on the CH side.
- **1,249 player_products / 43,213 variants** today. A 330-card Series 1 release should produce ~330 players × ~30 parallels avg ≈ 10K variants. We're 4× over.
- Slot pricing, chase cards, and Recent Sales blend Series 2 (and beyond) data into a Series 1 break analysis.

We need to render Series 1 and Series 2 as separate products *now*. River may eventually answer Q14 with a CH-side fix, but lead time is unknown and the Series 1 product is live with wrong data today.

---

## Two design drafts, and why we landed on the simpler one

### Draft 1 (rejected) — new `products.card_number_filter` schema column

First instinct: add `products.card_number_filter jsonb` with `{numeric_min, numeric_max, include_prefixes, exclude_prefixes}`, plumb it through `loadCatalogIndex()` and the admin form as a primary scoping mechanism. Framed as a new "product subset capability."

**Why we rejected it.** The scoping mechanism already exists. [`player_products.checklist_card_numbers`](../../lib/variants-from-catalog.ts:144) is populated by the import-checklist parser and consumed by `hydrateVariantsFromCatalog` as a strict per-pp allow-list. The 2025-04-21 catalog pre-load architecture comment explicitly calls out: "This is what scopes Topps S1 vs S2 when they share a ch_set_name." Adding `card_number_filter` would duplicate that mechanism with a less-precise replacement.

### Draft 2 (chosen) — derive product scope from existing checklist data

The bug is narrow: only **one fallback path** in `hydrateVariantsFromCatalog` lets cards through without scoping — the path for pps with `checklist_card_numbers = NULL`. Fix that path and the problem disappears.

The product's effective scope is *already known* — it's the union of `checklist_card_numbers` across every scoped pp in the product. Compute it at hydrate time, use it as the fallback predicate for unscoped pps, also use it to pre-filter Phase 3's auto-create discovery loop. **No new schema, no new admin UI, no per-product config.**

---

## What the data actually shows

DB probes on `b27f5ce4-00c2-4f5d-ba85-4e54e9902fb0` (Topps Series 1 Baseball), 2026-05-10:

### Player_product scoping coverage

| Metric | Value |
|---|---|
| Total player_products | 1,249 |
| pps with `checklist_card_numbers` populated | **699** (56%) |
| pps without (NULL) | **550** (44%) |

### Variant distribution (all 43,213)

| Bucket | Count | Notes |
|---|---|---|
| Numeric card_number | 32,228 | Base + parallels |
| Alphanumeric (insert codes) | 10,985 | `T90-57`, `CC-4`, etc. |
| Numeric in S1 range 1–330 | 19,026 | Legitimate Series 1 base |
| Numeric in S2 range 331–660 | **11,615** | Series 2 bleed |
| Numeric > 660 | **1,587** | Update bleed / Topps All-Stars / wild |
| From **scoped** pps | 28,702 | Clean — all match their checklist |
| From **unscoped** pps | **14,511** | **Entire pollution surface** |

### Smoking gun: scoped pps are pristine

Spot check on four high-profile scoped pps:

| Player | checklist size | variants | in_checklist | not_in_checklist |
|---|---|---|---|---|
| Aaron Judge | 19 nums | 231 | 231 | **0** |
| Bobby Witt Jr. | 17 nums | 158 | 158 | **0** |
| Mike Trout | 18 nums | 171 | 171 | **0** |
| Shohei Ohtani | 18 nums | 170 | 170 | **0** |

Distribution of the 500 unscoped pps' variants:

| Range | Count | Verdict |
|---|---|---|
| In S1 range 1–330 | 786 | Possibly legitimate (auto-created insert subjects) |
| In S2 range 331–660 | **10,525** | Verified-wrong bleed |
| Above 660 | **1,587** | Verified-wrong bleed |
| Non-numeric (insert codes) | 1,613 | Ambiguous; resolves correctly under the new predicate |

**Verified leak surface: 12,112 numeric variants on 500 unscoped player_products.**

### Why the unscoped pps exist

[`hydrateVariantsFromCatalog`](../../lib/variants-from-catalog.ts) has a Phase 3 auto-create path (lines 169–229): when a CH catalog row mentions a player who isn't in our parsed checklist, we create a `players` row + `player_products` row with `insert_only=true` so the variant can still attach. These auto-created pps are never added to `attachPredicateByPpId`, so the attach-phase predicate lookup at [line 250](../../lib/variants-from-catalog.ts:250) returns `undefined` — and the `if (predicate && !predicate(...))` guard short-circuits, letting every card through. *Even worse than "permissive `() => true`": auto-created pps have no predicate at all.*

This was a deliberate design for normal (one-set-per-product) cases — Phase 3 picks up insert subjects the manufacturer checklist forgot. But for products that share a `ch_set_name` with a different physical product, the auto-create path leaks the entire sibling set.

---

## Insert overlap between Series 1 and Series 2

Earlier concern: do S1 and S2 use the same insert code (e.g., both have `T90-57` referring to different cards)? Spot check on Judge's actual Series 1 insert codes (`T90-57`, `T90C-82`, `T90R-AJ`, `HA-1`, `MEGA-8`) — these are continuous numeric ranges across both physical products, not restarted per series. So insert overlap is **not a meaningful concern for Topps Baseball Series 1/2** and the same predicate handles inserts correctly.

(Insert overlap may still be a concern for other multi-series lines — Topps Heritage / Update. Defer until we hit it.)

---

## The fix

**Code change scope:** [`lib/variants-from-catalog.ts`](../../lib/variants-from-catalog.ts) only. No new schema. No admin UI.

### Step 1 — Compute the product's scope from existing checklist data

Right after loading `playerProducts`:

```ts
// Derived scope: the union of every checklist_card_numbers entry across this
// product's scoped pps. Acts as the safety net for unscoped pps (auto-created
// insert subjects + legacy null-checklist rows) so they can't pull cards from
// a sibling set sharing the same ch_set_name (Topps Series 1 vs Series 2).
//
// Empty scope = no checklist data has been imported yet for this product;
// fall back to permissive behavior so brand-new products before first parse
// still work as they did before.
const productScope = new Set<string>();
for (const pp of playerProducts) {
  for (const n of pp.checklist_card_numbers ?? []) {
    productScope.add(n);
  }
}
const productScopePredicate: (n: string) => boolean =
  productScope.size > 0 ? n => productScope.has(n) : () => true;
```

### Step 2 — Replace the permissive fallback in the per-pp predicate map

```ts
for (const pp of playerProducts) {
  const nums = pp.checklist_card_numbers;
  if (nums && nums.length > 0) {
    const numSet = new Set(nums);
    attachPredicateByPpId.set(pp.id, n => numSet.has(n));
  } else {
    attachPredicateByPpId.set(pp.id, productScopePredicate);  // was: () => true
  }
}
```

### Step 3 — Pre-filter Phase 3's auto-create discovery loop

```ts
const missingPlayerNames = new Map<string, string>();
for (const c of index.cards) {
  // Don't auto-create players whose only CH appearances are out-of-scope rows.
  if (!productScopePredicate(c.number ?? '')) continue;

  const chName = c.player_name?.trim();
  if (!chName) continue;
  const norm = normalizeName(chName);
  if (!nameToPpId.has(norm) && !missingPlayerNames.has(norm)) {
    missingPlayerNames.set(norm, chName);
  }
}
```

### Step 4 — Wire the predicate onto auto-created pps

After Phase 3 inserts the auto-created pps into `nameToPpId`:

```ts
for (const pp of upsertedPPs ?? []) {
  const pName = (pp as any).player?.name as string | undefined;
  if (!pName) continue;
  nameToPpId.set(normalizeName(pName), pp.id);
  // Auto-created pps inherit productScope as their attach predicate.
  // Belt-and-suspenders: even if Phase 3 discovery had a bug, the attach
  // phase still rejects out-of-scope rows.
  attachPredicateByPpId.set(pp.id, productScopePredicate);
}
```

That's the entire code change.

### Step 5 — Operational re-hydrate

Once the code lands, run "Re-hydrate from Catalog" on the Series 1 product:

1. The existing flow does delete-then-insert per product ([variants-from-catalog.ts:273](../../lib/variants-from-catalog.ts:273)).
2. Scoped pps stay clean (no behavior change for them).
3. Unscoped pps' attach phase now rejects out-of-scope rows.
4. Phase 3 discovery only fires for in-scope CH rows, so we stop creating new orphan pps.
5. Re-run pricing refresh on the Series 1 product (one-time; daily cron picks up after).

Then create the 2025 Topps Series 2 Baseball product, import its checklist, hydrate.

### Step 6 — Expose the new behavior in the result

Extend `HydrateResult` with `productScopeSize: number` and `phase3FilteredByScope: number` so the admin can see proof the new predicate ran. Surface in the admin UI's hydrate output.

---

## What this leaves behind

**500 orphan `insert_only=true` player_products** will have zero variants attached after re-hydrate (their original Series 2 variants get deleted; nothing in-scope replaces them). They stay in the DB.

- They're `insert_only=true` so they don't render on consumer surfaces (slot-eligible filter excludes them).
- They cost negligible storage.
- Cleaning them up risks orphaning historical `user_breaks` snapshots that referenced them or cached `pricing_cache` rows.
- Decision: leave them. If they ever cause confusion in admin views, add a `DELETE FROM player_products WHERE id IN (...)` one-off cleanup as a follow-up.

---

## Verify Topps' actual 2025 numeric boundary before deploy

The 1–330 / 331–660 split is the typical Topps Baseball pattern but they adjust series sizes year-to-year. Since the new predicate is derived from `checklist_card_numbers` (which the parser populates from the official checklist), we don't have to hardcode a boundary — but we DO need to make sure the imported Series 1 checklist actually lists all 330+ base cards plus the legitimate Series 1 inserts. Verify by querying `player_products.checklist_card_numbers` after re-import; the union should contain every Series 1 card number Topps published.

---

## What this means for future products

| Use case | How it's handled |
|---|---|
| 2025 Topps Series 2 Baseball | Import Series 2 checklist → productScope = Series 2 numbers → done |
| 2026 Bowman Chrome + Prospects merge (River's note) | Import each checklist as its own product → productScopes are disjoint → done |
| Topps Update (already a separate CH set) | No change needed — unrelated path |
| Panini hobby/retail/FOTL channel splits | Different problem (variant strings, not card_numbers) — not addressed here, track when it bites |

The capability is *zero-cost* and *automatic* — any future product whose breaker market diverges from CH's canonical naming gets correct behavior as soon as we import its own checklist. No per-product config, no admin training, no schema migrations.

---

## Execution order

1. ✅ Verify the leak source (done — 500 unscoped pps account for the entire pollution surface)
2. ✅ Verify insert overlap is a non-issue for S1/S2 (done — Topps continues numbering across series)
3. **Implement the predicate fix** in `lib/variants-from-catalog.ts` (Steps 1–4 above). ~30 min.
4. **Extend `HydrateResult`** + admin UI hydrate output. ~15 min.
5. Re-import 2025 Topps Series 1 checklist (re-uses existing checklist parser; populates `checklist_card_numbers` for the unscoped pps that should be scoped).
6. Re-hydrate Topps Series 1 from admin UI. Expect variant count to drop from 43,213 → ~28,000 (the scoped surface).
7. Re-run pricing refresh on Series 1 (one-time).
8. Create 2025 Topps Series 2 Baseball product, import its checklist, hydrate it.

Effort: ~1–2 hours including verification.

---

## Decision log (for future me reading this cold)

- **Why not just disable Phase 3 auto-create entirely for subset products?** Phase 3 exists for a reason — it catches insert subjects the manufacturer checklist forgot. Disabling it would lose that value. Constraining it via productScope keeps the value while removing the leak.
- **Why no `products.card_number_filter` schema?** Because we'd be duplicating `checklist_card_numbers`. The existing column is already the source of truth; the fix is to honor it correctly in the fallback path.
- **Why not delete the orphan unscoped pps?** They're `insert_only=true` and harmless. Deletion risks orphaning `user_breaks` history and `pricing_cache` rows. Cheap to leave.
- **Why pre-filter Phase 3 discovery AND set the predicate on auto-created pps?** Belt and suspenders. Pre-filter prevents creating new orphan pps; predicate prevents leaks from any orphans that slip through (e.g., from a future code path that doesn't yet pre-filter).
- **What if productScope is empty?** Then no checklist has been imported yet for this product — preserve today's permissive behavior. The bug only manifests when scoped + unscoped pps coexist; the fallback is irrelevant for empty-scope cases.
