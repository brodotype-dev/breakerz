# Break Analysis v2 + Insight Capture

## Context

After a working session with Kyle (2026-04-28), several gaps in the BreakIQ break analysis surfaced. CardHedger pricing data is good but imperfect for our use case — particularly at release, for mid-tier variants, and for players whose sales don't cleanly entity-match on eBay. More importantly, the current consumer break analysis assumes a single product, a single format (hobby OR BD), and a single team or single player slot. That doesn't match how breaks are actually sold.

Separately, Kyle has a constant stream of market intelligence in his head (eBay browsing habits, breaker behavior, release-week patterns) that we have no mechanism to capture. BreakIQ Bets exists but only encodes player-level sentiment scores — it can't capture asking-price observations, release premiums, or hype tags.

Decisions confirmed with the user:
- **Phase 1 wedge:** Break composition v2 (mixed formats including jumbo, multi-team, multi-player).
- **Format scope:** Mixed formats *and* jumbo as a third format — single product per break for v1.
- **Insight capture (revised 2026-04-29):** Discord-driven instead of dedicated mobile surface. A `#breakiq-insights` channel becomes the input surface; a bot pipes messages through the parser and uses ✅/❌ reactions for confirm/discard.
- **Asking-price tracking:** Capture observed prices *and* show the range to consumers ("Streams asking $12k–$15k, our model says $9k").

## Synthesis of the Kyle session

**Break composition is more complex than "X hobby cases of one product."** Real breaks mix formats: 10 hobby + 5 BD, or hobby + jumbo + BD. Each format has its own case cost and odds. Whales especially buy multiple teams or specific players, sometimes bundle-priced. Players are buyable as standalone slots, not just as part of a team.

**Pricing data has structural gaps.** CardHedger entity matching is imperfect — sales on eBay don't always link to the right player/variant. 1/1 sales pollute averages (Austin Reaves slot at $4,400 because a 1/1 sold for $2,200). Mid-tier (orange/gold) variants are the right anchor for "fair price," but data sparsity is real. Pre-release / release-week resale runs ~20% higher than steady-state, decaying over the first few days — current model has no notion of this.

**Asking price vs. fair price.** Kyle wants consumers to see *both*: what streams are charging AND what BreakIQ thinks. The value prop is the delta — "they're asking $15k for Flagg, we think it's $9k." Just showing fair price without market context makes us look wrong when the market is actually wrong.

**The proactive-data principle.** CardHedger gives us reactive data. Kyle is the proactive source — he's constantly browsing eBay, watching breaks, noticing patterns. The job is to make it cheap enough for him to log observations that we accumulate enough structured input to identify reusable signals worth automating.

## Current State (verified in code)

- `lib/engine.ts:computeSlotPricing` — already returns BOTH `hobbySlotCost` AND `bdSlotCost` per player simultaneously. The single-format limitation is at the analysis/UI layer, not the engine.
- `lib/analysis.ts:runBreakAnalysis` — takes `{ productId, team, askPrice, breakType, numCases }`. Hardcoded single product, single team. Sets `hobbyCases` and `bdCases` to the same value as a defaulting hack, then `breakType` picks one.
- `app/(consumer)/analysis/page.tsx` — single-product dropdown, single-team dropdown, hobby/BD toggle, single askPrice. No multi-team, no player-only mode.
- `app/(consumer)/break/[slug]/page.tsx` — same single-format, single-product dashboard. Uses `<SegmentedControl>` for hobby/BD and a `<CounterInput>` for cases.
- `products` table: `hobby_case_cost`, `bd_case_cost`, `hobby_am_case_cost`, `bd_am_case_cost`. **No jumbo column.**
- `player_product_variants`: has `hobby_sets`, `bd_only_sets`, `hobby_odds`, `print_run`. **No jumbo_sets, no jumbo_odds.** `print_run` is populated — we can detect 1/1s today.
- `lib/cardhedger.ts:computeLiveEV` — aggregates 90-day comps via simple median. **No 1/1 / print-run filter.** This is the source of the Austin Reaves bug.
- `lib/pricing-refresh.ts` — aggregates per-variant EVs into per-player EV by `sets`-weighted average. Currently includes all variants regardless of print run.
- BreakIQ Bets: two flavors — per-product (`/admin/products/[id]` debrief) and global (`/admin/breakiq-betz`). Both parse free text via Claude → `breakerz_score` (-0.5 to +0.5) + `breakerz_note` on player_products. Admin-only. No asking-price or hype-tag concept.
- No mobile-specific admin routes today.

