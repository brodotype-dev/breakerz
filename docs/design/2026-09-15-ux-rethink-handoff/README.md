# Handoff: BreakIQ UX rethink — navigation, home, and visual system

## Overview

A restructure of the BreakIQ consumer app around what the product actually does today: **value a slot before you buy into a break**, and **log what you bought and what it returned**. It replaces the platform-ish surface area with a four-item information architecture, adds a Home surface whose primary call to action is logging, and formalizes a quieter visual system.

Three things changed conceptually, and they matter more than the pixels:

1. **No live-break framing anywhere.** `lifecycle_status` (`pre_release | live | dormant`) in `lib/types.ts` is a *product* state, and a break is only `pending | completed | abandoned`. Nothing in the data model knows when a break happens, so the UI never implies scheduling, countdowns, "live now", or open-slot counts. Row metadata is analysis facts instead: ask price, fair value, when it was valued, whether it's stale.
2. **"Analyses" and "Research" were the same noun twice.** Research is now one destination with two tabs — *Value a spot* and *Recent valuations* — and the freed nav slot became Home.
3. **Logging is the app's primary ask**, because logged breaks feed the comp set. Home leads with it and says why.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy. The task is to **recreate these designs inside the existing Next.js app** (`brodotype-dev/breakerz`, App Router, Tailwind, lucide-react), using its established patterns, components, and data layer. Do not port the HTML, the inline styles, or the `sc-if` template constructs; they are artifacts of the prototyping environment.

The prototype renders desktop and mobile side by side in one file, driven by shared state, so both shells stay in sync. In production these are two responsive breakpoints of the same routes, not two implementations.

## Fidelity

**High-fidelity.** Colors, type, spacing, and copy are final and should be matched. Two exceptions, both marked as dashed placeholders in the prototype:

- The Learn chart ("spend vs. returned value by month") is a placeholder. Use the codebase's charting approach.
- No real product imagery exists in the prototype. Card thumbnails were deliberately removed (they were gradient blocks and read as cheap).

## Design direction — what to preserve and what to avoid

This direction was arrived at by explicitly rejecting an earlier one. Reference points named by the product owner: **Stripe, Koyfin, Copilot Money**.

**Preserve:**
- Numbers carry the interface. Every figure is mono, tabular, and larger than the label above it.
- Hairline rules instead of stacked cards. Tabular data is ruled rows, not a grid of boxes.
- Signal color is *desaturated* and used as small text marks — never as filled chips or badges.
- The primary button is high-contrast neutral (near-white on dark, near-black on light). One filled element per screen, at most.
- Color identifies things (sport keys, plan tier); it does not decorate.

**Avoid — these were named as reading "cheap":**
- Glow shadows (`box-shadow: 0 0 20px rgba(...)`) — remove entirely.
- Gradient fills on thumbnails, logos, or cards.
- Saturated red/green/amber (`#22c55e`, `#dc2626`, `#f59e0b`) for verdicts.
- Blue primary buttons everywhere.
- Rounded pill chips for status.
- Card-on-card stacking; excessive boxes.

## Design tokens

Two themes. The prototype resolves them at runtime; in production these belong in the Tailwind theme / CSS custom properties.

### Dark (default)

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#101215` | app background |
| `panel` | `#14171b` | shell, device chrome |
| `subtle` | `#171b20` | inset callout background |
| `rule` | `#22262c` | section rules, table headers |
| `ruleFaint` | `#1a1e23` | row dividers |
| `ruleStrong` | `#2e343c` | secondary button borders, dashed placeholders |
| `ink` | `#e6e8ea` | primary text |
| `ink2` | `#8b9099` | secondary text |
| `ink3` | `#5f656d` | labels, metadata |
| `accent` | `#7fa8c9` | weight bars, stale markers, links |
| `buy` | `#6f9e7d` | BUY verdict, positive figures |
| `hold` | `#a89060` | HOLD verdict |
| `pass` | `#c2705f` | PASS verdict, negative figures |
| `btnBg` / `btnFg` | `#e6e8ea` / `#101215` | primary button |
| `sel` | `#1c2126` | active nav item background |
| `crown` | `#c9a227` | Pro tier mark |

