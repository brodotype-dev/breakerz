import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  verifyDiscordSignature,
  editInteractionResponse,
  InteractionType,
  InteractionResponseType,
  ComponentType,
  ButtonStyle,
  InteractionFlags,
} from '@/lib/discord';
import {
  parseInsights,
  parseBreakPrice,
  summarizeUpdate,
  type BreakPriceImage,
  type BreakPriceImageMediaType,
  type ParsedUpdate,
} from '@/lib/insights-parser';
import { deriveSourceType } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Single Discord interactions endpoint. Three things land here:
 *   - PING (Discord verifying the URL when you set it in the dashboard)
 *   - APPLICATION_COMMAND for /insight (Kyle posting a narrative)
 *   - MESSAGE_COMPONENT for ✅/❌ button clicks on the bot's reply
 *
 * Discord requires a response within 3s and signs every request. We
 * verify the Ed25519 signature on the raw body before doing anything,
 * and use after() to push slow work (Claude parse + DB writes) out of
 * the response path so the initial ack stays fast.
 */
export async function POST(req: Request) {
  const signature = req.headers.get('x-signature-ed25519') ?? '';
  const timestamp = req.headers.get('x-signature-timestamp') ?? '';
  const rawBody = await req.text();

  if (!verifyDiscordSignature(rawBody, signature, timestamp)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  // 1. PING — Discord uses this to verify the endpoint URL.
  if (interaction.type === InteractionType.PING) {
    return NextResponse.json({ type: InteractionResponseType.PONG });
  }

  // 2. Slash command
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    return handleSlashCommand(interaction);
  }

  // 3. Button click
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    return handleButton(interaction);
  }

  // 4. Autocomplete (typing into an option with autocomplete:true)
  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    return handleAutocomplete(interaction);
  }

  return NextResponse.json({ error: 'unsupported interaction' }, { status: 400 });
}

// ─── Autocomplete handler ────────────────────────────────────────────────
// Discord pings us every keystroke on an option flagged autocomplete:true.
// We have to respond within 3s with up to 25 choices. No defer — autocomplete
// doesn't support deferred responses. Keep the query lean.

interface AutocompleteInteraction {
  data: {
    name: string;
    options?: Array<{ name: string; value: string; type?: number; focused?: boolean }>;
  };
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<NextResponse> {
  if (interaction.data.name !== 'break-price') {
    return NextResponse.json({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [] },
    });
  }

  const focused = interaction.data.options?.find(o => o.focused);
  if (!focused || focused.name !== 'product') {
    return NextResponse.json({
      type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [] },
    });
  }

  const query = (focused.value ?? '').trim().toLowerCase();

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, year')
    .eq('is_active', true)
    .in('lifecycle_status', ['live', 'pre_release'])
    .order('year', { ascending: false })
    .limit(50);

  const ranked = (products ?? [])
    .map(p => ({ id: p.id, label: `${p.year} ${p.name}` }))
    .filter(p => !query || p.label.toLowerCase().includes(query))
    .slice(0, 25);

  return NextResponse.json({
    type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    data: {
      choices: ranked.map(p => ({
        // Discord requires choice name ≤ 100 chars. Year + product name is
        // comfortably under for all current products.
        name: p.label.slice(0, 100),
        value: p.id,
      })),
    },
  });
}

// ─── Allowlist check ─────────────────────────────────────────────────────

async function isAllowlisted(discordUserId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('discord_contributors')
    .select('discord_user_id')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();
  return !!data;
}

/**
 * Discord caps message `content` at 2000 chars. A `/break-price` capture from
 * an 18-team price-sheet screenshot trips that limit easily — 18 rows × ~100
 * chars per row + wrapping = >2000. Build the proposal summary defensively:
 * walk rows in order, stop when the next row would push past the budget,
 * append a "+ N more" note.
 *
 * Returns the formatted block ready to drop into the message; the caller is
 * responsible for budgeting space for any wrapping text (header / source /
 * buttons hint) and passing that subtracted from 2000.
 */