---

## Phase 1: Break Composition v2 (the immediate ship)

### Schema changes (`supabase/migrations/`)

1. `products`: add `jumbo_case_cost numeric`, `jumbo_am_case_cost numeric` (both nullable). Mirrors the hobby/bd pattern.
2. `player_product_variants`: add `jumbo_sets integer`, `jumbo_odds numeric` (both nullable). Mirrors `hobby_sets` / `hobby_odds`.
3. Backfill is a no-op — products without jumbo just leave the columns null and the format won't render.

Catalog hydration (`lib/variants-from-catalog.ts`, `lib/cardhedger-catalog.ts`) needs to know which CH variants are jumbo-only. **Open lookup question for the catalog logic** — defer the actual jumbo detection rules to a small follow-up; for v1 ship the schema and let admins manually mark jumbo via the variant editor if needed. Most of the value comes from the format mix UX, not perfect jumbo hydration.

### Engine + analysis changes

`lib/engine.ts`:
- Extend `BreakConfig` → `{ hobbyCases, bdCases, jumboCases, hobbyCaseCost, bdCaseCost, jumboCaseCost }`.
- `computeSlotPricing` gains a third pool calculation parallel to the hobby pool. `jumboWeight` uses the same `effectiveScore` multiplier as hobby (whereas BD uses raw `evMid` — keep that asymmetry; jumbo behaves like hobby).
- Add `jumboSlotCost`, `jumboPerCase` to the per-player and per-team return shape.
- `computeTeamSlotPricing` sums `jumboSlotCost` into `totalCost`.

`lib/analysis.ts:runBreakAnalysis` — new signature:
```ts
runBreakAnalysis({
  productId,
  teams: string[],                          // multi-select
  extraPlayerProductIds?: string[],         // standalone player slots
  formats: { hobby: number, bd: number, jumbo: number },
  caseCosts: { hobby?: number, bd?: number, jumbo?: number },  // override; defaults to AM > MSRP
  askPrice: number,                         // bundle ask
})
```
- Compute slot pricing once for the product (engine returns all formats).
- Sum each selected team's costs across the requested formats.
- Add each `extraPlayerProductIds` player's per-format slot cost.
- Compute one bundle `fairValue` and one `signal` against the bundle `askPrice`.
- Claude prompt expands to cover the multi-team / multi-player composition.

API surface (`app/api/analysis/route.ts`): accept the new shape; keep one POST, fail closed on legacy single-team payloads with a clear error so the client must update.

### UX

`app/(consumer)/analysis/page.tsx` (configure-a-break entry):
- Product picker stays single-select (single-product per break for v1).
- Replace team dropdown with multi-select chips ("+ Lakers, + Mavericks, + 76ers").
- Add `+ Add player slot` row → searchable picker pulling from this product's `player_products`. Selected players show as removable chips.
- Replace hobby/BD toggle with three counter inputs: Hobby cases, BD cases, Jumbo cases. Hide a counter if the product doesn't have that format's case cost.
- Show case cost per format with a "use AM price" checkbox per format (defaults on when AM is set; falls back to MSRP).
- Single ask-price input labeled "Bundle price" with a hint: "Total you'd pay for this combination."

`app/(consumer)/break/[slug]/page.tsx`:
- Replace `breakType` segmented control with the same three-format counter UI.
- Team slots table shows hobby + BD + jumbo columns conditional on what the product supports; total column.
- Counter changes drive the existing `useMemo(computeSlotPricing)` recomputation.

### Data quality fix bundled into Phase 1

`lib/pricing-refresh.ts` and `lib/analysis.ts` aggregation: **filter out variants with `print_run <= 1` when computing per-player aggregated EV.** Single-line filter on the `variants.filter(...)` step before the sets-weighted average. Eliminates the Austin Reaves bug. Variant-level EV for actual 1/1 cards is preserved (those still get displayed if a player is searched directly), but they no longer pollute slot pricing.

Mid-tier (orange/gold) anchor: parked. Kyle was directionally right but data sparsity needs analysis before we change the weighting basis. Add a one-line follow-up note in `docs/pricing-architecture.md`.

### Critical files to modify