### Light

| Token | Value |
| --- | --- |
| `bg` | `#fbfaf8` |
| `panel` | `#ffffff` |
| `subtle` | `#f5f4f1` |
| `rule` | `#e3e1dc` |
| `ruleFaint` | `#ededea` |
| `ruleStrong` | `#cfccc5` |
| `ink` | `#16181c` |
| `ink2` | `#5f656d` |
| `ink3` | `#8b9099` |
| `accent` | `#33628c` |
| `buy` | `#2f6b43` |
| `hold` | `#8a6a1f` |
| `pass` | `#9c2f22` |
| `btnBg` / `btnFg` | `#16181c` / `#fbfaf8` |
| `sel` | `#f0eeea` |
| `crown` | `#8a6a1f` |

### Sport keys (from `design-assets/design-system-tokens.json`)

Used as 7px dots preceding product names in tabular rows. Baseball `#3b82f6`, basketball `#f97316`, football `#22c55e`. These are the only saturated colors in the system — they are identity, not signal.

Discord row uses brand blurple `#5865F2`.

### Typography

- **UI:** Public Sans — 400 / 500 / 600 / 700.
- **Numerals and metadata:** Roboto Mono — 400 / 500.

| Role | Spec |
| --- | --- |
| Page title (desktop) | 600 27px / 1.2, letter-spacing −0.022em |
| Page title (mobile) | 600 22px / 1.2, letter-spacing −0.022em |
| Page subhead | 400 14px / 1.55, `ink2` |
| Section label | Roboto Mono 400 10px / 1, letter-spacing 0.14em, uppercase, `ink3` |
| Table header | Roboto Mono 400 10px / 1, letter-spacing 0.14em, uppercase, `ink3` |
| Row title | 500 14px / 1.35 |
| Row metadata | Roboto Mono 400 11px, `ink3` |
| Body | 400 14px / 1.55 |
| Hero figure | Roboto Mono 500 29–30px / 1, letter-spacing −0.03em |
| Stat figure | Roboto Mono 500 24px / 1, letter-spacing −0.03em |
| Verdict word | 700 25px / 1, letter-spacing 0.02em (desktop) · 21px (mobile) |
| Verdict inline mark | Roboto Mono 500 12px, lowercase (`buy` / `hold` / `pass` / `est`) |
| Primary button | 600 13px (desktop) · 600 14–16px (mobile) |
| Nav item | 600 13px |
| Mobile tab label | 600 11px |

### Spacing, radius, borders

- Section gap 26px; sub-section gap 16–22px; row padding 15px vertical.
- Desktop content padding 30px 34px 36px. Rail 196px wide, 24px 14px padding.
- Radius: 6px buttons and nav items, 7px mobile primary buttons, 8–9px callouts, 12px rounded-stroke blocks, 24–30px device chrome.
- Borders are always 1px. `border: 2px` appears nowhere.
- No shadows anywhere in the system.

## Information architecture

Four destinations. Desktop is a persistent 196px rail; mobile is a four-item bottom tab bar with the same labels and icons.

| Nav item | lucide icon | Route | Purpose |
| --- | --- | --- | --- |
| Home | `Home` | `/` | Route the user to the right job; lead with logging |
| Research | `Sparkles` | `/analysis` | Value a spot; browse recent valuations |
| Log | `ClipboardList` | `/my-breaks` | Record purchases and results |
| Learn | `TrendingUp` | (new) | Performance patterns read off the log |

Below the four, under a mono "TOOLS" label: **Slabs** (`Search`) and **Chase** (`Heart`) — secondary, `ink2`, not peer destinations.

Rail footer: plan label (mono, uppercase, `ink3`), plan detail, a 2px progress rule filled with `accent`, a Discord link in blurple, and the account row.

