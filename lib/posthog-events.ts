// Single source of truth for PostHog event names + person-property keys.
// Import from here at every call site so taxonomy stays consistent and is
// renameable in one place.

export const PH_EVENTS = {
  user_signed_up: 'user_signed_up',
  onboarding_completed: 'onboarding_completed',
  waitlist_signup_submitted: 'waitlist_signup_submitted',

  break_analysis_run: 'break_analysis_run',
  break_logged: 'break_logged',

  slab_analysis_lookup_completed: 'slab_analysis_lookup_completed',
  slab_analysis_cert_mismatch: 'slab_analysis_cert_mismatch',

  subscription_checkout_started: 'subscription_checkout_started',
  subscription_activated: 'subscription_activated',
  subscription_canceled: 'subscription_canceled',

  pricing_feedback_submitted: 'pricing_feedback_submitted',

  beta_banner_dismissed: 'beta_banner_dismissed',

  // Slice 2b — fires when the AI verdict prompt was enriched with recent
  // /break-price observations. Only emits when feature flag is on AND
  // ≥3 ranked observations were available. Lets us segment beta retention
  // with vs. without enrichment during the A/B window.
  verdict_observation_context_applied: 'verdict_observation_context_applied',

  // Step #3 — fires when the consumer clicks the "Use $X" pill under a
  // team row to pre-fill the ask-price input with an observed value.
  // Property bag: { product_id, team, prefilled_price, observation_count,
  // source_type }. Drives "did side-by-side comparison change behavior"
  // segmentation against the existing break_analysis_run + break_logged
  // events.
  observed_ask_prefilled: 'observed_ask_prefilled',

  // Transactional-email observability. These fire from server routes when
  // a Resend send call rejects — catches the silent-failure shape that
  // bit the 2026-04 → 2026-05 invite cohort. distinctId is the recipient
  // email for un-authenticated paths, or the user.id once we have one.
  invite_email_failed: 'invite_email_failed',
  waitlist_confirmation_email_failed: 'waitlist_confirmation_email_failed',
  welcome_email_failed: 'welcome_email_failed',
} as const;

export type PHEvent = typeof PH_EVENTS[keyof typeof PH_EVENTS];

export const PH_PERSON_PROPS = {
  email: 'email',
  name: 'name',
  subscription_plan: 'subscription_plan',
  subscription_status: 'subscription_status',
  onboarding_completed_at: 'onboarding_completed_at',
} as const;
