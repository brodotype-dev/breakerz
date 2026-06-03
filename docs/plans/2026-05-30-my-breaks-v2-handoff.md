# My Breaks V2 — Solidity Pass · Handoff (2026-05-30)

> **Status:** ✅ **shipped 2026-06-01** on branch `feat/my-breaks-v2-solid` (off `origin/main`). All three items landed as planned, no schema migration, build clean. (1) verdict render gate in New Break; (2) honest stats — Avg vs Fair + Signal Mix with sample-size guardrails; (3) edit/delete on pending + completed breaks via new PATCH/DELETE on `/api/my-breaks/[id]`, plus a collapsed "Passed on" drawer for abandoned breaks (delete-only). PATCH recomputes `snapshot_signal`/`snapshot_value_pct` off the stored pure `snapshot_fair_value` (accepted caveat: pure-EV reference, slightly different from origin's market-adjusted signal). (Mirror of the approved plan file `~/.claude/plans/breakiq-session-squishy-meerkat.md`; this repo copy is the durable one.)

## TL;DR

Make the **My Breaks** consumer surface (the "action" half of the product) feel solid. Three scoped items, **no schema migration**, all client + API-route changes. Approved scope (Brody picked 3 of 4 candidates; dropped "snapshot freshness + import perf").

## Session context (so you can pick up cold)

Today's arc on the `breakerz` repo:
1. **Shipped PYT/PYP/margin-band** → PR [breakerz#176](https://github.com/brodotype-dev/breakerz/pull/176) on branch `feat/fair-value-pyt`, **flag-off** (`fair_value_pyt_enabled` default false in prod). Three commits: fair-value EV mode, the reasonable-margin band (steal/fair/overpaying with score-shift), liberal tuning (α=0.25, ±7%).
2. **Ran a 5-persona critique panel** (Breaker / Novice / Whale / PM / Investor) → personas crystallized at [docs/personas/](../personas/), session log at [docs/persona-reviews/2026-05-30-pyt-pyp-band-critique.md](../persona-reviews/2026-05-30-pyt-pyp-band-critique.md), findings promoted to [docs/BACKLOG.md](../BACKLOG.md). Convergent takeaway: **the pricing model is unfalsifiable until we capture actual pulls (recovery rate)** — that's the real gate before flipping the flag.
3. **Kicked off then parked "break-capture-v2"** (a unified break-logging spine). Brody concluded the heavy unification + AI bets (deal-scout, OCR pull-capture) aren't necessary yet — usage/retention is the binding constraint, not measurement. **Parked**, not cancelled.
4. **Narrowed to this:** make the *existing* My Breaks solid. ← you are here.

**Branch note:** the working tree may still be on `feat/fair-value-pyt`. **Start this work on a fresh branch off `origin/main`** (see below) — it's independent of the pricing PR.

## Start here (first moves tomorrow)

1. `git checkout -b feat/my-breaks-v2-solid origin/main` — branch off main, NOT off `feat/fair-value-pyt`. This work is independent.
2. **Dependency note (not a blocker):** item 1 reuses `AnalysisResultPanel`. On `main` that panel doesn't yet have the `marginZone` band copy (that's in the open PR #176). The panel still renders the verdict fine (BUY/WATCH/PASS + market range + reasoning) — the band tagline just appears automatically once #176 merges. No action needed; don't block on it.
3. **No migration.** All three items are client + API-route changes.

## Scope — three items

### 1. Show the verdict in New Break  ← the "wait, that's broken?" fix
The New Break flow computes the analysis, saves it, and **throws the result away**. In `BreakForm.handleSubmit` ([app/(consumer)/my-breaks/page.tsx](../../app/(consumer)/my-breaks/page.tsx) ~line 915) it sets `analysisResult` then immediately calls `onSaved()`, which navigates to the list and unmounts the form — `analysisResult` is never rendered. User clicks "Analyze & Save," copy promises a live analysis, server runs full `runBreakAnalysis`… they see nothing.

**Fix:** POST `/api/my-breaks` already returns `{ break, analysis }` (full `AnalysisResult`). Reuse [components/breakiq/AnalysisResultPanel.tsx](../../components/breakiq/AnalysisResultPanel.tsx). On `mode === 'new'` success, **don't** call `onSaved()` immediately — store the result, render the panel inline (replacing/below the form) with a "Done — back to My Breaks" button that then calls `onSaved()`. The break is already saved `pending`, so this is purely a render gate. Omit `productSlug` (page's product list has no slug; panel hides the self-link when absent). `log` mode keeps current behavior.

### 2. Honest, insightful stats
Replace vanity stats (count / total spent / W-M-B) with insight from data **already stored** on every row (`snapshot_signal`, `snapshot_fair_value`, `ask_price`, `outcome`). Extend `computeStats` ([page.tsx](../../app/(consumer)/my-breaks/page.tsx) ~line 117) — pure client compute, no API/schema change:
- **Avg vs Fair** = mean of `(ask − snapshot_fair_value) / snapshot_fair_value` across non-abandoned breaks with a snapshot → "+14% over fair" (red) / "−8% under fair" (green). The cheap, honest version of the recovery-rate instinct — no pulls required.
- **Signal mix of breaks you bought** → "2 BUY · 1 WATCH · 3 PASS" (surfaces "you keep buying PASS breaks").
- Keep Breaks count, Total Spent, W/M/B record.
- **Honesty guardrail** (per [north-star doc](../strategy/north-star-and-feedback-loop.md)): label with sample size ("across N breaks"); descriptive counts/averages only, no accuracy claims on small N.
- Layout: widen the stat block (wrapping card grid); metrics above are the spec.

### 3. Edit / delete a break
**API** — extend [app/api/my-breaks/[id]/route.ts](../../app/api/my-breaks/%5Bid%5D/route.ts):
- `DELETE`: resolve authed userId (reuse the `getAuthUserId` pattern from the sibling [route.ts](../../app/api/my-breaks/route.ts)), then `supabaseAdmin.from('user_breaks').delete().eq('id', id).eq('user_id', userId)`. **There is no DELETE RLS policy** ([migration](../../supabase/migrations/20260409120000_my_breaks.sql) only has select/insert/update) — scoping a service-role delete by `user_id` is the clean fix (consistent with how GET already reads via `supabaseAdmin` + `user_id`). No migration.
- `PATCH`: accept `ask_price`, `platform`, `platform_other`, `outcome`, `outcome_notes`; scope via `supabaseAdmin` + `user_id`. **When `ask_price` changes**, recompute `snapshot_value_pct` + `snapshot_signal` from the *stored* `snapshot_fair_value` via `computeSignal` ([lib/engine.ts](../../lib/engine.ts) ~line 102) — pure, no CH/Claude call. Rationale: the use case is "fix a typo," not "re-price." (Caveat: stored `snapshot_fair_value` is pure EV; original signal was market-adjusted, so the recompute uses pure fair value as reference — internally consistent, slightly different from origin. The dropped "snapshot freshness" item would have made this exact.)

**UI** — `PendingBreakCard` + `CompletedBreakCard` get small edit (pencil) + delete (trash) affordances:
- Delete → confirm → `DELETE` → `onRefresh()`.
- Edit → inline editor (ask_price + platform [+ other]; for completed also outcome + notes) → `PATCH` → `onRefresh()`.
- **Abandoned visibility (light, optional):** a collapsed "Passed on" section or an outcome-filter entry so "Didn't buy in" breaks aren't invisible. Keep minimal.

## Files to touch
- [app/(consumer)/my-breaks/page.tsx](../../app/(consumer)/my-breaks/page.tsx) — `BreakForm` (verdict render), `computeStats` + `BreakList` stats block, `PendingBreakCard` + `CompletedBreakCard` (edit/delete).
- [app/api/my-breaks/[id]/route.ts](../../app/api/my-breaks/%5Bid%5D/route.ts) — add `PATCH` + `DELETE`.
- Reuse: [components/breakiq/AnalysisResultPanel.tsx](../../components/breakiq/AnalysisResultPanel.tsx), `computeSignal` in [lib/engine.ts](../../lib/engine.ts).

## Verification
- **New Break:** `new` mode → AnalysisResultPanel renders the verdict → "Done" returns to list, break present as `pending`.
- **Stats:** ≥2 breaks → Avg-vs-Fair (correct sign/color) + signal mix match the rows.
- **Edit:** change ask price → row updates; value%/signal recompute from stored fair value (no CH call). Platform/notes persist.
- **Delete:** removed after refresh; another user's break can't be deleted (user_id scoping).
- **Regression:** Log Previous, CSV import/export, filters, complete/abandon still work.
- `npm run build` clean. **Gotcha:** this worktree's `.env.local` has `SUPABASE_SERVICE_ROLE_KEY=""`, so a real build needs a placeholder: `SUPABASE_SERVICE_ROLE_KEY=placeholder.placeholder.placeholder npm run build`.

## Out of scope (don't scope-creep)
- Snapshot freshness (capturing `marketFairValue` / `marginZone` on the snapshot) + CSV import perf — Brody dropped these from V2.
- Structured pull-value / recovery-rate capture — deferred earlier as premature (build-capture-v2 territory, parked).
