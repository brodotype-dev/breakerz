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
