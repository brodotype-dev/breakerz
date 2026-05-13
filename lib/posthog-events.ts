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
} as const;

export type PHEvent = typeof PH_EVENTS[keyof typeof PH_EVENTS];

export const PH_PERSON_PROPS = {
  email: 'email',
  name: 'name',
  subscription_plan: 'subscription_plan',
  subscription_status: 'subscription_status',
  onboarding_completed_at: 'onboarding_completed_at',
} as const;