Log carries a count badge (`2`) in mono `ink3`. Mobile tab bar has no badges.

---

## Screens

### 1. Home — `/`

**Purpose:** answer "what should I do now" and push the user toward logging.

**Header** (all above a single `rule` divider, 20px padding-bottom):
- Mono uppercase date label: "SUNDAY · 14 SEPTEMBER"
- H1: "Start here, Kyle"
- Subhead: "BreakIQ does two jobs: tell you what a spot is worth before you buy, and remember what happened after."
- Then a horizontal prompt row, wrapping: `ClipboardList` icon + 600 15px "Log a break you bought into" · flex-1 `ink2` 13px "2 purchases are still waiting on results. Logging is what sharpens every number you see here." · filled 38px "Log now" button routing to Log.

This header treatment replaced two earlier versions (a filled white block, then a rounded stroked box). The filled block was rejected as too heavy; the header form is the chosen one. The button is the only filled element on the page.

**Body, two columns** (left flex-1 min-width 400px, right 262px fixed, 36px gap):

Left column:
- Mono "OR" label
- Two route rows, each a full-width button with bottom `ruleFaint` border, 18px vertical padding: icon in `accent` / `buy` → title 600 16px + sub 400 13px `ink2` → `ChevronRight` in `ink3`.
  - `Sparkles` "Value a spot" / "Know the fair price before you commit to a slot" → Research
  - `TrendingUp` "See your patterns" / "$3,400 saved in 30 days · 11 of 14 calls held" → Learn
- Mono "PICK UP WHERE YOU LEFT OFF" label, then two rows:
  - "Bowman Chrome · Orioles" with `accent` mono "valued 3d ago · comps moved $18" and a bordered 32px "Re-value" button
  - "Topps Chrome · Dodgers", `ink3` mono "valued 2h ago · $400 ask vs $385", `hold` mark
- Text link in `accent`: "All valuations →" → Research / Recent valuations tab

Right column:
- Mono "WHY WE ASK YOU TO LOG" + 400 14px/1.6 `ink2`: "Every logged break feeds the comp set. Your record is what turns a generic fair value into one that knows how you buy."
- Above a `rule`, three label/figure pairs: Breaks logged **14**; Awaiting results **2** (in `accent`); Valuations this month **9**.

**Mobile:** same header, then the two route rows, then the stale pickup block (mono `accent` "PICK UP · STALE 3 DAYS"), then the valuations list and the awaiting-results group.

**Empty state is not designed.** A new account has nothing to pick up and no stats, which leaves the log prompt plus two routes. Flagged and outstanding.

### 2. Research — `/analysis`

Two tabs, 22px gap, above a `rule`, active tab marked by a 2px `ink` bottom border: **Value a spot** · **Recent valuations**.

#### 2a. Value a spot

- Mono "SLOT VALUATION" · H1 "Baltimore Orioles · 2025 Bowman Chrome" · subhead "12-box hobby, pick-your-team · asking $340"
- **Verdict band:** three fields between top and bottom `rule`, 22px vertical padding, separated by vertical `rule` borders with 34px padding:
  - VERDICT → "PASS", 700 25px in `pass`
  - FAIR VALUE → "$215" mono 29px + "±$31" mono 12px `ink3`
  - PREMIUM OVER VALUE → "+58%" mono 29px in `pass` + "$125" `ink3`
- **Method table** (left, flex-1 min-width 400px) under mono "METHOD · FOUR WEIGHTED INPUTS". Four rows, top-bordered `ruleFaint`: 104px label column in 600 12px `ink2` → description 400 14px → right-aligned 72px group containing a 32px×2px weight bar (track `rule`, fill `accent`) and the mono percentage in `ink2`.

