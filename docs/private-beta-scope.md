# Private Beta — Product Scope

> Sibling doc to [beta-launch-checklist.md](./beta-launch-checklist.md). This one captures **what products are in the private beta and why**, plus the operational implications of the scoping decision.

**Decision (Brody + Kyle, 2026-05-20):** Private beta ships with **the most recent Bowman product per sport**. Everything else stays in the catalog as `is_active = false` (hidden drafts).

---

## Why this scope

- **Intentional surface.** We don't have to deal with users asking about products that aren't ready or whose data quality we haven't validated. Each product we keep active gets full attention from cron coverage, manual QA, and SME observation accumulation.
- **Bowman = the most pull data per sport.** Bowman flagship is the dominant prospect product in baseball, growing in basketball. It's the product breakers do the most volume on, so it's where the "stop overpaying breakers" value prop is most legible.
- **Cron breathing room.** With ~3 active products instead of ~16, per-product workers won't be crowding the 300s Vercel kill — we routinely saw 282–296s before this decision (see the 2026-05-20 `ch_price_cache` write-bug entry in CHANGELOG.md). Less pressure → fewer chunk timeouts → fewer cache write failures.
- **Faster observation accumulation.** SMEs on Discord see fewer products in `/insight` + `/break-price` autocomplete; their reports concentrate on the products in beta. Slice 2b verdict enrichment (gated on 3+ observations per product) clears its threshold sooner per product.

---

## In scope (active)

| Sport | Product | Slug | `product_line` |
|---|---|---|---|
| Baseball | 2026 Bowman Baseball | `2026-bowman-baseball` | `bowman_flagship` |
| Basketball | 2025-26 Bowman Basketball | `2025-26-bowman-basketball` | `bowman_flagship` |
| Football | **TBD — see open question below** | | |

## Out of scope (hidden draft)

Everything else stays in the catalog with `is_active = false`. Source of truth: `SELECT name, slug FROM products WHERE is_active = false`.

As of 2026-05-20, the products to flip from active → inactive are everything currently `is_active = true` except the two above (and whatever Football product we land on). 13 products to hide: 5 baseball, 6 basketball, 3 football (current).

---

## Open questions

1. **Football coverage.** Bowman doesn't ship football products. Three options:
   - **(a) Skip football entirely for private beta.** Cleanest, narrowest scope. Football breakers don't get the product. We risk an awkward "is this for baseball/basketball only?" reaction.
   - **(b) Use the most-recent Panini flagship.** Current candidates: `2025 Panini Prizm Football` (most volume), `2025 Panini Donruss Football`, `2024 Panini Donruss Optic`. Prizm is the canonical answer if we want flagship parity.
   - **(c) Use the most-recent Topps Chrome equivalent.** Topps does ship football, but not under the Bowman line; the closest analog is Chrome Football (not currently in our catalog).
   - **Recommendation pending Brody + Kyle.** Default to (b) Prizm Football if we want any football coverage; otherwise (a).
2. **Pre-release Bowman.** What happens when next year's Bowman comes out? Auto-rotate to the newer, deactivate the previous, or run both for a transition window? Document the policy here when we hit the first rotation.

---

## How to add / remove a product from the beta roster

**Hiding a product (active → draft):**
1. **Via admin UI (recommended):** open the product's edit page → flip the "Active" toggle off → click Publish or Save Draft. The toggle now wins on edit (was broken pre-2026-05-20 — Publish silently re-activated; see CHANGELOG entry for the fix).
2. **Via SQL/MCP (bulk):** `UPDATE products SET is_active = false WHERE slug IN (...);`
3. Consumer routes immediately stop listing it. Cron skips it on next firing. Discord parser drops it from roster autocomplete on next interaction.
4. Catalog cache (`ch_set_cache`) + price cache (`ch_price_cache`) rows stay — re-activating later doesn't require a fresh fetch unless data has aged past TTL.

**Adding a product (draft → active):**
1. `UPDATE products SET is_active = true WHERE slug = '<slug>';`
2. Hit admin "Refresh CH Catalog" button to repopulate `ch_set_cache` with `card_description` (if catalog rows pre-date 2026-05-20, they're missing the field — see the catalog dedup CHANGELOG entry).
3. Hit admin "Refresh Pricing" button to seed `ch_price_cache` and `pricing_cache` before next cron firing.
4. Verify `lifecycle_status` is correct (`live` for shipped products, `pre_release` for not-yet-released, `dormant` for retired). See `docs/product-lifecycle.md`.

---

## Operational implications to remember

- **CH coverage tracker scope.** When we build the "% of cards priced per product per day" dashboard (deferred per 2026-05-20 cache-fix entry), its denominator should be `WHERE is_active = true` — otherwise hidden drafts drag the number down for no useful reason.
- **Pressure conversations with River.** Same — when we share coverage data with CardHedger, scope to the beta roster. Don't ask CH to improve coverage on products our users don't see.
- **Discord SME flows.** `/insight` and `/break-price` parser roster queries already filter to active products (see `lib/insights-parser.ts`). No code change needed on this front.
- **`/break/[slug]` page coverage.** Hidden products will 404 (consumer route is gated on `is_active`). If we link to a now-hidden product slug anywhere (emails, marketing, old shares), the user lands on a not-found. Worth a quick audit of `lib/email.ts` and any seeded outbound content before flipping.
- **Pre-release teasers.** Products in `lifecycle_status = 'pre_release'` AND `is_active = true` render the hype layout (countdown + chase cards). If we want to tease an upcoming Bowman release publicly during beta, that's the lever.
- **Free-tier breathing room.** Bumped 3 → 5 lifetime analyses on 2026-05-20 specifically for private beta — gives new users enough room to feel the product before hitting the paywall. Constant lives at `FREE_TIER_ANALYSIS_LIMIT` in `lib/usage.ts`; bumping it again later auto-updates the `/subscribe` copy.

---

## Revisit triggers

Reopen this scope decision when:
- Private beta exits to public beta or GA.
- A breaker partnership / co-marketing deal needs a specific non-Bowman product live.
- The "% slot pricing accuracy" metric on Bowman products crosses a confidence threshold and we want to expand the experiment.
- Kyle or Brody flag a user request pattern asking for a specific product.
