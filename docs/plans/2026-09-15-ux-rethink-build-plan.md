# UX rethink — phased build plan

**Status:** ✅ **Shipped 2026-09-15** (PRs #237–#244). Onboarding not built — see
[What shipped](#what-shipped). Learn remains unscheduled and out of the nav, as planned.

> **IA superseded 2026-09-15 (PR #243).** On review, Brody flagged that **Log and Breaks are the
> same idea** — the record of every break you analyzed and bought. They were merged into one
> destination labelled **Breaks** at `/my-breaks`, keeping the log's functionality. The separate
> `/breaks` product grid is deleted and its **Active Products** section moved to **Research**,
> below the two boxes. **Primary nav is now three destinations: Home / Research / Breaks** — the
> "fill Learn's dead slot with Breaks" resolution below no longer applies.
**Scoped UI/UX only — where the design conflicts with current code, current code wins.**
That constraint removed roughly half the designed surfaces; this plan says exactly which, and why.

## What shipped

| Phase | PR | Outcome |
| --- | --- | --- |
| 1 · Design foundation | #237 | ✅ Public Sans + Roboto Mono; handoff palette added and the existing `--terminal-*`/`--text-*`/`--signal-*` names **re-pointed** at it (~93 files inherit untouched); gradients flattened, glows → `none`; light palette defined |
| 2 · Nav + IA + Home | #238 | ✅ Desktop 196px rail + mobile tab bar; `/` → Home; product grid → `/breaks`; **Learn's dead slot filled with Breaks** |
| 3 · Research | #239 | ✅ Verdict band (ruled three-field, not a filled card); `signalLabel()` WATCH→HOLD; **262 hardcoded saturated `rgba()` swept across 52 files** |
| 4 · Verdict consistency | #240 | ✅ Finished the HOLD mapping on the three surfaces P3 missed |
| 5 · Mobile reachability | #241 | ✅ Regression fix — the 4-item bar had orphaned Slabs/Chase/Profile/Admin/**sign-out** on mobile |
| 6 · Shell height + docs | #242 | ✅ Mobile dead-scroll fix; this status |
| 7 · IA merge | #243 | ✅ Log + Breaks merged to one **Breaks** destination (3-item nav); `/breaks` deleted and **Active Products moved to Research**; the two Research boxes equalised; `/analysis` became a server wrapper. **Preserved the `1-800-GAMBLER` notice**, which existed only on the deleted page, by moving it into the consumer layout |

### Not built, and why

- **Log's table restyle.** Its key column (*Returned*) derives from data that doesn't exist, and
  `my-breaks/page.tsx` is 1,756 lines that can't be visually verified from here (auth-gated). A
  blind restyle there is the likeliest place to break something. Only the verdict-label fix landed.
- **Phase 6 onboarding as designed.** The valuable idea — *one real valuation before the paywall* —
  requires running a live valuation inside onboarding. That's new behaviour, not a re-skin, so it
  falls outside the scope. Restyling alone was already delivered by Phase 1's tokens.
- **Learn, Recent valuations, Home's pickup block, stale markers.** Blocked on the three data
  dependencies below. Unchanged.

### Follow-ups this work created

1. **The light theme has no switch.** The palette works via `[data-theme="light"]` but nothing sets
   it. A toggle (or system-preference wiring) is a small, separate decision — see Decision 3.
2. **Hex literals were deliberately left saturated.** The `rgba()` sweep was safe; a hex sweep was
   not, because the sport keys (`#3b82f6`/`#f97316`/`#22c55e`) are intentionally saturated identity
   colors that share values with the old signal colors. Any remaining off-palette hex needs
   case-by-case review.
3. **Nothing auth-gated was visually verified.** Preview deployments sit behind Vercel SSO and
   consumer routes need a session, so Home, the rail, Research and Log were verified by build +
   type-check + routing behaviour only. **Worth a human pass.**

Design source: [docs/design/2026-09-15-ux-rethink-handoff/](../design/2026-09-15-ux-rethink-handoff/README.md).

---

## The constraint, and what it costs

**Rule:** no schema changes, no new stored data, no engine changes. Re-skin and re-arrange what
exists.

The handoff describes the app as doing two jobs — *value a spot*, and *log what it returned*.
Under this constraint the **value** half re-skins almost completely. The **log-what-it-returned**
half largely cannot be built, because the data behind it was never stored.

### Three data dependencies gate the blocked half

| # | Missing | Verified how | What it blocks |
| --- | --- | --- | --- |
| 1 | **Returned / pull value per break** | `user_breaks` has `ask_price` but no returned-value column; `outcome` is categorical `win\|mediocre\|bust` | Log's **Returned** + **Net** columns; every dollar figure on Learn |
| 2 | **Valuation history** | `/api/analysis` only reads `products` — it **never inserts**. No valuation/analysis table exists in `information_schema` or in any migration | Research's entire **Recent valuations** tab; Home's **pick up where you left off**; Home's *"valuations this month"*; every **stale** marker |
| 3 | **Per-input method weights** | Engine emits a pipeline decomposition, not weighted inputs | Research's *"44% / 26% / 18% / 12%"* weight bars |

Dependency **2** is the expensive one. The handoff treats "recent valuations" as a core
destination, and nothing in the app remembers that a valuation happened.

A fourth, softer gap: the design's *"$3,400 saved by passing on spots above value"* counts spots
the user **walked away from**. We only ever record purchases — a decision to pass leaves no trace.
That metric isn't blocked on a column; it's blocked on a behaviour we don't capture.

### Survives / blocked

| Designed surface | Under UI-only |
| --- | --- |
| Visual system — fonts, tokens, light theme, no glows | ✅ **Full** |
| Nav + 4-item IA, `TOOLS` group, mobile tab bar | ✅ **Full** (routing only) |
| Research → *Value a spot* (verdict band, actions, other-spots) | ✅ **Full** — re-skin of `/analysis` |
| Research → method table | ⚠️ **Adapted** — see Phase 3 |
| Log surface | ⚠️ **Adapted** — loses Returned + Net |
| Home | ⚠️ **Reduced** — header + route rows only |
| Onboarding | ⚠️ **Resequenced** — same questions |
| Research → *Recent valuations* tab | ❌ **Blocked** (dep 2) |
| Home → pick up where you left off | ❌ **Blocked** (dep 2) |
| Stale markers anywhere | ❌ **Blocked** (dep 2) |
| Learn — as designed | ❌ **Blocked** (dep 1) |

---

## What *is* derivable today

Worth stating plainly, because it's more than zero and it shapes the adapted surfaces. From
`user_breaks` with no schema change:

| Figure | Source |
| --- | --- |
| Breaks logged · awaiting results | `count(*)`, `status='pending'` |
| **Paid** per break | `ask_price` |
| **What it was worth** at purchase | `snapshot_fair_value` |
| **% over/under value paid** | `(ask_price − snapshot_fair_value) / snapshot_fair_value` — the same math already behind `/admin/market-delta` |
| **Did the call hold** | `snapshot_signal` vs `outcome` |
| Spend over time | `ask_price` + `created_at` |

Not derivable: anything about what a break *returned*, and anything about a spot the user didn't buy.

---

## Phases

### Phase 1 — Design foundation

Pure UI, unblocks everything else, and delivers most of the perceived change on its own.

- Fonts: Inter → Public Sans, JetBrains Mono → Roboto Mono.
- Tokens: add the handoff's semantic names and **re-point the existing `--terminal-*` / `--signal-*`
  variables at them** rather than find-and-replacing 93 files. Smaller diff, reversible.
- Light theme: `prefers-color-scheme` + a `data-theme` override.
- Remove glow shadows, gradient fills, saturated verdict colors, pill chips.
- Map `WATCH` → "hold" **at the display layer only**. `Signal` stays `'WATCH'` in code and in the
  persisted `user_breaks.snapshot_signal` — renaming stored values for a copy change is exactly
  the kind of conflict this scope says to avoid.

### Phase 2 — Nav + IA

- Desktop 196px rail, mobile 4-item tab bar, `TOOLS` group for Slabs + Chase.
- Research becomes one destination. **Ship it with a single view, not two tabs** — the second tab
  has no data source, and an empty tab is worse than no tab.
- Decide where `/break/[slug]` and `/player/[id]` live (Decision 1) — unchanged from the first
  draft, and now more urgent: with Recent-valuations gone, `/break/[slug]` is still the main
  place a user actually sees slot pricing.

### Phase 3 — Research (*Value a spot*)

The strongest phase under this constraint — the existing `/analysis` already produces everything
the designed screen shows.

- Verdict band: VERDICT · FAIR VALUE · PREMIUM OVER VALUE, in the new type and desaturated colors.
- **Method table, adapted.** The engine doesn't emit per-input weights, but
  [WhyThisPriceCard](../../components/breakiq/WhyThisPriceCard.tsx) already decomposes a price into
  five honest layers — *Baseline EV · EV after lifecycle · Effective score · Weighted by EV × (1 +
  score) · Model slot cost*. Re-skin **that** into the design's ruled-row treatment instead of
  inventing weights. Same intent (show the work), real numbers, no engine change.
- Actions row, and the right-hand "other spots, same product".
- Drop "from your log" (needs valuation history to say "you bought this twice and paid above value").

### Phase 4 — Log

- Stat band and ruled table in the new system.
- **Column swap:** the design's `Paid / Returned / Call / Outcome` becomes
  **`Paid / Value / Call / Outcome`** — substituting `snapshot_fair_value` for the returned figure.
  Row shape and rhythm survive; the honest question shifts from *"what did it return?"* to
  *"what was it worth when you bought it?"*
- Keep the existing outcome capture (win/mediocre/bust) exactly as-is.

### Phase 5 — Home (reduced)

- Header: date label, greeting, subhead, and the single filled "Log now" prompt.
- Two route rows → Research and Log.
- Right-column stats limited to **Breaks logged** and **Awaiting results**. Drop "valuations this month".
- **Cut the pick-up block entirely** — it has no data source. Do not substitute recent *breaks*
  for recent *valuations*; they're different objects and the swap would quietly misrepresent them.
- Empty state still needs designing (Decision 2), and matters more now that the surface is thinner.

### Phase 6 — Onboarding (resequenced)

- Adopt the 5-step shape and the *valuation-before-paywall* sequencing — that's the valuable idea
  and it's pure UX.
- **Keep collecting the current fields.** The handoff moves experience/era/spend/referral into the
  profile, which changes `/api/onboarding`'s payload. Under this scope, keep the payload.
- Carry forward the #228/#232 enforcement: server-side 18+ rejection, the `(onboarding)` route
  group, the consumer-layout completion gate, legal-acceptance capture. Screens change;
  guarantees must not.

### Not scheduled — Learn

Every figure on it needs data dependency 1. **Don't build it, and don't put it in the nav.**
A four-item IA with a dead fourth item is worse than a three-item IA.

The handoff's IA is Home / Research / Log / Learn. Without Learn that's three destinations plus
the TOOLS group — which is a coherent structure, not a broken one.

---

## If you want the blocked half, here's the smallest unlock

Not scheduled, recorded so the tradeoff is explicit. Each is small on its own; both are schema work.

| Unlock | Roughly | Returns |
| --- | --- | --- |
| `user_breaks.returned_value numeric` + "add results" input | one nullable column, one API field, one form control | Log's Returned/Net columns · Learn becomes possible · **the north-star metric `pull_value / ask_price` starts accumulating** |
| Persist each analysis run | one table + one insert in `/api/analysis` | Recent valuations tab · Home pickup · stale markers |

Neither changes the pricing engine or any existing behaviour — both are additive. Worth revisiting
once the re-skin has landed and the shape of the new app is real.

---

## Decisions still needed

| # | Decision | Note |
| --- | --- | --- |
| 1 | **Where do `/break/[slug]` and `/player/[id]` go?** | Absent from the new IA; `/break/[slug]` is the current main consumer surface. Blocking for Phase 2 |
| 2 | **Home empty state** | Undesigned, and the reduced Home is mostly empty state for a new user |
| 3 | **Theme default** | System preference + user override recommended |
| 4 | **Three destinations or four?** | Recommend three (drop Learn) over a placeholder fourth |

Resolved by the constraint, no longer open: WATCH vs HOLD (display mapping), method weights
(re-skin the existing decomposition), stale threshold (moot — no valuation history), Learn's chart
(not building Learn).
