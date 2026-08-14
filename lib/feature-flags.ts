// Server-only cached feature-flag reader.
//
// The `feature_flags` table is admin/service-role-only. Hot engine paths
// (pricing refresh per player, break-page render) must not hit the DB per row,
// so reads are cached on a short TTL. Flips are rare — a ≤60s lag after a flip
// is acceptable and is the documented kill-switch latency.
//
// Keep this server-only: it imports supabaseAdmin. Do not import it from a
// client component.
import { supabaseAdmin } from './supabase';

const DEFAULT_TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; expires: number }>();

export async function isFeatureFlagEnabled(key: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { data } = await supabaseAdmin
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .maybeSingle();
  const value = data?.enabled === true;
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

// Single kill switch for Track A prospect-rank pricing — gates BOTH the
// weight-share bump (computeProspectAdjustment at the call sites) AND the
// rank-tiered base EV floor (computeFallbackBaseEV). See the prospect-pricing
// plan + CHANGELOG 2026-06-16.
export const PROSPECT_RANK_FLAG = 'prospect_rank_enabled';

// Compression markup — reallocate a break's flat display markup across slots
// (floor small spots, dampen big) instead of applying it uniformly. Display
// layer only; conserves each break's total. See docs/plans/2026-08-14-market-compression-markup.md.
export const COMPRESSION_MARKUP_FLAG = 'compression_markup_enabled';
