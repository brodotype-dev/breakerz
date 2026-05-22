// Community surface constants. Centralized so we can swap URLs in one
// place when invite links rotate. If we ever need this to be runtime-
// swappable without a redeploy, move to NEXT_PUBLIC_DISCORD_INVITE_URL
// (still imported through this file so callers keep their import).

// BreakIQ Discord invite. Permanent server invite — rotate here if it
// ever expires. CTAs gate on `isDiscordInviteConfigured()` so swapping
// to an empty string hides every Discord CTA without code changes
// elsewhere.
export const DISCORD_INVITE_URL = 'https://discord.gg/qP7YBQZf';

export function isDiscordInviteConfigured(): boolean {
  return DISCORD_INVITE_URL.startsWith('https://');
}
