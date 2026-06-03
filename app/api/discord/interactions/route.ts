import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  verifyDiscordSignature,
  editInteractionResponse,
  editChannelMessage,
  InteractionType,
  InteractionResponseType,
  ComponentType,
  ButtonStyle,
  TextInputStyle,
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
import { scrapeEditorial } from '@/lib/scrapers/editorial';
import { detectGoogleSheet, fetchGoogleSheetXlsx } from '@/lib/google-sheets';
import { xlsxBufferToMarkdown, csvTextToMarkdown, formatTabularSourceLabel } from '@/lib/tabular-extract';
import {
  computeStopAt,
  computeNextScrapeAt,
  isOneShot,
  describeSchedule,
  CADENCE_VALUES,
  STOP_AFTER_VALUES,
  type Cadence,
  type StopAfter,
} from '@/lib/tracked-sources';
import {
  formatProposalSummary,
  buildTargetsHeader,
  scrapeAndStageProposal,
} from '@/lib/tracked-source-proposal';

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

  // 5. Modal submit — routed by custom_id. The Refine button opens
  //    `refine_modal:*`; the "Capture url-source" context menu opens
  //    `url_source_modal`.
  if (interaction.type === InteractionType.MODAL_SUBMIT) {
    const modalId = interaction.data?.custom_id ?? '';
    if (modalId === 'url_source_modal') {
      return handleUrlSourceModalSubmit(interaction);
    }
    return handleRefineModalSubmit(interaction);
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
  // MESSAGE context-menu (right-click / long-press → Apps → "Capture
  // break-price" / "Capture insight"). data.type === 3 distinguishes
  // these from the slash commands of similar purpose. Names kept slash-
  // free because Discord silently dropped "Capture as /break-price" from
  // the bulk command PUT on initial registration.
  if (interaction.data.type === 3) {
    if (interaction.data.name === 'Capture break-price') {
      return handleBreakPriceFromMessage(interaction);
    }
    if (interaction.data.name === 'Capture insight') {
      return handleInsightFromMessage(interaction);
    }
    if (interaction.data.name === 'Capture url-source') {
      return handleUrlSourceFromMessage(interaction);
    }
    return ephemeralReply('Unknown command.');
  }
  if (interaction.data.name === 'break-price') {
    return handleBreakPrice(interaction);
  }
  if (interaction.data.name === 'insight') {
    return handleInsight(interaction);
  }
  if (interaction.data.name === 'url-source') {
    return handleUrlSource(interaction);
  }
  return ephemeralReply('Unknown command.');
}