function formatProposalSummary(
  lines: string[],
  charBudget: number,
): { summary: string; hiddenCount: number } {
  const SAFETY = 60; // small cushion for the "+ N more" footer + newlines
  const effective = Math.max(0, charBudget - SAFETY);
  let used = 0;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const next = (kept.length === 0 ? 0 : 1) + lines[i].length; // +1 for \n
    if (used + next > effective) break;
    kept.push(lines[i]);
    used += next;
  }
  const hiddenCount = lines.length - kept.length;
  let summary = kept.join('\n');
  if (hiddenCount > 0) {
    summary += `\n_… and ${hiddenCount} more (full list applies on ✅)_`;
  }
  return { summary, hiddenCount };
}

/**
 * Builds the "Targets" header that surfaces which product(s) the proposed
 * updates will write to. Critical for review — multiple "2026 Bowman Baseball"
 * entries can exist in the products table, and contributors need to verify
 * Claude routed to the right one BEFORE clicking ✅. Shows full UUID so
 * admins can grep / cross-reference against the products table.
 *
 * Walks updates, dedupes by product_id, sorts by descending count so the
 * most-targeted product appears first. Updates without a product_id
 * (sentiment global, risk_flag, team_sentiment) are excluded.
 */
function buildTargetsHeader(
  updates: ParsedUpdate[],
): { header: string; lineCount: number } {
  const counts = new Map<string, { name: string; count: number }>();
  for (const u of updates) {
    const productId = (u as { product_id?: string }).product_id;
    const productName = (u as { product_name?: string }).product_name;
    if (!productId || !productName) continue;
    const entry = counts.get(productId);
    if (entry) entry.count++;
    else counts.set(productId, { name: productName, count: 1 });
  }
  if (counts.size === 0) return { header: '', lineCount: 0 };

  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  if (sorted.length === 1) {
    const [id, { name }] = sorted[0];
    return { header: `**Writing to:** ${name} \`${id}\``, lineCount: 1 };
  }
  const lines = sorted.map(
    ([id, { name, count }]) => `• ${name} \`${id}\` (${count})`,
  );
  return { header: `**Writing to:**\n${lines.join('\n')}`, lineCount: lines.length + 1 };
}

function ephemeralReply(content: string) {
  return NextResponse.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionFlags.EPHEMERAL },
  });
}

// ─── /insight handler ────────────────────────────────────────────────────

interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

interface DiscordResolvedMessage {
  id: string;
  content: string;
  attachments?: DiscordAttachment[];
}

interface SlashCommandInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  data: {
    name: string;
    // data.type: 1 = CHAT_INPUT (slash), 2 = USER context menu,
    // 3 = MESSAGE context menu. Undefined on older payload shapes — treat
    // as chat input for safety.
    type?: 1 | 2 | 3;
    // For MESSAGE context menu, the target message id. Resolved entry
    // lives under data.resolved.messages[target_id].
    target_id?: string;
    // option.type 11 is ATTACHMENT — value is the attachment id, resolved
    // via data.resolved.attachments. Other option types have string values.
    options?: Array<{ name: string; value: string; type?: number }>;
    resolved?: {
      attachments?: Record<string, DiscordAttachment>;
      messages?: Record<string, DiscordResolvedMessage>;
    };
  };
}

