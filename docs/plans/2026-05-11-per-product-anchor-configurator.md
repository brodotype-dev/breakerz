# Per-product anchor configurator (Plan A of the 2026-05-11 pricing trilogy)

**Status (2026-05-11):** Shipped — migration, dispatcher, refactored pricing-refresh, configurator UI + API. Plan B (market markup display) and Plan C (release/freshness decay) are tracked in sibling plan docs but not yet implemented.

Sibling plans (read-only context):
- [docs/plans/2026-05-11-slot-price-market-markup.md](2026-05-11-slot-price-market-markup.md)
- [docs/plans/2026-05-11-release-freshness-decay.md](2026-05-11-release-freshness-decay.md)

---

## Context

Pre-2026-05-11, `lib/pricing-refresh.ts:495–502` computed per-player EV as a sets-weighted average across **every** priced variant for a `player_product`. Correct in theory (rare/expensive × low odds = same EV contribution as cheap/common × high odds), but breaks down in practice:

- **CH confidence on the long tail is thin.** SuperFractors, 1/1s, low-pop colored parallels have ~0–2 sales. CH returns deflated or null prices. Sets-weighted average then under-weights the parts of the slot that actually drive break demand.
- **Bowman parallels split EV across 30+ rows.** A base Bowman draft sapphire row for Eli Willits has Base, Refractor, Aqua, Blue, Purple, Red, Orange, Gold, SuperFractor — every variant gets counted. Kyle's claim from the 2026-05-11 call: breakers don't price slots off "the average of every parallel" — they price off the anchor chases (base auto and gold/50 auto for Bowman) and treat everything rarer as upside.

Goal: a per-product **anchor strategy** that lets Bowman-style products price off a curated variant set, while Chrome / Topps Series / Panini Prizm (where the current sets-weighted average works) stay on the default.

Config layer, not a rewrite. Today's strategy becomes the default.

## Approach

### Storage layer

Migration `supabase/migrations/20260511180000_product_anchor_strategy.sql` adds three columns on `products`:

- `anchor_strategy text NOT NULL DEFAULT 'sets_weighted_all'` — check constraint pins it to one of three values.
- `anchor_variant_patterns text[] NOT NULL DEFAULT '{}'` — case-insensitive regex strings tested against `player_product_variants.variant_name`.
- `anchor_config_notes text` — conversation history / rationale from the configurator.

### Aggregation layer

[lib/pricing-anchors.ts](../../lib/pricing-anchors.ts) exports `aggregatePlayerEV(variantEVs, strategy, patterns) → AggregatedEV`. Three implementations:

- `sets_weighted_all`: byte-for-byte the pre-2026-05-11 sets-weighted average.
- `curated_variants`: filter `variantEVs` to rows where `variant_name` matches any of `patterns`. Sets-weighted average over the filtered subset.
- `curated_with_tail`: curated subset + a fixed `CURATED_TAIL_BONUS = 0.15` (15% of the curated EV) representing the long-tail option value the curated subset ignored.

**Fallback rule:** if a curated strategy yields zero matched variants, fall back to `sets_weighted_all` and set `fellBack: true` on the result. Caller logs to telemetry. Never zero out a slot on a misconfiguration.

[lib/pricing-refresh.ts](../../lib/pricing-refresh.ts) loads the product's `anchor_strategy` + `anchor_variant_patterns` once at the top of `refreshProductPricing`, then dispatches per `player_product`. The variant query now selects `variant_name` so the dispatcher can pattern-match.

`RefreshSummary` gains three telemetry fields: `anchorStrategy`, `anchorFellBackCount`, `anchorMatchedVariantsAvg`. The terminal log line shows them.

### Configuration UX — conversational anchor configurator

Static regex textareas were rejected — every product has slightly different anchor logic, Kyle shouldn't have to think in regex, and we want this to scale to dozens of products. Instead:

1. [lib/card-knowledge/types.ts](../../lib/card-knowledge/types.ts) extends `ManufacturerDescriptor` with `anchorConcepts?: AnchorConcept[]` — a structured list of named anchor concepts (e.g. for Bowman: `{ name: 'base auto', example: 'BCP-91 Eli Willits Autograph' }`, `{ name: 'gold refractor auto /50', example: '...' }`, etc.). These are the **skill** — the conceptual vocabulary Claude can reason about per manufacturer family.

2. [lib/card-knowledge/bowman.ts](../../lib/card-knowledge/bowman.ts) and [panini.ts](../../lib/card-knowledge/panini.ts) populate `anchorConcepts`. Other descriptors will be filled in as we configure their products.

