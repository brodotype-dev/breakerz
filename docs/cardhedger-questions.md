# CardHedger — Questions for the Team

Running list of questions to bring to the CardHedger team. Goal: build a good relationship, understand the API deeply, and unblock matching issues we've hit in production.

Add new questions as they come up. Mark answered ones with ✅ and the date + what we learned.

---

## Catalog Coverage

**1. Do you carry Chrome Prospect Autographs (CPA-* codes) for Bowman Chrome Baseball?**

We're importing 2025 Bowman Chrome Baseball and finding that CPA-* autograph variants (e.g. CPA-DL, CPA-DG, CPA-MG) return no candidates via card-search. Your search returns the player's BCP-* base card instead. Are CPA-* autographs indexed separately, under a different number format, or not yet in the catalog?

*Discovered: 2026-04-02 during 2025 Bowman Chrome Baseball import.*

---

**2. What's your coverage lag for new products?**

When a new set releases (e.g. 2025 Bowman Chrome), how long until cards appear in card-search results? Is there a way to check coverage status for a specific set before running matching?

---

**3. Is there a way to query "all cards in a given set"?**

Right now we use free-text card-search and can only find cards we already know the name/number of. A `?set=2025 Bowman Chrome&limit=500` endpoint (or similar) would let us validate our checklist imports against your catalog directly. Is anything like that on your roadmap?

---

## API Behavior

**4. Why do card-search results for autograph codes (BMA-*, CPA-*, etc.) not include a `number` field?**

For Bowman's Best autograph sets, candidates come back with `number: ""` or null. For base/prospect cards, the `number` field is populated correctly. Is the number field intentionally omitted for autos, or is this a data gap?

*This affects our matching: without a number to compare, we can't do code-based disambiguation for autos.*

---

**5. How should we handle multi-player cards?**

We have dual/triple autograph cards (e.g. `"Dylan Crews/James Wood"`, stored under codes like DA-XX, TA-XX). Card-search doesn't return reliable results for slash-delimited names. Is there a recommended query pattern for multi-player cards, or a card_id lookup by code?

---

**6. Is there a batch card-search endpoint?**

We currently call `/v1/cards/card-search` once per variant. For a product with 1000+ variants, that's 1000+ sequential searches. A batch endpoint (send N queries, get N result sets back) would dramatically speed up our matching runs.

---

**7. What's the intended use of the `sport` parameter in card-search?**

We pass `sport: "baseball"` on all queries. Does this filter results or just rank them? We've occasionally seen cross-sport candidates surface — wondering if the filter is strict or soft.

---

## Terminology & Naming

**8. How do you handle Bowman's "Retrofractor" parallel?**

We've mapped `Retrofractor` → `Base` or `Lazer Refractor` based on trial and error. Is there an official mapping, or does it depend on the specific set?

---

**9. What's the canonical variant name for a base Bowman Chrome Prospect card?**

We've seen `"Base"`, `"Refractor"`, and sometimes nothing in the `variant` field for what the checklist calls a base BCP card. What's the ground truth here?

---

**10. Do you follow Topps' official parallel naming or your own taxonomy?**

Topps uses names like `"Sky Blue Refractor"`, `"Aqua Refractor"`, `"Gold Mini-Diamond"`. Do you normalize these or index them as-is from Topps' official names?

---

## Relationship / Partnership

**11. Is there a developer Slack, Discord, or forum?**

We'd love to stay connected with other builders using your API and get earlier visibility into catalog updates and breaking changes.

---

**12. Is there a webhook or feed for new card additions?**

Our pricing cache has a 24h TTL. For newly released products, knowing when new cards hit your catalog would let us invalidate cache and re-run matching automatically rather than relying on manual re-runs.

---

**13. Are you open to sharing test/fixture data for a few known sets?**

For integration testing our matching pipeline, a small known-good dataset (e.g. 50 cards from 2025 Bowman Draft with expected card_ids) would let us regression-test query changes without burning API calls.

---

*Last updated: 2026-04-02*
