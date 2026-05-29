// Helpers for the /url-source tracked-source flow (web-sourced-intel Slice 4).
//
// Cadence + stop_after are stored as strings (Discord choice values). These
// helpers translate them into the timestamps the cron uses.

export type Cadence = 'one_off' | 'daily' | 'weekly' | 'twice_monthly';
export type StopAfter = 'immediately' | '1_month' | '3_months' | '6_months' | '1_year';

export const CADENCE_VALUES: Cadence[] = ['one_off', 'daily', 'weekly', 'twice_monthly'];
export const STOP_AFTER_VALUES: StopAfter[] = ['immediately', '1_month', '3_months', '6_months', '1_year'];

const DAY_MS = 86_400_000;

/**
 * Absolute stop time from a stop_after choice, measured from `from`.
 * `immediately` and any one_off effectively stop after the first scrape —
 * the caller marks status='done' in that case, so stop_at can be null.
 * Returns null for "no stop" semantics (we don't currently expose that,
 * but a missing/unknown value falls back to 3 months as a safe ceiling).
 */
export function computeStopAt(stopAfter: string, from: Date = new Date()): Date | null {
  switch (stopAfter) {
    case 'immediately':
      return from; // already-passed → cron will mark done on first pass
    case '1_month':
      return new Date(from.getTime() + 30 * DAY_MS);
    case '3_months':
      return new Date(from.getTime() + 90 * DAY_MS);
    case '6_months':
      return new Date(from.getTime() + 180 * DAY_MS);
    case '1_year':
      return new Date(from.getTime() + 365 * DAY_MS);
    default:
      return new Date(from.getTime() + 90 * DAY_MS);
  }
}

/**
 * Next scrape time for a recurring cadence, measured from `from`. Returns
 * null for one_off (no recurrence). twice_monthly approximates the 1st/15th
 * rhythm as ~15-day steps — the cron's due-check (next_scrape_at <= now)
 * tolerates drift, and we don't need exact calendar alignment.
 */
export function computeNextScrapeAt(cadence: string, from: Date = new Date()): Date | null {
  switch (cadence) {
    case 'daily':
      return new Date(from.getTime() + DAY_MS);
    case 'weekly':
      return new Date(from.getTime() + 7 * DAY_MS);
    case 'twice_monthly':
      return new Date(from.getTime() + 15 * DAY_MS);
    case 'one_off':
    default:
      return null;
  }
}

/** A source is effectively one-shot when cadence is one_off or it stops immediately. */
export function isOneShot(cadence: string, stopAfter: string): boolean {
  return cadence === 'one_off' || stopAfter === 'immediately';
}

/**
 * Human-readable schedule label for the proposal panel — shared by the
 * /url-source reply (Slice 4a) and the recurring cron's posts (Slice 4b) so
 * the "(daily · stops 6/1/2026)" line reads identically across both surfaces.
 */
export function describeSchedule(cadence: string, stopAt: Date | null): string {
  if (cadence === 'one_off') return 'one-off';
  return `${cadence}${stopAt ? ` · stops ${stopAt.toLocaleDateString('en-US')}` : ''}`;
}