- `supabase/migrations/<new>_jumbo_format.sql`
- `lib/types.ts` — `BreakConfig`, `PlayerWithPricing`, `TeamSlot` (add jumbo fields)
- `lib/engine.ts:computeSlotPricing`, `computeTeamSlotPricing`
- `lib/analysis.ts:runBreakAnalysis` — new multi-team / multi-player / multi-format signature
- `lib/pricing-refresh.ts` — print_run ≤ 1 filter in variant aggregation
- `app/api/analysis/route.ts` — request schema
- `app/(consumer)/analysis/page.tsx` — multi-select team chips + player picker + format counters
- `app/(consumer)/break/[slug]/page.tsx` — format counters replace segmented control
- `components/breakiq/TeamSlotsTable.tsx`, `components/breakiq/PlayerTable.tsx` — show jumbo column conditionally
- `lib/types.ts` — `Product` adds `jumbo_case_cost`, `jumbo_am_case_cost`
- `app/admin/products/[id]/edit/` — admin editor adds jumbo cost fields

### Verification (Phase 1)

- Migration applies on staging Supabase (`zucuzhtiitibsvryenpi` is prod — apply to staging first).
- Pick a product without jumbo (e.g., a Topps Series 4): jumbo counter hidden, hobby+BD mix works, slot costs add up to bundle.
- Pick a product where we manually set `jumbo_case_cost`: counter appears, jumbo slot costs render.
- Configure a 2-team + 1-player bundle: total slot cost = sum of selected teams + standalone player; signal computed against bundle ask price.
- Reaves regression: pick a product where a 1/1 sale was inflating his slot. Verify his per-slot cost drops to a sane value with the print_run filter on.
- Old-shape API request (legacy `team: string`) returns a 400 with a clear error.

---

## Phase 2: Discord-driven insight capture (replaces both BreakIQ-Bets-extension and dedicated-mobile plans)

### Why Discord, not a custom surface

Earlier drafts of this plan tried to extend the BreakIQ Bets debrief or build a dedicated mobile capture route. Both miss the point: Kyle (and any contributor we add later) already lives on his phone with chat apps open all day. Building a custom mobile surface for "type or voice-note your read" is reinventing what Discord already gets right — voice-to-text input, mobile UX, multi-user, search, edit, archive — for free.

A dedicated `#breakiq-insights` Discord channel where contributors post observations becomes the input surface. A bot listens, pipes each message through the existing parser, and replies with proposed updates. ✅/❌ reactions confirm or discard.

### Flow