// ─── /insight slash command handler ──────────────────────────────────────
// Free-form market debrief → parseInsights → ✅/✏️/❌ proposal panel.
// As of 2026-05-26, /insight accepts up to 5 screenshot attachments + an
// optional notes string, mirroring /break-price exactly. At least one of
// narrative / screenshot is required (Discord can't express that as a
// schema constraint, so the handler validates).
async function handleInsight(interaction: SlashCommandInteraction): Promise<NextResponse> {
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

  // Collect every present screenshot slot. The registrar exposes 5 numbered
  // slots; users fill what they have. Order is preserved (slot 1 → slot 5)
  // so Claude sees images in user-intended order.
  const SCREENSHOT_OPTION_NAMES = ['screenshot', 'screenshot2', 'screenshot3', 'screenshot4', 'screenshot5'];
  const attachments = SCREENSHOT_OPTION_NAMES
    .map(name => {
      const id = options.find(o => o.name === name)?.value;
      return id ? interaction.data.resolved?.attachments?.[id] : undefined;
    })
    .filter((a): a is DiscordAttachment => !!a);

  if (!narrative && attachments.length === 0) {
    return ephemeralReply('Include at least a narrative or a screenshot.');
  }

  // Defer immediately so Discord doesn't time out — we have ~15 minutes
  // to follow up via the interaction token.
  after(async () => {
    try {
      // Parallel fetch + per-image magic-byte sniff. Same pattern as
      // handleBreakPrice — Discord (especially iOS) routinely mis-labels
      // PNGs as JPEGs in content_type, which Claude's vision endpoint
      // rejects with a 400. Trust the bytes.
      const fetched = await Promise.all(
        attachments.map(async (a, idx) => {
          const declaredMt = (a.content_type ?? '').split(';')[0].trim();
          if (declaredMt && !VALID_IMAGE_TYPES.has(declaredMt)) {
            return { ok: false as const, idx, error: `slot ${idx + 1}: type \`${declaredMt}\` isn't supported` };
          }
          const res = await fetch(a.url);
          if (!res.ok) {
            return { ok: false as const, idx, error: `slot ${idx + 1}: fetch status ${res.status}` };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > PER_IMAGE_BYTE_CAP) {
            return {
              ok: false as const,
              idx,
              error: `slot ${idx + 1}: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 5 MB cap`,
            };
          }
          const sniffed = sniffImageMediaType(buf);
          if (!sniffed) {
            return {
              ok: false as const,
              idx,
              error: `slot ${idx + 1}: couldn't identify image format from bytes (re-save as PNG/JPEG)`,
            };
          }
          return { ok: true as const, idx, base64: buf.toString('base64'), mediaType: sniffed };
        }),
      );

      const failed = fetched.filter((f): f is { ok: false; idx: number; error: string } => !f.ok);
      if (failed.length > 0) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Couldn't load ${failed.length} of ${attachments.length} screenshot${attachments.length === 1 ? '' : 's'}:\n` +
            failed.map(f => `  • ${f.error}`).join('\n'),
        });
        return;
      }

      const images: BreakPriceImage[] = fetched
        .filter((f): f is { ok: true; idx: number; base64: string; mediaType: BreakPriceImageMediaType } => f.ok)
        .map(f => ({ base64: f.base64, mediaType: f.mediaType }));

      const { updates, debug } = await parseInsights({ narrative, notes, images });

      if (updates.length === 0) {
        // Surface why we got 0 updates so we don't have to read Vercel
        // logs to debug. The excerpt + drop reasons usually make the
        // root cause obvious (no JSON, wrong shape, unknown ids, etc).
        const excerpt = debug.rawResponseExcerpt
          .replace(/```/g, "'''")
          .slice(0, 700);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract any structured updates.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            `\n**Debug:** roster=${debug.rosterSize}, products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, images=${images.length}, drops=${debug.droppedReasons.length}\n` +
            (debug.droppedReasons.length > 0
              ? `**Dropped reasons:** ${debug.droppedReasons.slice(0, 5).join(' | ')}\n\n`
              : '\n') +
            `**Claude raw (first 700):**\n\`\`\`${excerpt}\`\`\``,
        });
        return;
      }

      // Stage the proposed updates so the ✅ button can apply them later.
      // Persist CDN URLs so the Refine flow can re-fetch + re-parse within
      // Discord's ~24h CDN window. Mirrors pending_insights expires_at TTL.
      const { data: pending, error: pendErr } = await supabaseAdmin
        .from('pending_insights')
        .insert({
          discord_channel_id: interaction.channel_id,
          source_user_id: user.id,
          source_text: narrative ?? (images.length > 0 ? `[${images.length} screenshot${images.length === 1 ? '' : 's'}: ${attachments.map(a => a.filename).join(', ')}]` : ''),
          parsed_updates: updates as unknown as object,
          source_kind: 'insight',
          source_attachments: attachments.length > 0
            ? attachments.map(a => ({ url: a.url, filename: a.filename, content_type: a.content_type ?? null }))
            : null,
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
      const imageSuffix = images.length === 0
        ? ''
        : images.length === 1
          ? ' _(+ screenshot)_'
          : ` _(+ ${images.length} screenshots)_`;
      const sourceLabel = narrative
        ? `> ${narrative.slice(0, 240)}${imageSuffix}`
        : `_(${images.length} screenshot${images.length === 1 ? '' : 's'}: ${attachments.map(a => a.filename).slice(0, 3).join(', ')}${attachments.length > 3 ? '…' : ''})_`;
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Insight from @${handle}:**\n${sourceLabel}\n\n` +
        targetsBlock +
        `**Proposed updates (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Insight from @${handle}:**\n${sourceLabel}\n\n` +
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
                style: ButtonStyle.SECONDARY,
                label: 'Refine',
                custom_id: `refine:${pending.id}`,
                emoji: { name: '✏️' },
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

// ─── /url-source handlers ─────────────────────────────────────────────────
// Slice 4a. An allowlisted SME points us at any URL with a cadence +
// stop_after. We record it in tracked_sources (the nightly cron in Slice 4b
// re-scrapes recurring rows) AND run the first scrape immediately: scrape
// the page → parseInsights on its markdown → stage a pending_insights
// proposal with source_kind='tracked_source_scrape' and the URL as
// source_text → reply with the same ✅/✏️/❌ panel as /insight. Apply reuses
// the existing applyUpdates path; refine re-scrapes the stored URL.
//
// Two entry points share captureUrlSource: the /url-source slash command
// (URL + cadence/stop_after via option dropdowns) and the "Capture
// url-source" MESSAGE context menu (long-press a post that contains a link →
// extract the URL → modal for cadence/stop_after).

/** First http(s) URL in a string, with common trailing punctuation trimmed. */
function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>()]+/i);
  if (!m) return null;
  return m[0].replace(/[.,!?:;'")\]]+$/, '');
}

/**
 * Shared staging path for both /url-source entry points. Records the source
 * (so the Slice 4b cron can re-scrape recurring rows), runs the first scrape,
 * and edits the deferred interaction reply with the proposal panel (or a
 * scrape/no-updates diagnostic). Caller must have already deferred with
 * DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE.
 */
async function captureUrlSource(params: {
  applicationId: string;
  token: string;
  channelId: string;
  user: { id: string; username: string; global_name?: string };
  url: string;
  cadence: string;
  stopAfter: string;
  scope: string | null;
  note: string | null;
}): Promise<void> {
  const { applicationId, token, channelId, user, url, cadence, stopAfter, scope, note } = params;
  try {
    // 1. Record the source so the cron can pick it up (Slice 4b). One-shot
    //    sources (one_off cadence or immediate stop) are marked done now —
    //    the first scrape below is their only scrape.
    const oneShot = isOneShot(cadence, stopAfter);
    const now = new Date();
    const stopAt = oneShot ? null : computeStopAt(stopAfter, now);
    const nextScrapeAt = oneShot ? null : computeNextScrapeAt(cadence, now);
    const { data: tracked, error: trackErr } = await supabaseAdmin
      .from('tracked_sources')
      .insert({
        url,
        cadence,
        scope,
        note,
        stop_at: stopAt?.toISOString() ?? null,
        status: oneShot ? 'done' : 'active',
        submitted_by: user.id,
        // Slice 4b: the recurring cron needs to know which channel to post
        // the proposal to, since it has no interaction to reply to.
        discord_channel_id: channelId,
        last_scraped_at: now.toISOString(),
        next_scrape_at: nextScrapeAt?.toISOString() ?? null,
      })
      .select('id')
      .single();
    if (trackErr) {
      await editInteractionResponse(applicationId, token, {
        content: `⚠️ Couldn't record the source: ${trackErr.message}`,
      });
      return;
    }

    const scheduleLine = oneShot ? 'one-off' : describeSchedule(cadence, stopAt);
    const handle = user.global_name ?? user.username;

    // 2. First scrape + stage via the shared helper — the same path the
    //    Slice 4b cron reuses on each cadence firing.
    let result;
    try {
      result = await scrapeAndStageProposal({
        url,
        note,
        channelId,
        submittedBy: user.id,
        scheduleLine,
        submitterLabel: `@${handle}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'scrape failed';
      await supabaseAdmin.from('tracked_sources').update({ last_error: msg }).eq('id', tracked.id);
      await editInteractionResponse(applicationId, token, {
        content: `⚠️ Tracked the source, but the first scrape failed: ${msg}\n${url}`,
      });
      return;
    }

    if (!result.staged) {
      // Surface a snippet of what we actually SCRAPED so "empty because the
      // page was thin / paywalled" is distinguishable from "empty because
      // the parser was too conservative." A homepage with no article bodies
      // shows up here as a short masthead/subscribe blob; a real article
      // shows substantive prose.
      const { debug, scrapedChars, scrapedPreview } = result;
      const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 400);
      await editInteractionResponse(applicationId, token, {
        content:
          `📎 Tracking **${url}** (${scheduleLine}). First scrape extracted no structured updates.\n` +
          `**Debug:** roster=${debug.rosterSize}, products=${debug.productsCount}, scraped=${scrapedChars} chars, parsedRaw=${debug.parsedRawCount}, drops=${debug.droppedReasons.length}\n` +
          `**Scraped (first 400):**\n\`\`\`${scrapedPreview || '(empty)'}\`\`\`\n` +
          (excerpt ? `**Claude raw (first 400):**\n\`\`\`${excerpt}\`\`\`` : ''),
      });
      return;
    }

    await editInteractionResponse(applicationId, token, result.body);
  } catch (err) {
    console.error('[discord/url-source] failed', err);
    await editInteractionResponse(applicationId, token, {
      content: `⚠️ Error: ${err instanceof Error ? err.message : 'unknown'}`,
    }).catch(() => {});
  }
}