async function handleSlashCommand(interaction: SlashCommandInteraction): Promise<NextResponse> {
  // MESSAGE context-menu (right-click / long-press → Apps → "Capture as
  // /break-price"). data.type === 3 distinguishes it from the slash
  // command of similar purpose.
  if (interaction.data.type === 3 && interaction.data.name === 'Capture as /break-price') {
    return handleBreakPriceFromMessage(interaction);
  }
  if (interaction.data.name === 'break-price') {
    return handleBreakPrice(interaction);
  }
  if (interaction.data.name !== 'insight') {
    return ephemeralReply('Unknown command.');
  }

  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you, sorry.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply(
      'You are not on the BreakIQ contributor allowlist. Ping Brody to get added.',
    );
  }

  const narrative = interaction.data.options?.find(o => o.name === 'narrative')?.value?.trim();
  if (!narrative) return ephemeralReply('You have to include the narrative.');

  // Defer immediately so Discord doesn't time out — we have ~15 minutes
  // to follow up via the interaction token.
  after(async () => {
    try {
      const { updates, debug } = await parseInsights({ narrative });

      if (updates.length === 0) {
        // Surface why we got 0 updates so we don't have to read Vercel
        // logs to debug. The excerpt + drop reasons usually make the
        // root cause obvious (no JSON, wrong shape, unknown ids, etc).
        const excerpt = debug.rawResponseExcerpt
          .replace(/```/g, "'''")
          .slice(0, 700);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ I couldn't extract any structured updates from:\n> ${narrative.slice(0, 200)}\n\n` +
            `**Debug:** roster=${debug.rosterSize}, products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, drops=${debug.droppedReasons.length}\n` +
            (debug.droppedReasons.length > 0
              ? `**Dropped reasons:** ${debug.droppedReasons.slice(0, 5).join(' | ')}\n\n`
              : '\n') +
            `**Claude raw (first 700):**\n\`\`\`${excerpt}\`\`\``,
        });
        return;
      }

      // Stage the proposed updates so the ✅ button can apply them later.
      const { data: pending, error: pendErr } = await supabaseAdmin
        .from('pending_insights')
        .insert({
          discord_channel_id: interaction.channel_id,
          source_user_id: user.id,
          source_text: narrative,
          parsed_updates: updates as unknown as object,
        })
        .select('id')
        .single();

      if (pendErr || !pending) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Parsed ${updates.length} updates but couldn't stage them: ${pendErr?.message ?? 'unknown error'}`,
        });
        return;
      }

      const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
      const handle = user.global_name ?? user.username;
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Insight from @${handle}:**\n> ${narrative.slice(0, 240)}\n\n` +
        targetsBlock +
        `**Proposed updates (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Insight from @${handle}:**\n> ${narrative.slice(0, 240)}\n\n` +
          targetsBlock +
          `**Proposed updates (${updates.length}):**\n${summary}\n\n` +
          `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SUCCESS,
                label: 'Apply',
                custom_id: `confirm:${pending.id}`,
                emoji: { name: '✅' },
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.DANGER,
                label: 'Discard',
                custom_id: `discard:${pending.id}`,
                emoji: { name: '❌' },
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('[discord/insight] parse failed', err);
      await editInteractionResponse(interaction.application_id, interaction.token, {
        content: `⚠️ Parser error: ${err instanceof Error ? err.message : 'unknown'}`,
      }).catch(() => {});
    }
  });

  // Synchronous ack — the final reply will land via the after() block above.
  return NextResponse.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// ─── /break-price handler ────────────────────────────────────────────────
// Roadmap step #2. Structured slot-ask capture: narrative + optional
// screenshot. Claude parses both into one or more asking_price
// observations. Reuses the same pending_insights staging + ✅/❌ button
// flow as /insight, so the apply path doesn't fork.
//
// Multi-team and multi-format bundles are dropped at parse time — see
// docs/edge-cases.md.

