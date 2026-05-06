/**
 * Source of truth for the current Privacy Policy and Terms & Conditions
 * versions. Bump these constants when the corresponding doc in
 * docs/legal/ ships a material change. The auth callback persists the
 * version a user accepted into profiles.{terms,privacy}_version, and the
 * profile page compares the stored version against these constants to
 * decide whether to surface a re-acceptance banner.
 *
 * Versioning scheme: counsel-issued semantic version (e.g. v5.1) so the
 * code matches the version number on the lawyer's working copy. The
 * "Last updated" date inside each doc is the effective date.
 */

export const TERMS_VERSION = 'v5.1';
export const PRIVACY_VERSION = 'v5.1';

export const TERMS_PATH = '/terms';
export const PRIVACY_PATH = '/privacy';

/** True if the stored version matches the current published version. */
export function isCurrent(stored: string | null | undefined, current: string): boolean {
  return !!stored && stored === current;
}
