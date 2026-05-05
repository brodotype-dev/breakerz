/**
 * Source of truth for the current Privacy Policy and Terms & Conditions
 * versions. Bump these constants when the corresponding doc in
 * docs/legal/ ships a material change. The auth callback persists the
 * version a user accepted into profiles.{terms,privacy}_version, and the
 * profile page compares the stored version against these constants to
 * decide whether to surface a re-acceptance banner.
 *
 * Use ISO date strings for versions — easy to read, sorts correctly, and
 * matches the docs' "Last updated" header.
 */

export const TERMS_VERSION = '2026-05-05';
export const PRIVACY_VERSION = '2026-05-05';

export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';

/** True if the stored version matches the current published version. */
export function isCurrent(stored: string | null | undefined, current: string): boolean {
  return !!stored && stored === current;
}