1. Trusted contributor posts a message in `#breakiq-insights`. Voice memos are auto-transcribed by Discord (or we transcribe via Whisper if Discord's accuracy is poor).
2. Bot receives the message via Discord webhook / gateway event, fires `POST /api/admin/parse-bets-discord` with the text.
3. The endpoint runs the existing global BreakIQ Bets parser logic (extended for asking-price + hype-tag outputs, see "What the parser extracts" below) and stores a *pending* row per proposed update.
4. Bot replies in-channel with the proposed updates as a numbered list, plus ✅ / ❌ reactions on the bot's own reply.
5. ✅ from a trusted user → endpoint commits the pending updates to the underlying tables (`player_products.breakerz_score`, `market_observations`, `player_risk_flags`). ❌ → discards.
6. Bot edits its reply to show "Applied 3 of 4 updates" or "Discarded".

### What the parser extracts

Same three outputs as the original Phase 2 plan, just sourced from Discord messages:

1. **Player sentiment** — `{ player_id, suggested_score (-0.5..0.5), reason_note, confidence }` — writes to `player_products.breakerz_score`.
2. **Asking-price observations** — `{ scope: 'team' | 'player' | 'variant', scope_id, format, observed_price_low, observed_price_high, source_note, confidence }` — writes to new `market_observations`.
3. **Hype tags** — `{ scope_type, scope_id, tag: 'release_premium' | 'cooled' | 'overhyped' | 'underhyped', strength, decay_days }` — also `market_observations`.
4. **Risk flags** — `{ player_id, flag_type, note }` — writes to existing `player_risk_flags`.

### Storage

New tables:

**`pending_insights`** — staging for parser output before ✅ confirmation. Keys to the originating Discord message so reactions resolve to the right row.
```
id uuid pk
discord_message_id text         -- the bot's reply that has the reactions
discord_channel_id text
source_user_id text             -- Discord user who posted the original message
source_text text                -- the raw narrative from the contributor
parsed_updates jsonb            -- array of proposed updates (typed payload)
status text                     -- 'pending' | 'applied' | 'discarded' | 'expired'
created_at timestamptz default now()
resolved_at timestamptz
expires_at timestamptz default now() + interval '24 hours'
```

**`market_observations`** — same shape as the prior Phase 2 design (asking-price + hype-tag, with `expires_at` for natural staleness).

**`discord_contributors`** — minimal allowlist of Discord user IDs who can post + ✅ confirm.
```
discord_user_id text pk
display_name text
role text                       -- 'admin' | 'contributor'
profile_id uuid (fk profiles)   -- optional link to a BreakIQ user
created_at timestamptz
```

### Consumer surface

Same as the original Phase 2 plan: `/break/[slug]` shows asking-price chips next to team slots and hype-tag chips next to player names, with tooltips for source notes. Display-only for v1 — observations don't yet feed back into model weighting.

### Bot infrastructure

- **Discord application + bot token** — created once, scoped to the BreakIQ server.
- **Slash commands** for nice UX even without typing in the channel: `/breakiq read <narrative>`, `/breakiq history`, `/breakiq retract <id>`. Optional in v1 — channel listening covers the main flow.
- **Bot host**: a Vercel function on the same project handles incoming events. Discord requires a public webhook URL with sub-3s response; ack the webhook in 200ms then process async via `waitUntil()`.
- **Verification**: Discord signs every webhook payload with `X-Signature-Ed25519`. We verify against the public key before processing — same security model as Stripe webhooks.

### Critical files

- `supabase/migrations/<new>_pending_insights_and_market_obs.sql` — `pending_insights`, `market_observations`, `discord_contributors`
- `app/api/discord/interactions/route.ts` — webhook receiver (signature verify + ack within 3s + dispatch)
- `app/api/discord/parse-and-stage/route.ts` — async handler: runs Claude parser, stages updates, posts the reply with reactions
- `app/api/discord/reaction/route.ts` — handles ✅/❌ reactions, applies or discards `pending_insights` row
- `lib/discord.ts` — REST helpers (post message, add reaction, edit message), signature verification
- `lib/insights-parser.ts` — extracted Claude parser shared between Discord handler and any future channels (Slack later, etc.)
- `app/(consumer)/break/[slug]/page.tsx` — render asking-price chip + hype-tag chips
- `lib/types.ts` — `PendingInsight`, `MarketObservation`, parser output union

### Verification

- Post in `#breakiq-insights`: "Flagg PYP is 12–15k on streams. Wemby injured." → bot replies within ~3s with two proposed updates and ✅/❌ reactions.
- Click ✅ on the bot's reply (as an allowlisted user) → bot edits reply to "Applied 2 of 2 updates"; rows appear in `market_observations` + `player_risk_flags`.
- Click ❌ → bot edits to "Discarded"; nothing committed.
- Post as a non-allowlisted user → bot does not respond.
- Webhook with bad signature → returns 401.
- Pending row left for >24h auto-expires; the cron status panel surfaces stale pending counts.

### Why no Phase 3 anymore

The dedicated mobile capture surface from the prior plan is obsolete. Discord on phone is the mobile capture surface. If voice-memo transcription accuracy on Discord's side ever turns out to be a problem, we add a Whisper transcription step in `parse-and-stage` — small change, no new UI.

---

## Out of scope (explicitly)

- **Multi-product breaks** (one break spanning multiple SKUs): user chose single-product for v1.
- **Mid-tier (orange/gold) weighted anchor:** Kyle's instinct is right but needs a data analysis to confirm coverage per player before changing weighting.
- **Release-window premium decay model:** captured as a hype tag (Phase 2) but the model doesn't auto-apply it yet.
- **Asking-price feeding back into fair-value weighting:** display-only in Phase 2; model weighting decision parked until we have volume.

## Documentation touch-points (per CLAUDE.md convention)

- Save this plan file at `docs/plans/2026-04-29-break-analysis-v2.md` (copy from `~/.claude/plans/`) at end of plan mode.
- Architecture doc: `docs/break-analysis-v2.md` (live reference).
- CHANGELOG entry per phase shipped, linking to both.
- CLAUDE.md: index entry + one-line summary in Current State.
