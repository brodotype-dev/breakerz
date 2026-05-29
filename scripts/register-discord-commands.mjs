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
        description: 'Optional: "Wemby hot after playoffs" — at least one of narrative/screenshot required',
        type: 3, // STRING
        required: false,
        max_length: 2000,
      },
      // Up to 5 screenshot slots — same shape as /break-price. Mobile users
      // do N gallery picks; desktop users can drag-drop into each slot.
      // Optional — fill only what you have. Use the "Capture insight"
      // message context-menu when you'd rather multi-select N images
      // on one existing Discord message; handler routes both to the same
      // multi-image parser path.
      {
        name: 'screenshot',
        description: 'Optional: screenshot (stream overlay, tweet, IG/Discord cap, news clipping)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'screenshot2',
        description: 'Optional: additional screenshot',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot3',
        description: 'Optional: additional screenshot',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot4',
        description: 'Optional: additional screenshot',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot5',
        description: 'Optional: additional screenshot',
        type: 11,
        required: false,
      },
      {
        name: 'notes',
        description: 'Optional context for Claude — "screenshot is from a DM, not public"',
        type: 3, // STRING
        required: false,
        max_length: 500,
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
      // Up to 5 screenshot slots. Discord doesn't support array-valued
      // options, so each image needs its own attachment slot. Mobile users
      // do N gallery picks (one per slot); desktop users can drag-drop into
      // each slot. Optional — fill only what you have. Use the "Capture
      // break-price" message context-menu when you'd rather multi-select N
      // images on one Discord message; handler routes both to the same
      // multi-image parser.
      {
        name: 'screenshot',
        description: 'Optional: screenshot of the listing (Whatnot, Fanatics Live, eBay, etc.)',
        type: 11, // ATTACHMENT
        required: false,
      },
      {
        name: 'screenshot2',
        description: 'Optional: additional screenshot from the same break',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot3',
        description: 'Optional: additional screenshot from the same break',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot4',
        description: 'Optional: additional screenshot from the same break',
        type: 11,
        required: false,
      },
      {
        name: 'screenshot5',
        description: 'Optional: additional screenshot from the same break',
        type: 11,
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
  // Message context-menu — long-press / right-click any message in Discord
  // and pick Apps → "Capture break-price". The handler receives the full
  // target message including all attachments (up to Discord's 10/message
  // cap, soft-capped at 5 in the handler). Use this when you want to dump
  // multiple screenshots from the same break in one gesture instead of
  // firing /break-price N times.
  //
  // Type 3 = MESSAGE context menu. Type 2 would be USER context menu. No
  // options allowed on either — the target is implied by data.target_id.
  //
  // Name notes: avoiding the slash character — MESSAGE command names
  // display as-registered and Discord silently dropped the command on
  // initial registration when the name was "Capture as /break-price",
  // suspected slash conflict with slash-command name namespace.
  //
  // No dm_permission — Discord deprecated dm_permission + default_member_permissions
  // for the contexts/integration_types pair in 2024. Mixing the old field with
  // type:3 caused the command to be silently dropped from the bulk PUT response.
  // Omitting both: Discord defaults to guild-only install (matches our use).
  {
    name: 'Capture break-price',
    type: 3,
  },
  // Sibling MESSAGE context-menu for /insight. Long-press / right-click any
  // message → Apps → "Capture insight" → handler pulls every image attachment
  // off the target message and hands them to parseInsights as one batch.
  // Same name conventions as Capture break-price: no slash character, no
  // dm_permission, no default_member_permissions (Discord defaults to
  // guild-only install, matches our use). Re-run this registrar after
  // adding it so the entry shows up in the Apps submenu.
  {
    name: 'Capture insight',
    type: 3,
  },
  // /url-source — open-ended URL ingestion (web-sourced-intel Slice 4).
  // An SME points us at any resource (beat-writer column, forum thread,
  // MLB Pipeline weekly page, YouTube transcript URL) with a scrape cadence
  // + stop date. We scrape immediately and (Slice 4b) on the chosen cadence,
  // staging pending_insights proposals each time via the same ✅/✏️/❌ flow.
  // The tracked_sources table + tracked_source_scrape source_kind keep the
  // internal "tracking" naming; the user-facing verb is /url-source.
  {
    name: 'url-source',
    description: 'Track a web URL — scrape it now + on a cadence into insight proposals',
    type: 1, // CHAT_INPUT
    options: [
      {
        name: 'url',
        description: 'The page to scrape (article, forum thread, rankings page, etc.)',
        type: 3, // STRING
        required: true,
        max_length: 1000,
      },
      {
        name: 'cadence',
        description: 'How often to re-scrape',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'One-off (scrape once)', value: 'one_off' },
          { name: 'Daily', value: 'daily' },
          { name: 'Weekly', value: 'weekly' },
          { name: 'Twice monthly (1st + 15th)', value: 'twice_monthly' },
        ],
      },
      {
        name: 'stop_after',
        description: 'When to stop tracking',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Immediately (one-off)', value: 'immediately' },
          { name: '1 month', value: '1_month' },
          { name: '3 months', value: '3_months' },
          { name: '6 months', value: '6_months' },
          { name: '1 year', value: '1_year' },
        ],
      },
      {
        name: 'scope',
        description: 'Optional hint: what is this source mostly about?',
        type: 3, // STRING
        required: false,
        choices: [
          { name: 'Player(s)', value: 'player' },
          { name: 'Product', value: 'product' },
          { name: 'Global / mixed', value: 'global' },
        ],
      },
      {
        name: 'note',
        description: 'Optional context for the parser — "this is a Royals beat column"',
        type: 3, // STRING
        required: false,
        max_length: 500,
      },
    ],
  },
  // Sibling MESSAGE context-menu for /url-source. Long-press / right-click a
  // post that contains a link → Apps → "Capture url-source" → handler pulls
  // the first URL out of the message and opens a modal for cadence +
  // stop_after (context-menu commands can't carry option dropdowns). Same
  // name conventions as the other Capture commands: no slash character.
  {
    name: 'Capture url-source',
    type: 3,
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
  // Type 3 is MESSAGE context menu — no description, no slash prefix.
  const prefix = cmd.type === 3 ? 'Apps → ' : cmd.type === 2 ? 'User → ' : '/';
  const tail = cmd.description ? ` — ${cmd.description}` : ' (context menu)';
  console.log(`  ${prefix}${cmd.name}${tail}`);
}

// Silent-drop detector. Discord's bulk PUT will return 200 with a SHORTER
// response array when a single command in the batch was rejected, instead
// of 400-ing the whole call. Almost burned us on the "Capture as /break-price"
// registration where the slash in the name silently dropped the command.
if (registered.length !== commands.length) {
  const registeredNames = new Set(registered.map(c => c.name));
  const missing = commands
    .filter(c => !registeredNames.has(c.name))
    .map(c => `${c.name} (type=${c.type ?? 1})`);
  console.error(
    `\n⚠️  Discord registered ${registered.length} of ${commands.length} commands. Missing:\n` +
    missing.map(m => `  • ${m}`).join('\n') +
    `\nLikely causes: invalid characters in name, deprecated fields (dm_permission), or name collision.`,
  );
  process.exit(2);
}