| Label | Description | Weight | Bar fill |
| --- | --- | --- | --- |
| Sold comps | 18 Orioles spots in 30 days, median $206 | 44% | 100% |
| Prospects | Basallo #14 overall, one more top-100 arm | 26% | 59% |
| Hit rate | 12-box config returns 1.4 numbered Orioles | 18% | 41% |
| Analyst note | "Orioles spots run hot on Whatnot — wait for the second pass." Kyle · 2d | 12% | 27% |

  The bar fills are proportional to the largest weight, not to 100%.

- **Actions**, 22px above: filled "Value another spot" (`Sparkles`) · bordered "Save to chase list" (`Heart`) · bordered "Log a purchase" (`ClipboardList`).
- **Right column, 272px:** mono "OTHER SPOTS, SAME PRODUCT" then three ruled rows — Atlanta Braves $210 `buy`, LA Dodgers $400 `hold`, NY Yankees $365 `pass`. Below, mono "FROM YOUR LOG" + `ink2`: "You have bought into this product twice and paid above value both times."

#### 2b. Recent valuations

- Mono "RESEARCH" · H1 "Recent valuations" · subhead "Every spot you've valued. Numbers age as comps move, so re-run before you buy." · filled "Value a spot" button (`Plus`).
- **Stale callout** (conditional on `showNextAction`): 8px radius, 1px `rule` border, `subtle` background, 16px 18px padding. Mono `accent` "STALE" · 600 16px "Bowman Chrome PYT — fair value on the Orioles spot moved $18 since you ran it" · `ink2` 13px "You've bought into this product twice and paid above value both times." · bordered "Re-value" button.
- **Valuations table**, columns: product · spot (flex-1) / ask (78px right) / value (78px right) / call (74px right). Header row bottom-bordered `rule`; body rows bottom-bordered `ruleFaint`, 15px padding. Product names prefixed with the sport-key dot; metadata line in mono `ink3`.

| Product · spot | Metadata | Ask | Value | Call |
| --- | --- | --- | --- | --- |
| 2025 Bowman Chrome · Orioles | 12-box pyt · 4 spots priced · 3d ago | $340 | $215 | pass |
| 2025 Bowman Chrome · Braves | 12-box pyt · 3d ago | $210 | $265 | buy |
| 2025 Topps Chrome · Dodgers | 8-box team · 6 spots priced · 2h ago | $400 | $385 | hold |
| 2025 Panini Prizm · Bulls | 6-box random · yesterday | $180 | $120 | pass |
| 2025 Topps Chrome Update · Yankees | pre-release · baseline estimate, comps thin | $275 | ~$240 | est |

  The pre-release row is dimmed to `ink2`, its value prefixed `~`, and its call reads `est` in `ink3` — never a verdict, since comps are too thin to support one.

- **Right column, 262px:** "AWAITING RESULTS · 2" with two ruled entries (first has a bordered "Add results" button, second is dimmed) and below, mono "THIS MONTH" + "+$410" in `buy` 26px + "saved by passing on spots above value".

### 3. Log — `/my-breaks`

- Mono "PURCHASES" · H1 "Log" · subhead "What you paid, what came out, and whether the call held up." · filled "Log a purchase" button.
- **Stat band** between rules, 44px gaps: PURCHASES **14** · SPENT **$2,840** · RETURNED **$3,105** · NET **+$265** (`buy`) · PENDING **2** (`accent`).
- **Table**, columns: purchase (flex-1) / paid / returned / our call / outcome (84px each, right-aligned).

| Purchase | Status · date | Paid | Returned | Call | Outcome |
| --- | --- | --- | --- | --- | --- |
| Topps Chrome · Braves | completed · 04 sep | $210 | $330 | buy | `Trophy` in `buy` + "held" |
| Panini Prizm · Bulls | completed · 29 aug | $180 | $95 | pass | `Trophy` in `buy` + "held" |
| Topps Series 2 · Dodgers | completed · 21 aug | $400 | $385 | hold | `Meh` in `hold` + "even" |
| Bowman Chrome · Orioles | pending · 12 sep | $340 | — | pass | bordered 28px "Add" button |

  "Call held" means the verdict matched the outcome — a PASS that would have lost money is a correct call. This is the only place the product scores itself, and it should read that way.