async function handleBreakPrice(interaction: SlashCommandInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you, sorry.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply(
      'You are not on the BreakIQ contributor allowlist. Ping Brody to get added.',
    );
  }

  const options = interaction.data.options ?? [];
  const narrative = options.find(o => o.name === 'narrative')?.value?.trim();
  const notes = options.find(o => o.name === 'notes')?.value?.trim();
  const productId = options.find(o => o.name === 'product')?.value?.trim() || undefined;
  const attachmentId = options.find(o => o.name === 'screenshot')?.value;
  const attachment = attachmentId
    ? interaction.data.resolved?.attachments?.[attachmentId]
    : undefined;

  if (!narrative && !attachment) {
    return ephemeralReply('Include at least a narrative or a screenshot.');
  }

  // Defer immediately — image fetch + Claude vision call can take several
  // seconds and we only have 3s to ack.
  after(async () => {
    try {
      let imageBase64: string | undefined;
      let imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined;

      if (attachment) {
        const VALID_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
        const mt = (attachment.content_type ?? '').split(';')[0].trim();
        if (!VALID_TYPES.has(mt)) {
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `❓ Attachment type \`${mt || 'unknown'}\` isn't supported. Use PNG/JPEG/WebP/GIF.`,
          });
          return;
        }
        // Discord CDN URLs are time-bound. We need to fetch within ~24h
        // of the interaction, which we are — this runs in the same request.
        const imgRes = await fetch(attachment.url);
        if (!imgRes.ok) {
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ Couldn't fetch the screenshot (status ${imgRes.status}).`,
          });
          return;
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        // Cap at 5 MB to keep Claude payload sane. Discord allows up to
        // 25 MB for Nitro users but anything that big is screen-recording
        // territory, not a screenshot.
        if (buf.byteLength > 5 * 1024 * 1024) {
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ Screenshot is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — please re-share under 5 MB.`,
          });
          return;
        }
        imageBase64 = buf.toString('base64');
        imageMediaType = mt as typeof imageMediaType;
      }

      const { updates, debug } = await parseBreakPrice({ narrative, notes, imageBase64, imageMediaType, productId });

      if (updates.length === 0) {
        const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 500);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract a slot ask.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            `\n**Debug:** products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, hadImage=${debug.hadImage}, drops=${debug.droppedReasons.length}\n` +
            (debug.droppedReasons.length > 0
              ? `**Dropped:** ${debug.droppedReasons.slice(0, 4).join(' | ')}\n\n`
              : '\n') +
            (excerpt ? `**Claude raw (first 500):**\n\`\`\`${excerpt}\`\`\`` : ''),
        });
        return;
      }

      const { data: pending, error: pendErr } = await supabaseAdmin
        .from('pending_insights')
        .insert({
          discord_channel_id: interaction.channel_id,
          source_user_id: user.id,
          source_text: narrative ?? (attachment ? `[screenshot: ${attachment.filename}]` : ''),
          parsed_updates: updates as unknown as object,
        })
        .select('id')
        .single();

      if (pendErr || !pending) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Parsed ${updates.length} ask${updates.length === 1 ? '' : 's'} but couldn't stage them: ${pendErr?.message ?? 'unknown error'}`,
        });
        return;
      }

      const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
      const handle = user.global_name ?? user.username;
      const sourceLabel = narrative
        ? `> ${narrative.slice(0, 240)}${attachment ? ` _(+ screenshot)_` : ''}`
        : `_(screenshot only: ${attachment?.filename})_`;
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Slot ask from @${handle}:**\n${sourceLabel}\n\n` +
        targetsBlock +
        `**Proposed (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ❌ to discard.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Slot ask from @${handle}:**\n${sourceLabel}\n\n` +
          targetsBlock +
          `**Proposed (${updates.length}):**\n${summary}\n\n` +
          `Click ✅ to apply, ❌ to discard.`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SUCCESS,
                label: 'Apply',
                custom_id: `confirm:${pending.id}`,
                emoji: { name: '✅' },
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.DANGER,
                label: 'Discard',
                custom_id: `discard:${pending.id}`,
                emoji: { name: '❌' },
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('[discord/break-price] parse failed', err);
      await editInteractionResponse(interaction.application_id, interaction.token, {
        content: `⚠️ Parser error: ${err instanceof Error ? err.message : 'unknown'}`,
      }).catch(() => {});
    }
  });

  return NextResponse.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// ─── /break-price message context-menu handler ──────────────────────────
// Triggered when an allowlisted contributor long-presses (mobile) or
// right-clicks (desktop) any message in Discord and picks
// Apps → "Capture as /break-price". Receives the full target message,
// pulls every image attachment on it (soft-capped at 5), and hands
// them to parseBreakPrice as a single batch. The N-screenshot use case
// previously required N separate /break-price invocations.
//
// Lives next to handleBreakPrice because it is the same /break-price
// pipeline downstream — same parser, same allowlist, same
// pending_insights staging, same ✅/❌ buttons.

const CONTEXT_MENU_IMAGE_CAP = 5;
const PER_IMAGE_BYTE_CAP = 5 * 1024 * 1024;
const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

async function handleBreakPriceFromMessage(interaction: SlashCommandInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you, sorry.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply(
      'You are not on the BreakIQ contributor allowlist. Ping Brody to get added.',
    );
  }

  const targetId = interaction.data.target_id;
  const target = targetId ? interaction.data.resolved?.messages?.[targetId] : undefined;
  if (!target) {
    return ephemeralReply('Discord didn\'t send the target message. Try again, or fire `/break-price` directly.');
  }

  const allAttachments = target.attachments ?? [];
  const imageAttachments = allAttachments.filter(a => {
    const mt = (a.content_type ?? '').split(';')[0].trim();
    return VALID_IMAGE_TYPES.has(mt);
  });

  if (imageAttachments.length === 0) {
    return ephemeralReply('No image attachments on that message. Attach screenshots (PNG/JPEG/WebP/GIF) and try again.');
  }

  if (imageAttachments.length > CONTEXT_MENU_IMAGE_CAP) {
    return ephemeralReply(
      `Pick a message with ≤${CONTEXT_MENU_IMAGE_CAP} screenshots — found ${imageAttachments.length}. Bigger batches risk truncation in the proposal preview.`,
    );
  }

  const narrative = target.content?.trim() || undefined;

  after(async () => {
    try {
      // Parallel fetch. One bad image is reported by index and aborts
      // the parse — keeps the proposal honest rather than partial.
      const fetched = await Promise.all(
        imageAttachments.map(async (a, idx) => {
          const mt = (a.content_type ?? '').split(';')[0].trim() as BreakPriceImageMediaType;
          const res = await fetch(a.url);
          if (!res.ok) {
            return { ok: false as const, idx, error: `status ${res.status} on ${a.filename}` };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > PER_IMAGE_BYTE_CAP) {
            return {
              ok: false as const,
              idx,
              error: `${a.filename} is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB (cap 5 MB)`,
            };
          }
          return { ok: true as const, idx, base64: buf.toString('base64'), mediaType: mt };
        }),
      );

      const failed = fetched.filter((f): f is { ok: false; idx: number; error: string } => !f.ok);
      if (failed.length > 0) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Couldn't load ${failed.length} of ${imageAttachments.length} screenshots:\n` +
            failed.map(f => `  • image ${f.idx + 1}: ${f.error}`).join('\n'),
        });
        return;
      }

      const images: BreakPriceImage[] = fetched
        .filter((f): f is { ok: true; idx: number; base64: string; mediaType: BreakPriceImageMediaType } => f.ok)
        .map(f => ({ base64: f.base64, mediaType: f.mediaType }));

      const { updates, debug } = await parseBreakPrice({ narrative, images });

      if (updates.length === 0) {
        const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 500);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract a slot ask from ${images.length} screenshot${images.length === 1 ? '' : 's'}.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            `\n**Debug:** products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, drops=${debug.droppedReasons.length}\n` +
            (debug.droppedReasons.length > 0
              ? `**Dropped:** ${debug.droppedReasons.slice(0, 4).join(' | ')}\n\n`
              : '\n') +
            (excerpt ? `**Claude raw (first 500):**\n\`\`\`${excerpt}\`\`\`` : ''),
        });
        return;
      }

      const { data: pending, error: pendErr } = await supabaseAdmin
        .from('pending_insights')
        .insert({
          discord_channel_id: interaction.channel_id,
          source_user_id: user.id,
          source_text:
            narrative ??
            `[message context menu: ${imageAttachments.length} screenshot${imageAttachments.length === 1 ? '' : 's'}]`,
          parsed_updates: updates as unknown as object,
        })
        .select('id')
        .single();

      if (pendErr || !pending) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Parsed ${updates.length} ask${updates.length === 1 ? '' : 's'} but couldn't stage them: ${pendErr?.message ?? 'unknown error'}`,
        });
        return;
      }

      const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
      const handle = user.global_name ?? user.username;
      const imageNote = `_(message context menu · ${imageAttachments.length} screenshot${imageAttachments.length === 1 ? '' : 's'})_`;
      const sourceLabel = narrative ? `> ${narrative.slice(0, 240)}\n${imageNote}` : imageNote;
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Slot ask from @${handle}:**\n${sourceLabel}\n\n` +
        targetsBlock +
        `**Proposed (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ❌ to discard.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Slot ask from @${handle}:**\n${sourceLabel}\n\n` +
          targetsBlock +
          `**Proposed (${updates.length}):**\n${summary}\n\n` +
          `Click ✅ to apply, ❌ to discard.`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SUCCESS,
                label: 'Apply',
                custom_id: `confirm:${pending.id}`,
                emoji: { name: '✅' },
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.DANGER,
                label: 'Discard',
                custom_id: `discard:${pending.id}`,
                emoji: { name: '❌' },
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('[discord/break-price-ctx] parse failed', err);
      await editInteractionResponse(interaction.application_id, interaction.token, {
        content: `⚠️ Parser error: ${err instanceof Error ? err.message : 'unknown'}`,
      }).catch(() => {});
    }
  });

  return NextResponse.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// ─── Button handler ──────────────────────────────────────────────────────

interface ButtonInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  message: { content: string };
  data: { custom_id: string };
}

async function handleButton(interaction: ButtonInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply('You are not on the BreakIQ contributor allowlist.');
  }

  const [action, pendingId] = interaction.data.custom_id.split(':');

  // Race-safe lookup — only resolve if still pending. If two people click
  // ✅ at the same time, the second one gets a friendly "already resolved".
  const { data: pending } = await supabaseAdmin
    .from('pending_insights')
    .select('id, source_text, parsed_updates, status, source_user_id')
    .eq('id', pendingId)
    .maybeSingle();

  if (!pending) {
    return ephemeralReply('That insight expired or was already resolved.');
  }
  if (pending.status !== 'pending') {
    return ephemeralReply(`That insight was already ${pending.status}.`);
  }

  // Both buttons defer their response — applyUpdates can take more than
  // Discord's 3s budget when a sentiment update fans out to many
  // player_products. Discard is fast in practice but still defer for
  // symmetry; the user-visible behavior is identical.
  const handle = user.global_name ?? user.username;
  const baseContent = interaction.message.content;

  if (action === 'discard') {
    after(async () => {
      await supabaseAdmin
        .from('pending_insights')
        .update({ status: 'discarded', resolved_at: new Date().toISOString() })
        .eq('id', pendingId)
        .eq('status', 'pending');

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content: `${baseContent}\n\n— ❌ **Discarded** by @${handle}`,
        components: [],
      });
    });

    return NextResponse.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  if (action === 'confirm') {
    const updates = pending.parsed_updates as ParsedUpdate[];

    after(async () => {
      try {
        const result = await applyUpdates({
          pendingId: pending.id,
          sourceUserId: user.id,
          sourceText: pending.source_text,
          updates,
        });

        await supabaseAdmin
          .from('pending_insights')
          .update({ status: 'applied', resolved_at: new Date().toISOString() })
          .eq('id', pendingId)
          .eq('status', 'pending');

        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `${baseContent}\n\n— ✅ **Applied** by @${handle}: ` +
            `${result.applied} of ${updates.length} updates committed.` +
            (result.errors.length > 0 ? `\nErrors: ${result.errors.slice(0, 3).join('; ')}` : ''),
          components: [],
        });
      } catch (err) {
        console.error('[discord/confirm] apply failed', err);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `${baseContent}\n\n— ⚠️ **Apply failed** by @${handle}: ${err instanceof Error ? err.message : 'unknown'}`,
          components: [],
        }).catch(() => {});
      }
    });

    return NextResponse.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  return ephemeralReply('Unknown button.');
}

// ─── Apply staged updates ────────────────────────────────────────────────

interface ApplyResult {
  applied: number;
  errors: string[];
}

async function applyUpdates(args: {
  pendingId: string;
  sourceUserId: string;
  sourceText: string;
  updates: ParsedUpdate[];
}): Promise<ApplyResult> {
  let applied = 0;
  const errors: string[] = [];

  for (const u of args.updates) {
    try {
      switch (u.kind) {
        case 'sentiment': {
          // 'global' fans the score across every player_product for the player
          // (default for general player narrative). 'product' targets only the
          // matching (player, product) so a product-specific read like "Wemby
          // in Topps Chrome 2024 is wild" doesn't bleed across SKUs.
          const isProductScope = u.scope === 'product' && !!u.product_id;

          // Resolve the specific player_product_id for product-scoped history.
          // Null when global — sentiment_history.player_product_id is already
          // nullable; null = "this change applied to all of the player's
          // product entries."
          let scopedPpId: string | null = null;
          if (isProductScope) {
            const { data: pp } = await supabaseAdmin
              .from('player_products')
              .select('id, breakerz_score, breakerz_note')
              .eq('player_id', u.player_id)
              .eq('product_id', u.product_id!)
              .maybeSingle();
            if (!pp) throw new Error('no player_product for (player, product) — sentiment scope=product cannot apply');
            scopedPpId = pp.id;
          }

          let priorQuery = supabaseAdmin
            .from('player_products')
            .select('breakerz_score, breakerz_note')
            .eq('player_id', u.player_id);
          if (isProductScope) priorQuery = priorQuery.eq('product_id', u.product_id!);
          const { data: priors } = await priorQuery.limit(1);
          const prevScore = priors?.[0]?.breakerz_score ?? null;
          const prevNote = priors?.[0]?.breakerz_note ?? null;

          let updateQuery = supabaseAdmin
            .from('player_products')
            .update({
              breakerz_score: u.score,
              breakerz_note: u.note || null,
            })
            .eq('player_id', u.player_id);
          if (isProductScope) updateQuery = updateQuery.eq('product_id', u.product_id!);
          const { error } = await updateQuery;
          if (error) throw error;

          // Append-only history row so we can analyze how each contributor's
          // read on a player evolves over time, even when scores are revised.
          await supabaseAdmin.from('breakerz_sentiment_history').insert({
            player_id: u.player_id,
            player_product_id: scopedPpId,  // null = global fan-out, set = product-scoped
            prev_score: prevScore,
            new_score: u.score,
            prev_note: prevNote,
            new_note: u.note || null,
            source: 'discord',
            source_pending_id: args.pendingId,
            source_user_id: args.sourceUserId,
            source_narrative: args.sourceText,
            confidence: u.confidence,
          });

          applied++;
          break;
        }
        case 'risk_flag': {
          // player_risk_flags rows are scoped to player_product, so we
          // create one per player_product the player appears in. Each row
          // gets full source attribution so the same downstream analytics
          // queries that work on market_observations work here too.
          const { data: pps } = await supabaseAdmin
            .from('player_products')
            .select('id')
            .eq('player_id', u.player_id);

          if (!pps?.length) throw new Error('no player_products for this player');

          const rows = pps.map(pp => ({
            player_product_id: pp.id,
            flag_type: u.flag_type,
            note: u.note,
            source_pending_id: args.pendingId,
            source_user_id: args.sourceUserId,
            source_narrative: args.sourceText,
            confidence: u.confidence,
          }));
          const { error } = await supabaseAdmin.from('player_risk_flags').insert(rows);
          if (error) throw error;
          applied++;
          break;
        }
        case 'asking_price':
        case 'hype_tag':
        case 'odds_observation': {
          // Variant scope is captured today as free-text variant_name in the
          // payload; variant_id resolution is deferred until engine reads
          // land (Phase 3). For now we store scope_id=null when scope='variant'
          // and let analysts query payload->>'variant_name' directly.
          const payload =
            u.kind === 'asking_price'
              ? {
                  composition: u.composition,
                  source_type: deriveSourceType(u.source),
                  price_low: u.price_low,
                  price_high: u.price_high,
                  source: u.source,
                  ...(u.scope_type === 'variant' && u.variant_name
                    ? { variant_name: u.variant_name }
                    : {}),
                }
              : u.kind === 'hype_tag'
                ? {
                    tag: u.tag,
                    strength: u.strength,
                    decay_days: u.decay_days,
                    ...(u.scope_type === 'variant' && u.variant_name
                      ? { variant_name: u.variant_name }
                      : {}),
                  }
                : {
                    composition: u.composition,
                    source_type: deriveSourceType(u.source),
                    observed_odds_per_case: u.observed_odds_per_case,
                    source: u.source,
                    ...(u.scope_type === 'variant' && u.variant_name
                      ? { variant_name: u.variant_name }
                      : {}),
                  };

          // Asking-price + odds default 14d, hype rolls off with its own decay.
          const expiresAt = new Date(
            Date.now() +
              (u.kind === 'hype_tag'
                ? Math.max(1, u.decay_days) * 24 * 3600 * 1000
                : 14 * 24 * 3600 * 1000),
          ).toISOString();

          // Roll variant scope up to the player for scope_id (player_id) so
          // queries that filter by player still match variant-scope rows.
          const scopeId =
            (u.kind === 'asking_price' || u.kind === 'hype_tag') && u.scope_type === 'team'
              ? null
              : (u as { scope_player_id?: string }).scope_player_id ?? null;

          const { error } = await supabaseAdmin.from('market_observations').insert({
            observation_type: u.kind,
            scope_type: u.scope_type,
            scope_id: scopeId,
            scope_team: (u.kind === 'asking_price' || u.kind === 'hype_tag') && u.scope_type === 'team' ? u.scope_team : null,
            product_id: u.product_id,
            payload,
            source_pending_id: args.pendingId,
            source_user_id: args.sourceUserId,
            source_narrative: args.sourceText,
            confidence: u.confidence,
            expires_at: expiresAt,
          });
          if (error) throw error;
          applied++;
          break;
        }
        case 'team_sentiment':
        case 'product_sentiment':
        case 'team_product_sentiment': {
          // Track B cascade sentiment. Three shapes, one write path — the
          // discriminator is observation_type, with scope_type + scope_team
          // + product_id filling in based on which scope this is.
          const payload: Record<string, unknown> = {
            direction: u.direction,
            strength: u.strength,
            decay_days: u.decay_days,
          };
          if (u.tag) payload.tag = u.tag;

          const expiresAt = new Date(
            Date.now() + Math.max(1, u.decay_days) * 24 * 3600 * 1000,
          ).toISOString();

          const isTeamScoped =
            u.kind === 'team_sentiment' || u.kind === 'team_product_sentiment';
          const isProductScoped =
            u.kind === 'product_sentiment' || u.kind === 'team_product_sentiment';

          const { error } = await supabaseAdmin.from('market_observations').insert({
            observation_type: u.kind,
            // scope_type matches the dominant axis — 'team' for the two
            // team-scoped kinds, 'product' for product_sentiment. Cascade
            // reader keys off observation_type for cap selection so this
            // value is mostly informational, but we keep it consistent with
            // hype_tag's conventions for any future joined queries.
            scope_type: isTeamScoped ? 'team' : 'product',
            scope_id: null,
            scope_team: isTeamScoped ? (u as { team_name: string }).team_name : null,
            product_id: isProductScoped ? (u as { product_id: string }).product_id : null,
            payload,
            source_pending_id: args.pendingId,
            source_user_id: args.sourceUserId,
            source_narrative: args.sourceText,
            confidence: u.confidence,
            expires_at: expiresAt,
          });
          if (error) throw error;
          applied++;
          break;
        }
      }
    } catch (err) {
      errors.push(`${u.kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, errors };
}
