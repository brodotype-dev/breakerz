// Community surface constants. Centralized so we can swap URLs in one
// place when invite links rotate. If we ever need this to be runtime-
// swappable without a redeploy, move to NEXT_PUBLIC_DISCORD_INVITE_URL
// (still imported through this file so callers keep their import).

// TODO(brody): replace with the real https://discord.gg/<slug> invite
// URL when Brody pastes it. CTAs gate on `isDiscordInviteConfigured()`
// so if this stays as a placeholder the UI hides itself.
export const DISCORD_INVITE_URL = '';

export function isDiscordInviteConfigured(): boolean {
  return DISCORD_INVITE_URL.startsWith('https://');
}
