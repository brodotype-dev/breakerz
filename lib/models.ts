// Central Claude model registry.
//
// One knob per task so model upgrades/rollbacks are a single edit instead of a
// grep across 9 files. Standardized on Sonnet 4.6 (2026-06-05): Haiku 4.5's
// associative-substitution errors on long rosters (the "Russell Wilson →
// Sam Darnold" incident) drove the upgrade; at our call volume the cost delta
// is immaterial and we'd rather have high confidence the matches/verdicts are
// right. The semantic split below is kept so individual tasks can be dialed to
// a different tier later without touching call sites.
//
// Current Anthropic lineup (per docs, 2026-06-05):
//   claude-haiku-4-5   $1/$5   per MTok — fastest, near-frontier, 200k ctx
//   claude-sonnet-4-6  $3/$15  per MTok — best speed+intelligence, 1M ctx
//   claude-opus-4-8    $5/$25  per MTok — most capable (overkill for extraction)

export const MODELS = {
  /** Discord /insight + /break-price player/entity matching + extraction. */
  matcher: 'claude-sonnet-4-6',
  /** CardHedger hard-case card matching (claude tier of the ladder). */
  cardMatch: 'claude-sonnet-4-6',
  /** Break-analysis BUY/WATCH/PASS verdict (user-facing). */
  verdict: 'claude-sonnet-4-6',
  /** Structured extraction: slab/cert parse, editorial scrape, bets debrief. */
  extract: 'claude-sonnet-4-6',
  /** Conversational anchor configurator. */
  configurator: 'claude-sonnet-4-6',
} as const;
