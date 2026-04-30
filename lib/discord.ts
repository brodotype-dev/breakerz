/**
 * Discord helpers — interaction signature verification + REST shortcuts.
 *
 * Signature verification uses Node's built-in crypto for Ed25519 (no
 * extra deps). Discord ships the public key in raw 32-byte hex; we wrap
 * it in the SubjectPublicKeyInfo DER prefix so `crypto.createPublicKey`
 * accepts it. The signing input is `timestamp + raw body`.
 */

import { createPublicKey, verify } from 'node:crypto';

const ED25519_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DISCORD_API = 'https://discord.com/api/v10';

let cachedPublicKey: ReturnType<typeof createPublicKey> | null = null;

function getDiscordPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const hex = process.env.DISCORD_PUBLIC_KEY;
  if (!hex) throw new Error('DISCORD_PUBLIC_KEY env var not set');
  cachedPublicKey = createPublicKey({
    key: Buffer.concat([ED25519_DER_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  return cachedPublicKey;
}

/**
 * Verify a Discord webhook signature. The route handler must pass the
 * raw request body (not parsed JSON) so the bytes match exactly what
 * Discord signed.
 */
export function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
): boolean {
  if (!signatureHex || !timestamp) return false;
  try {
    const message = Buffer.from(timestamp + rawBody);
    const signature = Buffer.from(signatureHex, 'hex');
    return verify(null, message, getDiscordPublicKey(), signature);
  } catch {
    return false;
  }
}

// ─── Interaction response types ──────────────────────────────────────────

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
} as const;

export const InteractionFlags = {
  EPHEMERAL: 1 << 6, // 64
} as const;

// ─── REST helpers ────────────────────────────────────────────────────────

function botToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN env var not set');
  return token;
}

async function discordFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res;
}

/**
 * Edit the original interaction response (used when we deferred and want
 * to replace the loading state with the parsed proposal). Discord scopes
 * this by application_id + interaction token.
 */
export async function editInteractionResponse(
  applicationId: string,
  interactionToken: string,
  body: Record<string, unknown>,
) {
  return discordFetch(
    `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

/**
 * Edit any message in a channel (used when a button click confirms or
 * discards a pending insight — we update the original bot message to
 * show the resolved state and remove the buttons).
 */
export async function editChannelMessage(
  channelId: string,
  messageId: string,
  body: Record<string, unknown>,
) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