3. [app/admin/products/[id]/anchor-config/page.tsx](../../app/admin/products/[id]/anchor-config/page.tsx) renders the configurator chat UI. The system prompt assembled in [app/api/admin/anchor-config/route.ts](../../app/api/admin/anchor-config/route.ts) bundles: manufacturer descriptor (id, name, anchorConcepts), product (name, year, lifecycle), a sample of 20 distinct variant names from the product, and current `(strategy, patterns, notes)`. Admin types plain English ("anchor on base autos and gold /50 autos"), Claude returns `{ strategy, patterns, notes, rationale }`, the page renders a live preview using cached variant prices (no CH calls).

4. The preview panel calls `aggregatePlayerEV` against `ch_price_cache` data for the top 5 players in the product. Shows current EV vs. proposed EV with delta + percentage. Lets the admin A/B test before saving.

5. Save = publish. The product row gets `(strategy, patterns, notes)` updated. Next pricing refresh (within 24h or via the existing "Refresh Pricing" button on the product page) applies the new strategy.

### Why this shape

Kyle's instinct from the call ("each product has its own set of rules… can we make rules per product?") is correct, and a Claude-driven configurator scales that to dozens of products without burning hours per product. The descriptor's `anchorConcepts` field is the standardization layer (one vocabulary per manufacturer family); the resulting regex patterns are unique per product. Pairs with the existing `claudeRules` field (used for CH catalog matching) — same pattern: descriptor declares the family's logic; Claude applies it per-instance.

## Critical files

- [supabase/migrations/20260511180000_product_anchor_strategy.sql](../../supabase/migrations/20260511180000_product_anchor_strategy.sql) — new columns + check constraint + comments.
- [lib/pricing-anchors.ts](../../lib/pricing-anchors.ts) — `aggregatePlayerEV` dispatcher + `CURATED_TAIL_BONUS`.
- [lib/pricing-refresh.ts](../../lib/pricing-refresh.ts) — loads product anchor config, calls dispatcher, exposes telemetry.
- [lib/card-knowledge/types.ts](../../lib/card-knowledge/types.ts) — `AnchorConcept` type, `anchorConcepts` field on `ManufacturerDescriptor`.
- [lib/card-knowledge/bowman.ts](../../lib/card-knowledge/bowman.ts) — Bowman/Topps anchor concepts.
- [lib/card-knowledge/panini.ts](../../lib/card-knowledge/panini.ts) — Panini anchor concepts.
- [app/api/admin/anchor-config/route.ts](../../app/api/admin/anchor-config/route.ts) — Claude proposal + preview + save.
- [app/admin/products/[id]/anchor-config/page.tsx](../../app/admin/products/[id]/anchor-config/page.tsx) + [AnchorConfigClient.tsx](../../app/admin/products/[id]/anchor-config/AnchorConfigClient.tsx) — configurator UI.
- [app/admin/products/[id]/page.tsx](../../app/admin/products/[id]/page.tsx) — CTA card displaying current strategy + notes.

## Defaults

Everything ships with `anchor_strategy = 'sets_weighted_all'` and empty patterns — zero behavior change for existing products. Kyle configures sapphire / cosmic / specialty products one-by-one via the configurator, in priority order. No risky big-bang switch.

## Verification

1. Pick `2025 Bowman Chrome` (good CH catalog, current model works). Open the configurator. Describe Bowman price drivers in plain English. Save the resulting patterns. Admin preview should show slot prices within ±15% of current — sanity that the new strategy isn't wildly different on a healthy product.
2. Pick a sapphire product once CH has the catalog (separate workstream — CH catalog gap is P0.1 in [docs/plans/2026-05-06-cardhedger-data-audit.md](2026-05-06-cardhedger-data-audit.md)). Run the configurator. Compare `sets_weighted_all` vs the configurator's proposed strategy on the Eli Willits / JoJo Parker slots — they should rise to match Kyle's gut numbers ($350–400 JoJo base auto, ~$1,700 Royals team slot).
3. Run pricing refresh end-to-end; confirm `anchor=...` shows in the `pricing-refresh` console log and `RefreshSummary` includes `anchorStrategy`, `anchorFellBackCount`, `anchorMatchedVariantsAvg`.
4. Confirm fallback works: configure a strategy whose patterns match zero variants → expect `anchorFellBackCount > 0` and slot prices unchanged from sets_weighted baseline.
5. Configurator round-trip: save patterns, reopen the configurator, confirm `anchor_config_notes` is preserved as conversation context.

## Out of scope (deferred to follow-ons)

- **Safety rail for live products** — banner in the configurator when `lifecycle_status='live'` warning that save will affect live pricing. Add if Kyle reports accidental surprises.
- **Per-product chase rule library** — populate `anchorConcepts` for every product family (Cosmic planetary chases, Stadium Club Beam Team, etc.). Cadence: add one descriptor's full anchorConcepts per quarter. Tracked in [docs/icebox.md](../icebox.md).