async function handleUrlSource(interaction: SlashCommandInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you, sorry.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply(
      'You are not on the BreakIQ contributor allowlist. Ping Brody to get added.',
    );
  }

  const options = interaction.data.options ?? [];
  const url = options.find(o => o.name === 'url')?.value?.trim();
  const cadence = options.find(o => o.name === 'cadence')?.value?.trim() ?? 'one_off';
  const stopAfter = options.find(o => o.name === 'stop_after')?.value?.trim() ?? 'immediately';
  const scope = options.find(o => o.name === 'scope')?.value?.trim() || null;
  const note = options.find(o => o.name === 'note')?.value?.trim() || null;

  if (!url || !/^https?:\/\//i.test(url)) {
    return ephemeralReply('Provide a valid http(s) URL.');
  }

  after(() => captureUrlSource({
    applicationId: interaction.application_id,
    token: interaction.token,
    channelId: interaction.channel_id,
    user,
    url,
    cadence,
    stopAfter,
    scope,
    note,
  }));

  return NextResponse.json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  });
}

// MESSAGE context menu: long-press / right-click a post that contains a link
// → Apps → "Capture url-source". We pull the first URL out of the message and
// open a modal for cadence + stop_after (context-menu commands can't carry
// option dropdowns, and Discord modals support only text inputs — so they're
// typed, pre-filled with sensible defaults, and validated on submit).
async function handleUrlSourceFromMessage(interaction: SlashCommandInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you, sorry.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply('You are not on the BreakIQ contributor allowlist. Ping Brody to get added.');
  }

  const targetId = interaction.data.target_id;
  const msg = targetId ? interaction.data.resolved?.messages?.[targetId] : undefined;
  if (!msg) {
    return ephemeralReply('Could not read that message.');
  }

  const url = extractFirstUrl(msg.content ?? '');
  if (!url) {
    return ephemeralReply('No link found in that message. Use /url-source and paste the URL directly.');
  }

  // The URL rides through the modal as a pre-filled (editable) field — modal
  // submits don't carry the target message, so we can't re-resolve it later.
  return NextResponse.json({
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: 'url_source_modal',
      title: 'Track this URL',
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [{
            type: ComponentType.TEXT_INPUT,
            custom_id: 'url',
            label: 'URL to scrape',
            style: TextInputStyle.SHORT,
            value: url.slice(0, 1000),
            required: true,
            max_length: 1000,
          }],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [{
            type: ComponentType.TEXT_INPUT,
            custom_id: 'cadence',
            label: 'Cadence',
            style: TextInputStyle.SHORT,
            value: 'weekly',
            placeholder: 'one_off · daily · weekly · twice_monthly',
            required: true,
            max_length: 20,
          }],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [{
            type: ComponentType.TEXT_INPUT,
            custom_id: 'stop_after',
            label: 'Stop after',
            style: TextInputStyle.SHORT,
            value: '3_months',
            placeholder: 'immediately · 1_month · 3_months · 6_months · 1_year',
            required: true,
            max_length: 20,
          }],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [{
            type: ComponentType.TEXT_INPUT,
            custom_id: 'note',
            label: 'Note for Claude (optional)',
            style: TextInputStyle.PARAGRAPH,
            required: false,
            max_length: 300,
          }],
        },
      ],
    },
  });
}

