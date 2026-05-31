# BreakIQ Personas

Canonical, version-controlled definitions of the people BreakIQ serves, competes with, and answers to. One file per persona. These are the source of truth — edit them here as we learn more; project memory just points at this folder.

Two uses:
1. **Critique panel** — throw all five at a feature for a critical read (see [docs/persona-reviews/](../persona-reviews/) for the longitudinal log of those sessions).
2. **Day-to-day grounding** — when making a product/copy/pricing call, check it against the relevant persona's goals, fears, and vocabulary.

## The panel

| Persona | One-liner | Relationship to BreakIQ |
|---|---|---|
| [The Breaker](the-breaker.md) | Runs live breaks, prices slots, lives on margin | Subject / potential channel |
| [The Novice Consumer](the-novice-consumer.md) | New buyer, FOMO-driven, jargon-allergic | Core user (top of funnel) |
| [The Whale Consumer](the-whale-consumer.md) | High-spend across many breaks, sophisticated | Core user (revenue + edge) |
| [The Product Manager](the-product-manager.md) | Rigor on the right problem + validation | Internal critic |
| [The Investor](the-investor.md) | Defensibility, market, unit economics | External critic |

## Running the critique panel

Launch 5 parallel `general-purpose` agents, one per persona. Give each: the feature/product context + pointers to the real code/docs + that persona's file (or its lens inline). Ask each for:
1. One thing that genuinely works
2. Top 3-6 critiques (concern + the specific mechanic it stems from + why it matters to *me*)
3. The single biggest risk
4. A persona-specific closer (the Breaker's missed opportunity, the Investor's feature-or-company verdict, etc.)

**Trust convergent findings most** — where personas independently land on the same nerve. Promote actionable findings to [docs/BACKLOG.md](../BACKLOG.md); file the session record under `docs/persona-reviews/`.

**Caveat:** agents critique the product *as designed + documented* (they read code/CHANGELOG/strategy/sentiment files) — they don't drive a live app. They're informed archetypes, not research-validated personas. The Breaker + both Consumers are grounded in real r/sportscards sentiment (see each file); the PM + Investor are informed archetypes.
