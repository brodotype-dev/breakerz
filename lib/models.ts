// Central Claude model registry.
//
// One knob per task so model upgrades/rollbacks are a single edit instead of a
// grep across 9 files. The semantic split is kept so individual tasks can be
// dialed to a different tier without touching call sites.
//
// Standardized on Sonnet 5.5 (2026-11-20), up from Sonnet 4.6. Sonnet 5.5 is
// both newer and CHEAPER than what we were paying ($2/$10 vs $3/$15), so the
// upgrade costs nothing. Model IDs smoke-tested against our own key before
// this shipped.
//
// Current Anthropic lineup (verified against platform.claude.com, 2026-11-20):
//   claude-haiku-5-5   from $0.10/$0.50 per MTok — fastest; Anthropic pitches it
//                      for "classification, extraction, and routing"
//   claude-sonnet-5-5  $2/$10   per MTok — best speed+intelligence, 1M ctx
//   claude-opus-5-5    $4/$20   per MTok — long-horizon agentic work
//   claude-fable-5-2   $8/$40   per MTok — demanding reasoning
//
// HAIKU, revisited: the 2026-06-05 move off Haiku 4.5 was driven by
// associative substitution on long rosters (Russell Wilson -> Sam Darnold).
// Haiku 5.5 is a genuinely different model and is aimed squarely at our
// extraction workload, so `matcher` / `extract` are plausible candidates —
// but the structural fix for that incident (scoping the roster query to
// active-product players, PR #140) landed after, so we have never tested
// Haiku under correct conditions. Worth a side-by-side before switching;
// don't flip it blind.
//
// EFFORT is deliberately unset. These models take an `effort` parameter
// ('low' | 'medium' | 'high' | 'max', typed in our SDK) and Sonnet 5.5
// defaults to 'high' with adaptive thinking, where Sonnet 4.6 ran with
// thinking off. That makes the heavy vision parse in parseBreakPrice the
// thing to watch: one 220s attempt inside a 300s function cap. Left at
// defaults on purpose so a regression has exactly one cause; tune effort as
// a follow-up with evidence, starting with cardMatch (thousands of 128-token
// calls per re-match) if cost or latency moves.

export const MODELS = {
  /** Discord /insight + /break-price player/entity matching + extraction. */
  matcher: 'claude-sonnet-5-5',
  /** CardHedger hard-case card matching (claude tier of the ladder). */
  cardMatch: 'claude-sonnet-5-5',
  /** Break-analysis BUY/WATCH/PASS verdict (user-facing). */
  verdict: 'claude-sonnet-5-5',
  /** Structured extraction: slab/cert parse, editorial scrape, bets debrief. */
  extract: 'claude-sonnet-5-5',
  /** Conversational anchor configurator. */
  configurator: 'claude-sonnet-5-5',
} as const;