async function handleUrlSourceModalSubmit(interaction: ModalSubmitInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply('You are not on the BreakIQ contributor allowlist.');
  }

  const fields = new Map(
    interaction.data.components
      .flatMap(row => row.components)
      .map(c => [c.custom_id, (c.value ?? '').trim()]),
  );

  const url = fields.get('url') ?? '';
  if (!/^https?:\/\//i.test(url)) {
    return ephemeralReply('That doesn’t look like a valid http(s) URL.');
  }

  // Forgiving normalization so "one off" / "3-months" / "3 Months" all land.
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '_');
  const cadence = norm(fields.get('cadence') ?? '');
  if (!CADENCE_VALUES.includes(cadence as Cadence)) {
    return ephemeralReply(`Cadence must be one of: ${CADENCE_VALUES.join(', ')}.`);
  }
  const stopAfter = norm(fields.get('stop_after') ?? '');
  if (!STOP_AFTER_VALUES.includes(stopAfter as StopAfter)) {
    return ephemeralReply(`Stop after must be one of: ${STOP_AFTER_VALUES.join(', ')}.`);
  }
  const note = (fields.get('note') ?? '') || null;

  after(() => captureUrlSource({
    applicationId: interaction.application_id,
    token: interaction.token,
    channelId: interaction.channel_id,
    user,
    url,
    cadence,
    stopAfter,
    scope: null,
    note,
  }));

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
  const urlOption = options.find(o => o.name === 'url')?.value?.trim() || undefined;
  const fileId = options.find(o => o.name === 'file')?.value;
  const fileAttachment = fileId ? interaction.data.resolved?.attachments?.[fileId] : undefined;

  // Collect every present screenshot slot. The registrar exposes 5 numbered
  // slots; users fill what they have. Order is preserved (slot 1 → slot 5)
  // so Claude sees images in user-intended order.
  const SCREENSHOT_OPTION_NAMES = ['screenshot', 'screenshot2', 'screenshot3', 'screenshot4', 'screenshot5'];
  const attachments = SCREENSHOT_OPTION_NAMES
    .map(name => {
      const id = options.find(o => o.name === name)?.value;
      return id ? interaction.data.resolved?.attachments?.[id] : undefined;
    })
    .filter((a): a is DiscordAttachment => !!a);

  if (!narrative && attachments.length === 0 && !urlOption && !fileAttachment) {
    return ephemeralReply('Include at least a narrative, a screenshot, a Google Sheets URL, or a .xlsx/.csv file.');
  }

  // Defer immediately — image fetch + Claude vision call can take several
  // seconds and we only have 3s to ack.
  after(async () => {
    try {
      // Convert a Google Sheets URL or .xlsx/.csv attachment into a markdown
      // table that parseBreakPrice can chew on. File takes precedence when
      // both are supplied — direct upload beats indirect link. Short-circuit
      // here with a contributor-actionable error rather than letting the
      // parser silently fail downstream.
      let tabularText: string | undefined;
      let tabularSource: string | undefined;

      if (fileAttachment) {
        const ext = (fileAttachment.filename.match(/\.([^.]+)$/i)?.[1] ?? '').toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext)) {
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ Unsupported file type: \`.${ext || '?'}\`. Supported: .xlsx, .xls, .csv`,
          });
          return;
        }
        try {
          const res = await fetch(fileAttachment.url);
          if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 5_000_000) {
            throw new Error(`${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 5 MB cap`);
          }
          const result = ext === 'csv'
            ? csvTextToMarkdown(buf.toString('utf8'))
            : xlsxBufferToMarkdown(buf);
          if (!result.markdown) {
            const skipMsg = result.sheetsSkipped.length > 0
              ? ` Skipped ${result.sheetsSkipped.length} tab${result.sheetsSkipped.length === 1 ? '' : 's'} (no pricing-shaped content): ${result.sheetsSkipped.join(', ')}.`
              : '';
            await editInteractionResponse(interaction.application_id, interaction.token, {
              content: `⚠️ \`${fileAttachment.filename}\` didn't have any tabs that look like a price sheet (need $-shaped values).${skipMsg}`,
            });
            return;
          }
          tabularText = result.markdown;
          tabularSource = formatTabularSourceLabel(`file: ${fileAttachment.filename}`, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'parse failed';
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ Couldn't read \`${fileAttachment.filename}\`: ${msg}`,
          });
          return;
        }
      } else if (urlOption) {
        if (!detectGoogleSheet(urlOption)) {
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ The \`url\` option on /break-price supports Google Sheets only. For other web pages, use \`/url-source\`.`,
          });
          return;
        }
        try {
          const buf = await fetchGoogleSheetXlsx(urlOption);
          const result = xlsxBufferToMarkdown(buf);
          if (!result.markdown) {
            const skipMsg = result.sheetsSkipped.length > 0
              ? ` Skipped ${result.sheetsSkipped.length} tab${result.sheetsSkipped.length === 1 ? '' : 's'} (no pricing-shaped content): ${result.sheetsSkipped.join(', ')}.`
              : '';
            await editInteractionResponse(interaction.application_id, interaction.token, {
              content: `⚠️ That sheet didn't have any tabs that look like a price sheet (need $-shaped values).${skipMsg}`,
            });
            return;
          }
          tabularText = result.markdown;
          tabularSource = formatTabularSourceLabel('Google Sheets', result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'fetch failed';
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ ${msg}`,
          });
          return;
        }
      }

      // Parallel fetch + per-image sniff. Mirrors the context-menu handler
      // pattern: one bad image aborts with per-index error reporting so the
      // proposal is honest rather than partial.
      const fetched = await Promise.all(
        attachments.map(async (a, idx) => {
          const declaredMt = (a.content_type ?? '').split(';')[0].trim();
          if (declaredMt && !VALID_IMAGE_TYPES.has(declaredMt)) {
            return { ok: false as const, idx, error: `slot ${idx + 1}: type \`${declaredMt}\` isn't supported` };
          }
          const res = await fetch(a.url);
          if (!res.ok) {
            return { ok: false as const, idx, error: `slot ${idx + 1}: fetch status ${res.status}` };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > PER_IMAGE_BYTE_CAP) {
            return {
              ok: false as const,
              idx,
              error: `slot ${idx + 1}: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 5 MB cap`,
            };
          }
          // Trust bytes, not Discord's declared content_type — iOS often
          // mis-labels PNGs as JPEGs which Claude rejects on validation.
          const sniffed = sniffImageMediaType(buf);
          if (!sniffed) {
            return {
              ok: false as const,
              idx,
              error: `slot ${idx + 1}: couldn't identify image format from bytes (re-save as PNG/JPEG)`,
            };
          }
          return { ok: true as const, idx, base64: buf.toString('base64'), mediaType: sniffed };
        }),
      );

      const failed = fetched.filter((f): f is { ok: false; idx: number; error: string } => !f.ok);
      if (failed.length > 0) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Couldn't load ${failed.length} of ${attachments.length} screenshot${attachments.length === 1 ? '' : 's'}:\n` +
            failed.map(f => `  • ${f.error}`).join('\n'),
        });
        return;
      }

      const images: BreakPriceImage[] = fetched
        .filter((f): f is { ok: true; idx: number; base64: string; mediaType: BreakPriceImageMediaType } => f.ok)
        .map(f => ({ base64: f.base64, mediaType: f.mediaType }));

      const { updates, debug } = await parseBreakPrice({ narrative, notes, images, productId, tabularText });

      if (updates.length === 0) {
        const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 500);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract a slot ask.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            (tabularSource ? `> _Tabular input: ${tabularSource}_\n` : '') +
            `\n**Debug:** products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, images=${images.length}, tabular=${debug.hadTabular ? 'yes' : 'no'}, drops=${debug.droppedReasons.length}\n` +
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
          source_text: narrative ?? (tabularSource ? `[${tabularSource}${urlOption ? ` ${urlOption}` : ''}]` : (images.length > 0 ? `[${images.length} screenshot${images.length === 1 ? '' : 's'}: ${attachments.map(a => a.filename).join(', ')}]` : '')),
          parsed_updates: updates as unknown as object,
          source_kind: 'break_price',
          // Persist CDN URLs so the Refine flow can re-fetch + re-parse
          // within Discord's ~24h CDN window. Mirrors pending_insights
          // expires_at TTL.
          source_attachments: attachments.length > 0
            ? attachments.map(a => ({ url: a.url, filename: a.filename, content_type: a.content_type ?? null }))
            : null,
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
      const imageSuffix = images.length === 0
        ? ''
        : images.length === 1
          ? ' _(+ screenshot)_'
          : ` _(+ ${images.length} screenshots)_`;
      const sourceLabel = narrative
        ? `> ${narrative.slice(0, 240)}${imageSuffix}`
        : `_(${images.length} screenshot${images.length === 1 ? '' : 's'}: ${attachments.map(a => a.filename).slice(0, 3).join(', ')}${attachments.length > 3 ? '…' : ''})_`;
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
                style: ButtonStyle.SECONDARY,
                label: 'Refine',
                custom_id: `refine:${pending.id}`,
                emoji: { name: '✏️' },
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

/**
 * Identify an image's real media type by inspecting its magic bytes.
 * Discord (and iOS in particular) routinely sends `content_type: image/jpeg`
 * for files whose bytes are actually PNG, which Claude's vision endpoint
 * rejects with a 400. Always trust the bytes, not the header.
 * Returns null when the bytes don't match a supported format.
 */