### 4. Learn — new surface

- Mono "PERFORMANCE" · H1 "Learn" · subhead "Where your edge actually came from, read off your own log."
- **Stat band** between rules, three groups min-width 180px: SAVED · 30 DAYS **$3,400** (`buy`) / "by passing on spots above value"; CALLS THAT HELD **11 / 14** (the "/ 14" in `ink3` at 19px) / "matched what the spot returned"; OVERPAY AVOIDED **31%** / "average on spots you walked from".
- **Left column:** mono "RETURN BY FORMAT" then three label/figure pairs each followed by a 3px track (`rule`) with a proportional fill — Baseball · pick-your-team **+18%** (72%, `buy`); Baseball · team **+6%** (40%, `buy`); Basketball · random **−24%** (55%, `pass`). Then the chart placeholder: 150px, 1px dashed `ruleStrong`, 8px radius.
- **Right column, 290px:** mono "READ OF YOUR LOG" · 400 18px/1.45 "You beat value on baseball pick-your-team and overpay on basketball randoms." · `ink2` 14px/1.6 "Your wins cluster on Bowman Chrome PYT spots under $230. Above that, the record says walk." · bordered "Value a spot" button.

### 5. Onboarding — 5 steps, mobile

Mobile-only, five sequential screens. Principle: **one real valuation before any profile question and before the paywall.** The existing multi-step wizard collapses into this.

**Step 1 — Gate.** Wordmark. H1 600 30px/1.2 "Know what a spot is worth before you buy it." Subhead "Fair market value for any break slot, from sold comps and historical returns." Two ruled consent rows: a checked 17px square (filled `btnBg`, ✓ in `btnFg`) "I'm 18 or older"; an unchecked bordered square "I agree to the terms and privacy policy" with links. Filled 50px "Start".

The only blocking screen, and it's the legally required one. Age and legal collapse together; nothing else is asked.

**Step 2 — One question.** Two-segment progress (2px rules, first `accent`). H1 "What do you buy into?" Subhead "Two answers, and only because they change what you see next." Two chip groups — SPORTS (Baseball selected, Basketball, Football, Hockey, Pokémon) and FORMATS YOU TAKE (Pick-your-team selected, Pick-your-player, Team random). Chips are 6px radius rectangles, selected = filled `btnBg`, unselected = 1px `ruleStrong` with `ink2` text. Filled "Next" plus a text "Skip — set this later".

Only the two answers that change what the user sees next. Experience level, era, spend, and referral move into the profile.

**Step 3 — Try it.** Both progress segments `accent`. Mono "TRY IT ON A REAL PRODUCT" · H1 600 23px/1.3 "2025 Bowman Chrome, 12-box pick-your-team. Which spot would you take?" Team chips (Braves selected). A ruled row: "Typical ask for that spot" / "$210" mono 21px. `ink3` note "No account yet. Real product, real sold comps behind the number." Filled "Show me the value".

Phrased as a *product* and a typical ask — not a live break, because the app has no timing data.

**Step 4 — Payoff.** Verdict band between rules: VERDICT **BUY** (`buy`) / FAIR VALUE **$265** / UNDER ASK **$55** (`buy`). Body 400 15px/1.6 "At a $210 ask the Braves spot sits $55 below value. That's the gap most people never see before they bid." Then mono "HOW WE GOT THERE" and the four method rows with weights. Filled "Keep going".

**Step 5 — Plan.** H1 "You just found $55 of edge in 20 seconds." Subhead "Both options land you on your recent analyses." Two ruled tiers, no cards: **Free** / $0 / "3 valuations a month. Logging and history stay open."; **Pro** (with `Crown` in `crown`) / $24.99/mo / "Unlimited valuations, the full source trail, chase list and slab lookup." Filled "Go Pro" plus bordered "Start free".

The paywall quotes the dollar figure the user just watched appear. Both paths land on the app — the free tier never locks logging or history, which protects the data the product depends on.

