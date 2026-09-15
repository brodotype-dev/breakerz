# UX rethink — phased build plan

**Status:** 📋 Plan only, nothing built. Written 2026-09-15 off the design handoff in
[docs/design/2026-09-15-ux-rethink-handoff/](../design/2026-09-15-ux-rethink-handoff/README.md).
**Six decisions are needed before Phase 2 starts** — see [Decisions](#decisions-needed-before-building).

## What this is

The handoff restructures the consumer app around its two real jobs: *value a spot before you buy*,
and *log what you bought and what it returned*. It is not a visual refresh — it changes the
information architecture, adds a new surface, rewrites onboarding, and replaces the visual system.

This plan sequences that work against what the repo actually has today, and surfaces the
two blockers the handoff assumes away.

---

## The two blockers

### 1. The app does not capture what a break returned

The Log table's **Returned** column and **every number on Learn** are derived from a figure
we have never stored.

| Design needs | Repo reality |
| --- | --- |
| `Returned $330`, `Net +$265` | `user_breaks` has `ask_price` (what they paid) but **no returned/pull value column at all** — grep for `pull_value\|returned_value` across `app/`, `lib/`, `supabase/migrations/` returns nothing |
| "Call held / even" outcome | `outcome` is categorical `'win' \| 'mediocre' \| 'bust'` — not a dollar figure, so it cannot produce "$3,105 returned" |
| Learn: saved, return-by-format, spend-vs-returned chart | All require per-break returned value |

This is the same gap CLAUDE.md's north-star section already names: *"Pull data isn't captured yet
(My Breaks Phase 2 unblocks this)."* The north-star metric — `pull_value / ask_price ≥ 0.5` —
is blocked on exactly this column.

**That makes Phase 1 the highest-value phase in this plan, and it is not a design phase.**

### 2. There is not enough logged data for Learn to say anything

Production `user_breaks` (excluding test rows):

| Metric | Count |
| --- | --- |
| Total breaks | 4 |
| Completed | 3 |
| With an outcome | 3 |

Learn's copy asserts "11 of 14 calls held", "$3,400 saved in 30 days", "return by format" across
three format groups. With three completed breaks, every figure on that surface would be noise or
a placeholder. The handoff flags this itself ("the metrics assume the log is populated enough to
be meaningful") but does not gate on it.

**Learn ships last, behind a data-volume gate — not on a date.**

---

## Gap analysis

| Design requirement | Repo today | Verdict |
| --- | --- | --- |
| 4-item IA: Home / Research / Log / Learn | `/` (product grid), `/analysis`, `/my-breaks`, `/chase`, `/card-lookup`, `/player/[id]`, `/break/[slug]`, `/profile`, `/subscribe` | **Restructure.** No Home-as-router surface, no Learn. `/break/[slug]` + `/player/[id]` aren't in the new IA at all — see Decision 5 |
| Research = one destination, two tabs | `/analysis` is the deal checker; "recent valuations" doesn't exist as a list | New tab + new list view |
| Dark **and** light theme | Dark only. 172 CSS custom properties, no `prefers-color-scheme`, no `data-theme`, no `darkMode` config | **New capability**, not a re-skin |
| Public Sans + Roboto Mono | Inter + JetBrains Mono (`app/layout.tsx`) | Swap; mechanical |
| Design token set (`ink`, `rule`, `accent`, `buy/hold/pass`…) | `--terminal-*`, `--text-*`, `--signal-*`, `--accent-blue` | **93 files** reference `var(--…)`; **74** reference `terminal-*`. Large mechanical surface |
| Verdict words BUY / **HOLD** / PASS | `Signal = 'BUY' \| 'WATCH' \| 'PASS'` — and `WATCH` is **persisted** in `user_breaks.snapshot_signal` | **Naming collision.** See Decision 1 |
| Desaturated signal colors (`#6f9e7d`) | Saturated (`--signal-buy: #22c55e`) — explicitly on the handoff's "reads cheap" list | Token change |
| No glows | `--glow-green` etc. in use | Remove |
| Method table: 4 weighted inputs w/ percentages | Engine has the inputs (comps, prospect rank, sentiment, odds) but **does not emit per-input weights** | New engine output — see Decision 4 |
| Stale valuation marker (~3d) | No valuation-age concept on the consumer side | New; threshold is a guess (Decision 3) |
| Onboarding: 5 steps, valuation before paywall | 3-step wizard, gated + enforced as of #228/#232 | **Replaces** the wizard. Enforcement logic carries; screens don't |

---

## Phases

Ordered by *strategic clarity per engineering day* — the repo's own framing from
[execution-roadmap.md](../strategy/execution-roadmap.md) — not by visual impact.

### Phase 1 — Capture what a break returned  ⬅ start here

Unblocks the north-star metric, the Log table, and all of Learn. **Independent of the redesign** —
it ships value even if the rest of this plan is deferred, and it starts accumulating the data
Learn needs while later phases are built.

- Migration: `user_breaks.returned_value numeric` (nullable — historical rows stay null).
  Follow gotcha #12 (grant pattern) — consumer-facing RLS-gated write.
- Extend the existing complete-a-break flow (`PUT /api/my-breaks/[id]`) to accept it.
- "Add results" entry point on pending breaks (the design already draws this button).
- Keep `outcome` — categorical sentiment is still useful next to a number.
- Backfill: **none.** Don't invent figures for the 3 completed breaks.

**Done when:** a user can log a purchase, come back, and record what it returned.

### Phase 2 — Design foundation

Highest-risk mechanical change; everything visual depends on it. Do it in one pass, not per-screen.

- Fonts: Inter → Public Sans, JetBrains Mono → Roboto Mono.
- Token layer: map the handoff's two palettes onto CSS custom properties. Prefer
  **adding** semantic tokens and re-pointing existing `--terminal-*` / `--signal-*` names at
  them over a 93-file find-and-replace — smaller diff, reversible, no dead ends.
- Light theme: `prefers-color-scheme` + a `data-theme` override (Decision 2).
- Delete glow shadows and gradient fills.

**Risk:** this touches every consumer surface at once. Ship behind a branch with a preview build
and eyeball each route before merge. **Do not** start Phase 3 until this is merged — building new
screens on old tokens means rewriting them.

### Phase 3 — IA + Home

- Nav restructure: 4 destinations + a `TOOLS` group (Slabs, Chase). Desktop rail 196px,
  mobile 4-item tab bar.
- New `/` Home surface: header prompt (the one filled element), two route rows, pick-up-where-you-
  left-off, right-column stats.
- **Home's empty state must be designed before this ships** (Decision 6) — a new account has no
  stats and nothing to pick up, which is most of the surface.

### Phase 4 — Research

- Merge into one destination, two tabs (`Value a spot` / `Recent valuations`).
- Verdict band, method table with weight bars, "other spots, same product", "from your log".
- Method weights need the engine to emit them (Decision 4). If that's deferred, ship the tab
  structure and the verdict band, and hold the method table.

### Phase 5 — Log

Now that Phase 1 has been capturing `returned_value`, the full table renders honestly.

- Stat band (purchases / spent / returned / net / pending).
- Ruled table with the paid / returned / call / outcome columns.
- "Call held" logic: verdict matched outcome — including a PASS that would have lost money.

### Phase 6 — Learn  🔒 gated on data volume

**Gate:** do not build until the log has enough completed breaks *with* returned values to make
the metrics non-trivial. Suggested floor: **~25 completed breaks with returned value across at
least two format groups.** Below that the surface lies.

Until the gate clears, Learn is either absent from the nav or a single honest "keep logging"
state. Shipping fabricated numbers on the one surface that scores our own accuracy would
undermine the thing the product sells.

- Stat band, return-by-format bars, spend-vs-returned chart (Decision 7 — charting approach).

### Phase 7 — Onboarding

Replaces the 3-step wizard with the 5-step flow. **Carry forward the enforcement work from
#228/#232** — server-side 18+ rejection, the `(onboarding)` route group, the completion gate in
the consumer layout, and legal-acceptance capture. The screens change; the guarantees must not
regress.

Note the handoff collapses age + legal into step 1 and moves experience/era/spend/referral into
the profile. That means `/api/onboarding`'s payload shrinks — keep writing the fields it still
collects, and make sure the profile page can still edit the ones that moved.

---

## Decisions needed before building

| # | Decision | Why it matters | Recommendation |
| --- | --- | --- | --- |
| 1 | **WATCH or HOLD?** | `Signal` is `'WATCH'` in code and **persisted** in `user_breaks.snapshot_signal`. The design says HOLD everywhere | Keep `WATCH` in the data model; map to "hold" at the display layer. A rename means migrating stored rows for a copy change |
| 2 | **Theme default** | Design ships both; we have neither toggle nor light theme | System preference + user override, stored on `profiles` |
| 3 | **Stale threshold** | Drives Home's pickup block and the Research callout; 3d is the designer's guess | Pick from real valuation-age distribution once Research logs it |
| 4 | **Method weights** | The 4-input table is the most credible thing on Research, and the engine doesn't emit per-input weights today | Worth doing — it's the visible form of the moat. But it is *engine* work, not UI |
| 5 | **What happens to `/break/[slug]` and `/player/[id]`?** | Neither appears in the 4-item IA, but `/break/[slug]` is the current main consumer surface with slot tables and the inline analysis block | Not answered by the handoff. Needs a call before Phase 3 |
| 6 | **Home empty state** | Undesigned; it is what every new beta user sees first | Design before Phase 3 ships |
| 7 | **Learn chart** | Placeholder in the prototype; no charting library established | Defer with Phase 6 |

---

## What I would not do

- **Don't port the `.dc.html`.** The handoff is explicit; the `sc-if` constructs and inline styles
  are prototyping artifacts.
- **Don't build Learn on placeholder numbers** to make the nav look complete.
- **Don't do the token migration as a blind find-and-replace** across 93 files.
- **Don't rewrite onboarding first** because it's self-contained — it's the least valuable phase
  (the flow works today) and it would collide with Phase 2's tokens.