function sniffImageMediaType(buf: Buffer): BreakPriceImageMediaType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 6) {
    const head = buf.toString('ascii', 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  return null;
}

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
  // .xlsx / .xls / .csv on the target message → tabular price-sheet path.
  // First match wins (rare to attach multiple sheets on one message).
  const tabularAttachment = allAttachments.find(a => {
    const ext = (a.filename.match(/\.([^.]+)$/i)?.[1] ?? '').toLowerCase();
    return ext === 'xlsx' || ext === 'xls' || ext === 'csv';
  });
  // Google Sheets URL in the message content → tabular path too. Same
  // restriction as the slash command: only Sheets links here; other web
  // pages route through /url-source.
  const rawContent = target.content?.trim() ?? '';
  const sheetUrlMatch = rawContent.match(/https?:\/\/docs\.google\.com\/spreadsheets\/[^\s<>()]+/i);
  const sheetUrl = sheetUrlMatch ? sheetUrlMatch[0].replace(/[.,!?:;'")\]]+$/, '') : null;

  if (imageAttachments.length === 0 && !tabularAttachment && !sheetUrl) {
    return ephemeralReply(
      'No screenshots, .xlsx/.csv attachment, or Google Sheets link on that message. Add one and try again, or fire `/break-price` directly.',
    );
  }

  if (imageAttachments.length > CONTEXT_MENU_IMAGE_CAP) {
    return ephemeralReply(
      `Pick a message with ≤${CONTEXT_MENU_IMAGE_CAP} screenshots — found ${imageAttachments.length}. Bigger batches risk truncation in the proposal preview.`,
    );
  }

  // If the target's text is JUST the Sheets URL we already extracted, don't
  // re-pass it as narrative — it'd confuse the prompt. Otherwise keep it.
  const narrative = (() => {
    const t = rawContent;
    if (!t) return undefined;
    if (sheetUrl && t === sheetUrl) return undefined;
    return t;
  })();

  after(async () => {
    try {
      // Process the tabular source first (if any) so a parse / fetch error
      // gives an actionable reply BEFORE we burn the image fetches.
      let tabularText: string | undefined;
      let tabularSource: string | undefined;

      if (tabularAttachment) {
        const ext = (tabularAttachment.filename.match(/\.([^.]+)$/i)?.[1] ?? '').toLowerCase();
        try {
          const res = await fetch(tabularAttachment.url);
          if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 5_000_000) {
            throw new Error(`${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 5 MB cap`);
          }
          const result = ext === 'csv'
            ? csvTextToMarkdown(buf.toString('utf8'))
            : xlsxBufferToMarkdown(buf);
          if (!result.markdown) {
            const skipMsg = result.sheetsSkipped.length > 0
              ? ` Skipped ${result.sheetsSkipped.length} tab${result.sheetsSkipped.length === 1 ? '' : 's'} (no pricing-shaped content): ${result.sheetsSkipped.join(', ')}.`
              : '';
            await editInteractionResponse(interaction.application_id, interaction.token, {
              content: `⚠️ \`${tabularAttachment.filename}\` didn't have any tabs that look like a price sheet (need $-shaped values).${skipMsg}`,
            });
            return;
          }
          tabularText = result.markdown;
          tabularSource = formatTabularSourceLabel(`file: ${tabularAttachment.filename}`, result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'parse failed';
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ Couldn't read \`${tabularAttachment.filename}\`: ${msg}`,
          });
          return;
        }
      } else if (sheetUrl) {
        try {
          const buf = await fetchGoogleSheetXlsx(sheetUrl);
          const result = xlsxBufferToMarkdown(buf);
          if (!result.markdown) {
            const skipMsg = result.sheetsSkipped.length > 0
              ? ` Skipped ${result.sheetsSkipped.length} tab${result.sheetsSkipped.length === 1 ? '' : 's'} (no pricing-shaped content): ${result.sheetsSkipped.join(', ')}.`
              : '';
            await editInteractionResponse(interaction.application_id, interaction.token, {
              content: `⚠️ That sheet didn't have any tabs that look like a price sheet (need $-shaped values).${skipMsg}`,
            });
            return;
          }
          tabularText = result.markdown;
          tabularSource = formatTabularSourceLabel('Google Sheets', result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'fetch failed';
          await editInteractionResponse(interaction.application_id, interaction.token, {
            content: `⚠️ ${msg}`,
          });
          return;
        }
      }

      // Parallel fetch. One bad image is reported by index and aborts
      // the parse — keeps the proposal honest rather than partial.
      const fetched = await Promise.all(
        imageAttachments.map(async (a, idx) => {
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
          // Trust bytes, not Discord's content_type header — iOS frequently
          // mis-labels PNGs as JPEGs which Claude rejects on validation.
          const sniffed = sniffImageMediaType(buf);
          if (!sniffed) {
            return {
              ok: false as const,
              idx,
              error: `couldn't identify ${a.filename}'s format from its bytes`,
            };
          }
          return { ok: true as const, idx, base64: buf.toString('base64'), mediaType: sniffed };
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

      const { updates, debug } = await parseBreakPrice({ narrative, images, tabularText });

      if (updates.length === 0) {
        const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 500);
        const inputSummary = [
          images.length > 0 ? `${images.length} screenshot${images.length === 1 ? '' : 's'}` : null,
          tabularSource,
        ].filter(Boolean).join(' + ') || 'no input';
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract a slot ask from ${inputSummary}.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            `\n**Debug:** products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, tabular=${debug.hadTabular ? 'yes' : 'no'}, drops=${debug.droppedReasons.length}\n` +
            (debug.droppedReasons.length > 0
              ? `**Dropped:** ${debug.droppedReasons.slice(0, 4).join(' | ')}\n\n`
              : '\n') +
            (excerpt ? `**Claude raw (first 500):**\n\`\`\`${excerpt}\`\`\`` : ''),
        });
        return;
      }

      const sourceTextSummary = (() => {
        if (narrative) return narrative;
        if (tabularSource) return `[message context menu: ${tabularSource}${sheetUrl ? ` ${sheetUrl}` : ''}]`;
        return `[message context menu: ${imageAttachments.length} screenshot${imageAttachments.length === 1 ? '' : 's'}]`;
      })();
      const { data: pending, error: pendErr } = await supabaseAdmin
        .from('pending_insights')
        .insert({
          discord_channel_id: interaction.channel_id,
          source_user_id: user.id,
          source_text: sourceTextSummary,
          parsed_updates: updates as unknown as object,
          source_kind: 'break_price',
          // Image CDN URLs only — re-fetch on Refine. Tabular sources don't
          // get persisted here: Google Sheets URL is in source_text and an
          // xlsx attachment's URL has the same Discord-CDN 24h window as
          // images. Adding tabular re-fetch on Refine is a follow-up.
          source_attachments: imageAttachments.length > 0
            ? imageAttachments.map(a => ({
                url: a.url,
                filename: a.filename,
                content_type: a.content_type ?? null,
              }))
            : null,
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
      const inputBits = [
        imageAttachments.length > 0 ? `${imageAttachments.length} screenshot${imageAttachments.length === 1 ? '' : 's'}` : null,
        tabularSource,
      ].filter(Boolean);
      const inputNote = `_(message context menu · ${inputBits.join(' + ') || 'no input'})_`;
      const sourceLabel = narrative ? `> ${narrative.slice(0, 240)}\n${inputNote}` : inputNote;
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
                style: ButtonStyle.SECONDARY,
                label: 'Refine',
                custom_id: `refine:${pending.id}`,
                emoji: { name: '✏️' },
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

// ─── /insight message context-menu handler ──────────────────────────────
// Triggered when an allowlisted contributor long-presses (mobile) or
// right-clicks (desktop) any message in Discord and picks
// Apps → "Capture insight". Receives the full target message, pulls every
// image attachment on it (soft-capped at 5), and hands them to
// parseInsights as a single batch alongside the target message's text.
//
// Mirrors handleBreakPriceFromMessage downstream — same parser type, same
// allowlist, same pending_insights staging, same ✅/✏️/❌ buttons — only the
// parser entrypoint and proposal label change. The duplication is
// intentional: each surface owns its own user-facing copy + debug line.

async function handleInsightFromMessage(interaction: SlashCommandInteraction): Promise<NextResponse> {
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
    return ephemeralReply('Discord didn\'t send the target message. Try again, or fire `/insight` directly.');
  }

  const allAttachments = target.attachments ?? [];
  const imageAttachments = allAttachments.filter(a => {
    const mt = (a.content_type ?? '').split(';')[0].trim();
    return VALID_IMAGE_TYPES.has(mt);
  });

  const narrative = target.content?.trim() || undefined;

  // Insight context-menu is more permissive than break-price's: if a
  // contributor right-clicks a text-only message ("Wemby just dropped 60")
  // we still parse it through parseInsights — text alone is a valid /insight.
  // Only bail when there's nothing at all.
  if (imageAttachments.length === 0 && !narrative) {
    return ephemeralReply('That message has no text and no image attachments. Pick a message with at least one.');
  }

  if (imageAttachments.length > CONTEXT_MENU_IMAGE_CAP) {
    return ephemeralReply(
      `Pick a message with ≤${CONTEXT_MENU_IMAGE_CAP} screenshots — found ${imageAttachments.length}. Bigger batches risk truncation in the proposal preview.`,
    );
  }

  after(async () => {
    try {
      // Parallel fetch. One bad image is reported by index and aborts
      // the parse — keeps the proposal honest rather than partial.
      const fetched = await Promise.all(
        imageAttachments.map(async (a, idx) => {
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
          // Trust bytes, not Discord's content_type header — iOS frequently
          // mis-labels PNGs as JPEGs which Claude rejects on validation.
          const sniffed = sniffImageMediaType(buf);
          if (!sniffed) {
            return {
              ok: false as const,
              idx,
              error: `couldn't identify ${a.filename}'s format from its bytes`,
            };
          }
          return { ok: true as const, idx, base64: buf.toString('base64'), mediaType: sniffed };
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

      const { updates, debug } = await parseInsights({ narrative, images });

      if (updates.length === 0) {
        const excerpt = debug.rawResponseExcerpt.replace(/```/g, "'''").slice(0, 500);
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content:
            `❓ Couldn't extract any structured updates from ${images.length} screenshot${images.length === 1 ? '' : 's'}.\n` +
            (narrative ? `> ${narrative.slice(0, 200)}\n` : '') +
            `\n**Debug:** roster=${debug.rosterSize}, products=${debug.productsCount}, parsedRaw=${debug.parsedRawCount}, drops=${debug.droppedReasons.length}\n` +
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
          source_kind: 'insight',
          source_attachments: imageAttachments.length > 0
            ? imageAttachments.map(a => ({ url: a.url, filename: a.filename, content_type: a.content_type ?? null }))
            : null,
        })
        .select('id')
        .single();

      if (pendErr || !pending) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `⚠️ Parsed ${updates.length} update${updates.length === 1 ? '' : 's'} but couldn't stage them: ${pendErr?.message ?? 'unknown error'}`,
        });
        return;
      }

      const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
      const handle = user.global_name ?? user.username;
      const imageNote = imageAttachments.length === 0
        ? ''
        : `_(message context menu · ${imageAttachments.length} screenshot${imageAttachments.length === 1 ? '' : 's'})_`;
      const sourceLabel = narrative
        ? `> ${narrative.slice(0, 240)}${imageNote ? `\n${imageNote}` : ''}`
        : (imageNote || '_(message context menu)_');
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Insight from @${handle}:**\n${sourceLabel}\n\n` +
        targetsBlock +
        `**Proposed updates (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Insight from @${handle}:**\n${sourceLabel}\n\n` +
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
                style: ButtonStyle.SECONDARY,
                label: 'Refine',
                custom_id: `refine:${pending.id}`,
                emoji: { name: '✏️' },
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
      console.error('[discord/insight-ctx] parse failed', err);
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

/**
 * Append a resolution line ("✅ Applied", "❌ Discarded", …) to a proposal's
 * content, clamped to Discord's 2000-char message limit. Proposal summaries
 * are already budgeted right up against that cap, so a naive append can push
 * the body over 2000 — and when that body is an UPDATE_MESSAGE interaction
 * response, the whole response is rejected and the buttons DON'T clear, which
 * is the exact failure we're trying to fix. Trim the base to make room.
 */
function appendResolution(base: string, suffix: string): string {
  const MAX = 2000;
  if (base.length + suffix.length <= MAX) return base + suffix;
  const room = Math.max(0, MAX - suffix.length - 1);
  return base.slice(0, room) + '…' + suffix;
}

interface ButtonInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  message: { id: string; content: string };
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

  // Refine — open a Discord modal asking what should change. Submission
  // arrives via MODAL_SUBMIT and is routed to handleRefineModalSubmit
  // which re-parses + edits the proposal message in place.
  if (action === 'refine') {
    return NextResponse.json({
      type: InteractionResponseType.MODAL,
      data: {
        custom_id: `refine_modal:${pendingId}`,
        title: 'Refine proposal',
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.TEXT_INPUT,
                custom_id: 'correction',
                label: 'What should change?',
                style: TextInputStyle.PARAGRAPH,
                min_length: 3,
                max_length: 500,
                placeholder: "e.g. 'this is hobby not jumbo' or 'Tigers row should be $200'",
                required: true,
              },
            ],
          },
        ],
      },
    });
  }

  const handle = user.global_name ?? user.username;
  const baseContent = interaction.message.content;
  const messageId = interaction.message.id;

  // Resolve the buttons in the IMMEDIATE interaction response (UPDATE_MESSAGE,
  // type 7) rather than in a post-hoc edit. The post-hoc edit
  // (editInteractionResponse @original OR editChannelMessage) is unreliable on
  // a message that a PRIOR interaction already edited — notably a refine
  // modal-submit — so the buttons would stay live on an already-resolved
  // proposal (click ✅ again → "already applied"). PR #114 swapped @original →
  // editChannelMessage and it STILL failed on refined messages. Updating the
  // component's own message via the interaction response is the one mechanism
  // Discord guarantees, so the buttons clear there; the precise-count text is
  // a best-effort follow-up.

  if (action === 'discard') {
    // Fast + deterministic — flip status inline (well within the 3s budget),
    // then strip the buttons + mark discarded in the response.
    await supabaseAdmin
      .from('pending_insights')
      .update({ status: 'discarded', resolved_at: new Date().toISOString() })
      .eq('id', pendingId)
      .eq('status', 'pending');

    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: appendResolution(baseContent, `\n\n— ❌ **Discarded** by @${handle}`),
        components: [],
      },
    });
  }

  if (action === 'confirm') {
    const updates = pending.parsed_updates as ParsedUpdate[];

    // applyUpdates can exceed the 3s budget (sentiment fans out across many
    // player_products), so the write + the exact-count text edit run in
    // after(). The optimistic "Applied" in the response below is corrected to
    // a precise count on success, or to "Apply failed" if the write throws —
    // both best-effort, since the buttons are already gone from the response.
    after(async () => {
      // Editing the component's own message: editInteractionResponse first
      // (this interaction's @original IS the message we just updated, so it's
      // reliable — unlike the cross-interaction lineage #114 hit), falling
      // back to a channel edit.
      const finalize = (content: string) =>
        editInteractionResponse(interaction.application_id, interaction.token, { content, components: [] })
          .catch(() => editChannelMessage(interaction.channel_id, messageId, { content, components: [] }))
          .catch(err => console.error('[discord/confirm] final edit failed (buttons already cleared)', err));

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

        await finalize(appendResolution(
          baseContent,
          `\n\n— ✅ **Applied** by @${handle}: ${result.applied} of ${updates.length} updates committed.` +
            (result.errors.length > 0 ? `\nErrors: ${result.errors.slice(0, 3).join('; ')}` : ''),
        ));
      } catch (err) {
        console.error('[discord/confirm] apply failed', err);
        await finalize(appendResolution(baseContent, `\n\n— ⚠️ **Apply failed** by @${handle}: ${err instanceof Error ? err.message : 'unknown'}`));
      }
    });

    // Immediately strip buttons + show optimistic applied state.
    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: appendResolution(baseContent, `\n\n— ✅ **Applied** by @${handle}`),
        components: [],
      },
    });
  }

  return ephemeralReply('Unknown button.');
}

// ─── Refine modal submit handler ─────────────────────────────────────────
// Fired when an allowlisted contributor submits the Discord modal opened
// by clicking the ✏️ Refine button. Re-fetches the original capture
// (images from Discord CDN within ~24h, original narrative from the
// pending_insights row), runs the parser again with the correction text
// spliced in as additional context, and edits the proposal message in
// place with the new parse. Works for both /insight (text-only) and
// /break-price (text + images) captures.

interface ModalSubmitInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  message?: { id: string; content: string };
  data: {
    custom_id: string;
    components: Array<{
      type: number;
      components: Array<{ type: number; custom_id: string; value: string }>;
    }>;
  };
}

async function handleRefineModalSubmit(interaction: ModalSubmitInteraction): Promise<NextResponse> {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return ephemeralReply('Could not identify you.');

  if (!(await isAllowlisted(user.id))) {
    return ephemeralReply('You are not on the BreakIQ contributor allowlist.');
  }

  const customId = interaction.data.custom_id ?? '';
  if (!customId.startsWith('refine_modal:')) {
    return ephemeralReply('Unknown modal.');
  }
  const pendingId = customId.slice('refine_modal:'.length);

  // Pull the user's correction out of the modal's flat component tree.
  const correction = interaction.data.components
    .flatMap(row => row.components)
    .find(c => c.custom_id === 'correction')?.value?.trim();
  if (!correction) {
    return ephemeralReply('Empty correction — try again with a short description of what should change.');
  }

  // Race-safe lookup. Refine only operates on still-pending proposals.
  const { data: pending } = await supabaseAdmin
    .from('pending_insights')
    .select('id, source_text, status, source_kind, source_attachments')
    .eq('id', pendingId)
    .maybeSingle();
  if (!pending) {
    return ephemeralReply('That proposal expired or was already resolved.');
  }
  if (pending.status !== 'pending') {
    return ephemeralReply(`That proposal was already ${pending.status}.`);
  }

  const handle = user.global_name ?? user.username;
  const baseContent = interaction.message?.content ?? '';
  const messageId = interaction.message?.id;

  if (!messageId) {
    return ephemeralReply('Could not locate the original proposal message. Try Refine again.');
  }

  // Defer immediately — re-fetching N CDN URLs + running Claude vision
  // exceeds Discord's 3s budget. We edit the source message directly via
  // editChannelMessage (channel-message API) instead of the interaction
  // webhook because the message was created by an EARLIER interaction
  // (the original /insight or /break-price), and the modal-submit's
  // @original-via-token reference is unreliable across that lineage.
  after(async () => {
    try {
      const kind = (pending.source_kind ?? 'insight') as 'insight' | 'break_price' | 'tracked_source_scrape';
      let updates: ParsedUpdate[] = [];
      let debugLine = '';

      if (kind === 'tracked_source_scrape') {
        // source_text holds the URL. Re-scrape it fresh and re-parse with
        // the correction as an authoritative override (same pattern as the
        // /insight refine branch). If the page is unreachable now, surface
        // it rather than silently producing nothing.
        try {
          const page = await scrapeEditorial(pending.source_text);
          const res = await parseInsights({
            narrative: page.markdown,
            refineCorrection: correction,
            webSource: true,
          });
          updates = res.updates;
          debugLine = `rosterSize=${res.debug.rosterSize}, parsedRaw=${res.debug.parsedRawCount}, drops=${res.debug.droppedReasons.length}`;
        } catch (err) {
          await editChannelMessage(interaction.channel_id, messageId, {
            content: `${baseContent}\n\n— ✏️ **Refine by @${handle} failed:** couldn't re-scrape ${pending.source_text} (${err instanceof Error ? err.message : 'error'}).`,
          }).catch(e => console.error('[discord/refine] message edit failed', e));
          return;
        }
      } else if (kind === 'insight') {
        // Re-parse with the correction as a STRUCTURED parameter rather
        // than concatenating it onto the narrative — parseInsights renders
        // refineCorrection in a dedicated "CONTRIBUTOR CORRECTION
        // (authoritative)" section with prompt language that tells the
        // model to treat it as an override. Previously the concat-into-
        // narrative approach let the model re-roll wrong: the Wemby
        // insight got re-mapped to Alex Sarr after a refine that
        // literally said "this is for Victor Webanyama - not Donic"
        // (2026-05-26).
        //
        // As of 2026-05-26 /insight also accepts screenshots, so the
        // refine path re-fetches stored CDN URLs (24h window) and re-
        // sends them alongside the corrected text. Mirrors the
        // break_price branch below. If every URL has expired (rare —
        // captures get resolved within hours), the model still gets the
        // narrative + correction and we surface fetch errors in the
        // debug line.
        const attachments = (pending.source_attachments ?? []) as Array<{ url: string; filename: string; content_type: string | null }>;
        const images: BreakPriceImage[] = [];
        const fetchErrors: string[] = [];
        for (let idx = 0; idx < attachments.length; idx++) {
          const a = attachments[idx];
          try {
            const res = await fetch(a.url);
            if (!res.ok) {
              fetchErrors.push(`image ${idx + 1}: HTTP ${res.status}${res.status === 404 ? ' (CDN URL expired)' : ''}`);
              continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > PER_IMAGE_BYTE_CAP) {
              fetchErrors.push(`image ${idx + 1}: oversized`);
              continue;
            }
            const sniffed = sniffImageMediaType(buf);
            if (!sniffed) {
              fetchErrors.push(`image ${idx + 1}: format not recognized`);
              continue;
            }
            images.push({ base64: buf.toString('base64'), mediaType: sniffed });
          } catch (err) {
            fetchErrors.push(`image ${idx + 1}: ${err instanceof Error ? err.message : 'fetch failed'}`);
          }
        }

        const res = await parseInsights({
          narrative: pending.source_text,
          images,
          refineCorrection: correction,
        });
        updates = res.updates;
        debugLine = `rosterSize=${res.debug.rosterSize}, parsedRaw=${res.debug.parsedRawCount}, images=${images.length}, drops=${res.debug.droppedReasons.length}`;
        if (fetchErrors.length > 0) {
          debugLine += `, fetch-errors=${fetchErrors.length}`;
        }
      } else {
        // /break-price re-parse. Re-fetch the stored CDN URLs (24h
        // window), sniff bytes, send to Claude with the correction as
        // additional `notes`. If CDN URLs have expired (rare — captures
        // get resolved within hours), bail with a clear error.
        const attachments = (pending.source_attachments ?? []) as Array<{ url: string; filename: string; content_type: string | null }>;
        const images: BreakPriceImage[] = [];
        const fetchErrors: string[] = [];
        for (let idx = 0; idx < attachments.length; idx++) {
          const a = attachments[idx];
          try {
            const res = await fetch(a.url);
            if (!res.ok) {
              fetchErrors.push(`image ${idx + 1}: HTTP ${res.status}${res.status === 404 ? ' (CDN URL expired — re-submit the capture)' : ''}`);
              continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > PER_IMAGE_BYTE_CAP) {
              fetchErrors.push(`image ${idx + 1}: oversized`);
              continue;
            }
            const sniffed = sniffImageMediaType(buf);
            if (!sniffed) {
              fetchErrors.push(`image ${idx + 1}: format not recognized`);
              continue;
            }
            images.push({ base64: buf.toString('base64'), mediaType: sniffed });
          } catch (err) {
            fetchErrors.push(`image ${idx + 1}: ${err instanceof Error ? err.message : 'fetch failed'}`);
          }
        }

        if (attachments.length > 0 && fetchErrors.length === attachments.length) {
          await editChannelMessage(interaction.channel_id, messageId, {
            content: `${baseContent}\n\n— ✏️ **Refine by @${handle} failed:** every screenshot URL is unreachable (likely expired). Re-submit \`/break-price\` with the screenshots + the corrected narrative.\n${fetchErrors.slice(0, 3).join(' · ')}`,
          }).catch(err => console.error('[discord/refine] message edit failed', err));
          return;
        }

        const res = await parseBreakPrice({
          narrative: pending.source_text,
          images,
          // Authoritative override — see parseInsights / route.ts
          // refine branch for the same fix. Previously this was
          // passed as `notes`, which the prompt treats as "additional
          // context" alongside any user-supplied notes from the
          // original slash command — the model didn't know to prefer
          // the correction over the original interpretation.
          refineCorrection: correction,
        });
        updates = res.updates;
        debugLine = `products=${res.debug.productsCount}, parsedRaw=${res.debug.parsedRawCount}, images=${images.length}, drops=${res.debug.droppedReasons.length}`;
        if (fetchErrors.length > 0) {
          debugLine += `, fetch-errors=${fetchErrors.length}`;
        }
      }

      if (updates.length === 0) {
        await editChannelMessage(interaction.channel_id, messageId, {
          content: `${baseContent}\n\n— ✏️ **Refine by @${handle} produced no updates** (${debugLine}). Original proposal preserved.`,
        }).catch(err => console.error('[discord/refine] message edit failed', err));
        return;
      }

      // Replace parsed_updates in place. The pending row itself stays
      // pending so ✅/❌/✏️ keep working against the same id.
      const { error: updErr } = await supabaseAdmin
        .from('pending_insights')
        .update({ parsed_updates: updates as unknown as object })
        .eq('id', pendingId)
        .eq('status', 'pending');

      if (updErr) {
        await editChannelMessage(interaction.channel_id, messageId, {
          content: `${baseContent}\n\n— ✏️ **Refine by @${handle} couldn't stage:** ${updErr.message}`,
        }).catch(err => console.error('[discord/refine] message edit failed', err));
        return;
      }

      // Render the refined proposal panel. Re-uses the same shape as the
      // original — proposed lines + ✅/✏️/❌ buttons — but with a refine
      // note at the top so the user sees what changed.
      const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
      const { header: targetsHeader } = buildTargetsHeader(updates);
      const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
      const wrapping =
        `**Refined by @${handle}** — _${correction.slice(0, 200)}_\n\n` +
        targetsBlock +
        `**Proposed (${updates.length}):**\n\n\n` +
        `Click ✅ to apply, ✏️ to refine again, ❌ to discard.`;
      const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);

      await editChannelMessage(interaction.channel_id, messageId, {
        content:
          `**Refined by @${handle}** — _${correction.slice(0, 200)}_\n\n` +
          targetsBlock +
          `**Proposed (${updates.length}):**\n${summary}\n\n` +
          `Click ✅ to apply, ✏️ to refine again, ❌ to discard.`,
        components: [
          {
            type: ComponentType.ACTION_ROW,
            components: [
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SUCCESS,
                label: 'Apply',
                custom_id: `confirm:${pendingId}`,
                emoji: { name: '✅' },
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.SECONDARY,
                label: 'Refine',
                custom_id: `refine:${pendingId}`,
                emoji: { name: '✏️' },
              },
              {
                type: ComponentType.BUTTON,
                style: ButtonStyle.DANGER,
                label: 'Discard',
                custom_id: `discard:${pendingId}`,
                emoji: { name: '❌' },
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('[discord/refine] re-parse failed', err);
      await editChannelMessage(interaction.channel_id, messageId, {
        content: `${baseContent}\n\n— ✏️ **Refine by @${handle} errored:** ${err instanceof Error ? err.message : 'unknown'}`,
      }).catch(err2 => console.error('[discord/refine] error-edit failed', err2));
    }
  });

  return NextResponse.json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
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
          // Risk flags are player-global now (2026-06-02 re-model) — one row
          // keyed by player_id, no fan-out across the player's products. Full
          // source attribution preserved for downstream analytics.
          const { error } = await supabaseAdmin.from('player_risk_flags').insert({
            player_id: u.player_id,
            flag_type: u.flag_type,
            note: u.note,
            source_pending_id: args.pendingId,
            source_user_id: args.sourceUserId,
            source_narrative: args.sourceText,
            confidence: u.confidence,
          });
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
