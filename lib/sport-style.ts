/**
 * Sport identity colors — the single source of truth.
 *
 * Muted 2026-09-27 (Brody): the original Tailwind-default brights (lime
 * #22c55e, orange #f97316, blue #3b82f6) were picked for a dark app and shout
 * on the light theme. The family is now anchored on Eagles Midnight Green and
 * every sibling is pulled to the same depth so no one sport dominates.
 *
 * LITERAL HEX ON PURPOSE: callers append alpha suffixes to these strings
 * (`sportPrimary + '40'` in PreReleaseLayout, `${primary}20` in ProductCard).
 * A `var(--token)` reference can't take a suffix — it yields invalid CSS that
 * silently renders as no color, which is exactly the bug this replaced in
 * ProductCard. `--sport-*` in globals.css mirrors these values for CSS-only
 * consumers (admin sport dots); keep the two in sync.
 */

export type SportKey = 'baseball' | 'basketball' | 'football' | 'default';

export const SPORT_COLORS: Record<SportKey, { primary: string; secondary: string }> = {
  football:   { primary: '#004c54', secondary: '#00343a' }, // Eagles Midnight Green
  baseball:   { primary: '#1d3557', secondary: '#142944' }, // deep navy
  basketball: { primary: '#9e4a24', secondary: '#7a3519' }, // burnt clay
  default:    { primary: '#33506b', secondary: '#24394d' }, // slate blue (hockey + anything new)
};

export function getSportKey(sportName: string | null | undefined): SportKey {
  const s = (sportName ?? '').toLowerCase();
  if (s === 'football') return 'football';
  if (s === 'basketball') return 'basketball';
  if (s === 'baseball') return 'baseball';
  return 'default';
}

/**
 * `gradient` stays a gradient (Brody's call) but within a single hue — a
 * narrow step to a deeper shade of the same color rather than the old
 * cross-hue ramp (lime → emerald, orange → red, blue → purple).
 */
export function getSportStyle(sportName: string | null | undefined): {
  primary: string;
  secondary: string;
  gradient: string;
} {
  const { primary, secondary } = SPORT_COLORS[getSportKey(sportName)];
  return {
    primary,
    secondary,
    gradient: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
  };
}
