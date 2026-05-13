#!/usr/bin/env node
/**
 * One-shot: register the BreakIQ slash commands with Discord.
 *
 * Usage:
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *   node scripts/register-discord-commands.mjs
 *
 * Re-run any time the command schema below changes. Discord deduplicates
 * by command name within a guild, so re-registering overwrites in place.
 *
 * We register guild-scoped (not global) so the commands appear instantly
 * in your server. Global commands take up to an hour to propagate.
 */

const { DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } = process.env;

for (const [name, value] of Object.entries({ DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID })) {
  if (!value) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
}

const commands = [
  {
    name: 'insight',
    description: 'Log a market read — sentiment, asking price, hype, or risk',
    type: 1, // CHAT_INPUT
    options: [
      {
        name: 'narrative',
        description: 'Free-form: "Wemby hot after playoffs, Flagg PYP 12-15k on streams, Bowman Concan cooled"',
        type: 3, // STRING
        required: true,
        max_length: 2000,
      },
    ],
  },
  {
    name: 'break-price',
    description: 'Capture a live breaker slot ask — narrative, screenshot, or both',
    type: 1, // CHAT_INPUT
    options: [
      // Product is first so Discord prompts for it before the narrative.
      // Autocomplete-driven — type a few chars, pick from active products.
      // Optional: skipping it falls back to Claude inferring from narrative
      // (which works if the narrative names the product) or the screenshot.
      {
        name: 'product',
        description: 'Optional: pick from active products. Skips when narrative/screenshot makes the product obvious.',
        type: 3, // STRING
        required: false,
        autocomplete: true,
      },
      {
        name: 'narrative',
        description: 'Optional: "Dodgers $625 hobby Whatnot tonight" — at least one of narrative/screenshot required',
        type: 3, // STRING
        required: false,
        max_length: 500,
      },
      {
        name: 'screenshot',
        description: 'Optional: screenshot of the listing (Whatnot, Fanatics Live, eBay, etc.)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'notes',
        description: 'Optional context for Claude — "this is the BD slot, not hobby"',
        type: 3, // STRING
        required: false,
        max_length: 500,
      },
    ],
  },
];

const url = `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`Discord API ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const registered = await res.json();
console.log(`Registered ${registered.length} command(s) on guild ${DISCORD_GUILD_ID}:`);
for (const cmd of registered) {
  console.log(`  /${cmd.name} — ${cmd.description}`);
}