---

## Interactions & behavior

- **Nav** switches the content region; no route transitions were designed. Active rail item: `sel` background, `ink` text. Inactive: transparent, `ink2`.
- **Research tabs** are client state; active tab has a 2px `ink` bottom border.
- **Cross-surface routing:** Home's "Log now" → Log; route rows → Research and Learn; "All valuations →" → Research/Recent; "Re-value" → Research/Value; Research's "Log a purchase" and "I bought it" → Log; Learn's "Value a spot" → Research/Value; onboarding's final buttons → Home.
- **Hover states were not designed** beyond border-color lightening on secondary buttons. Apply the codebase's conventions; keep them subtle and never introduce a glow.
- **Theme** is a prototype toggle demonstrating both surfaces. Production should decide: system-preference with a user override is the likely answer.
- **Stale valuations.** A valuation older than ~3 days is marked stale and surfaces on Home and in the callout. The threshold is a guess and needs a product decision.
- **Responsive.** Desktop rail collapses to the bottom tab bar; two-column layouts stack; tables become two-line rows (title + metadata on the left, verdict mark on the right) with the ask/value pair moved into the metadata line. Every touch target is ≥32px, primary actions 44–50px.

## State

| State | Values | Notes |
| --- | --- | --- |
| Active destination | `home` \| `research` \| `log` \| `learn` | |
| Research tab | `value` \| `recent` | Resets to `value` when entering from nav |
| Theme | `Dark` \| `Light` | |
| Plan tier | `Free` \| `Pro` | Drives the rail footer: label, detail copy, progress fill (33% / 100%) |
| Stale callout visible | boolean | Prototype prop; production derives it from valuation age |
| Onboarding step | 1–5 | |

Data needed per screen: recent valuations with ask / fair value / verdict / valued-at / spots-priced / sport / lifecycle; purchases with paid / returned / verdict-at-purchase / status / date; aggregate stats (saved, call accuracy, avg overpay avoided, return by format); the four weighted method inputs with weights per valuation.

## Assets

- **Icons:** lucide-react, already a dependency. `Home`, `Sparkles`, `ClipboardList`, `TrendingUp`, `Search`, `Heart`, `ChevronRight`, `Plus`, `Crown`, `Trophy`, `Meh`. Rendered at 13–17px, `strokeWidth` 1.75. The prototype inlines equivalent SVG paths; use the real package.
- **Discord glyph:** filled brand mark, blurple `#5865F2`.
- **Wordmark:** set in Public Sans 700 15–16px, letter-spacing −0.015em. The repo's real logo component was not pulled in — use the production lockup.
- **Fonts:** Public Sans and Roboto Mono, both on Google Fonts.
- **No product imagery.** If card or box images are added later, they need a real source; the prototype's earlier gradient placeholders were removed deliberately.

## Files

| File | What it is |
| --- | --- |
| `BreakIQ Hi-Fi v2.dc.html` | **The design to build.** All four surfaces plus onboarding, desktop and mobile, both themes. |
| `tone-c.dc.html` | The tone study this direction came from — the Research screen alone, useful as a reference for the restrained treatment. |
| `tone-a.dc.html`, `tone-b.dc.html` | Rejected tone studies (warm serif analyst desk; paper broadsheet). Included for context on what was considered. |
| `BreakIQ Hi-Fi.dc.html` | Superseded first hi-fi pass. Kept only to show what was rejected — do not build from it. |
| `BreakIQ UX Rethink.dc.html` | Wireframe exploration. `2a` is the IA that was chosen; `1d` is the onboarding. |

## Open questions

1. **Home empty state** for a new account — not designed.
2. **Stale threshold** — 3 days is a placeholder.
3. **Learn** is a new surface with no repo equivalent; the metrics assume the log is populated enough to be meaningful.
4. **Theme default** — the prototype ships a toggle; production needs a decision.
5. **Chart implementation** for Learn's spend-vs-returned view.
