import { supabaseAdmin } from '@/lib/supabase';
import { isFeatureFlagEnabled } from '@/lib/feature-flags';

// Private-beta switch — toggle via SQL (feature_flags.private_beta_unlimited),
// no deploy. While ON, every user gets unlimited analyses / slab lookups /
// break logging (gates on /api/analysis, /api/card-lookup, /api/my-breaks all
// flow through checkAndIncrementUsage). Rationale (Brody, 2026-06): with this
// few users we need DATA more than revenue. Not forever — flip off when ready.
// The actual usage DATA (break records, analysis runs, PostHog events) is
// captured independently, so bypassing the counter loses no signal.
export const PRIVATE_BETA_UNLIMITED_FLAG = 'private_beta_unlimited';

interface UsageResult {
  allowed: boolean;
  remaining: number | null; // null = unlimited
  plan: string;
  upgrade?: boolean;
}

// Free-tier lifetime allowance. Bumped 3 → 5 on 2026-05-20 for private beta
// breathing room. Exported so consumer-facing copy in /subscribe (and any
// future "X analyses left" UI) stays in lockstep with the gate.
export const FREE_TIER_ANALYSIS_LIMIT = 5;

const LIMITS: Record<string, number> = {
  free: FREE_TIER_ANALYSIS_LIMIT, // lifetime (not monthly)
  hobby: 10,                      // per billing period
  // pro: unlimited
};

export async function checkAndIncrementUsage(userId: string): Promise<UsageResult> {
  // Private-beta unlimited: short-circuit before any plan/limit logic. Flip
  // off via the feature flag to restore paid tiers.
  if (await isFeatureFlagEnabled(PRIVATE_BETA_UNLIMITED_FLAG)) {
    return { allowed: true, remaining: null, plan: 'beta' };
  }

  // Admin/contributor users always have unlimited access
  const { data: roles } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  if (roles && roles.length > 0) {
    return { allowed: true, remaining: null, plan: 'admin' };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('subscription_plan, subscription_status, analyses_used, analyses_reset_at, current_period_end')
    .eq('id', userId)
    .single();

  if (!profile) return { allowed: false, remaining: 0, plan: 'free', upgrade: true };

  const plan = profile.subscription_plan ?? 'free';
  const status = profile.subscription_status ?? 'active';

  // Canceled or past_due — treat as free
  const effectivePlan = (status === 'active' || status === 'trialing') ? plan : 'free';

  // Pro = unlimited
  if (effectivePlan === 'pro') {
    await supabaseAdmin
      .from('profiles')
      .update({ analyses_used: (profile.analyses_used ?? 0) + 1 })
      .eq('id', userId);
    return { allowed: true, remaining: null, plan: 'pro' };
  }

  // Hobby — check if we need to reset the counter (new billing period)
  if (effectivePlan === 'hobby' && profile.current_period_end) {
    const resetAt = new Date(profile.analyses_reset_at ?? 0);
    const periodEnd = new Date(profile.current_period_end);
    // If reset_at is before period_end minus ~30 days, the counter is from a previous period
    // Simpler: if reset_at is more than 30 days old, reset
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (resetAt < thirtyDaysAgo) {
      await supabaseAdmin
        .from('profiles')
        .update({ analyses_used: 0, analyses_reset_at: new Date().toISOString() })
        .eq('id', userId);
      profile.analyses_used = 0;
    }
  }

  const limit = LIMITS[effectivePlan] ?? FREE_TIER_ANALYSIS_LIMIT;
  const used = profile.analyses_used ?? 0;

  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      plan: effectivePlan,
      upgrade: true,
    };
  }

  // Increment
  await supabaseAdmin
    .from('profiles')
    .update({ analyses_used: used + 1 })
    .eq('id', userId);

  return {
    allowed: true,
    remaining: limit - used - 1,
    plan: effectivePlan,
  };
}
