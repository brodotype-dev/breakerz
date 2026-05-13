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
import { parseInsights, parseBreakPrice, summarizeUpdate, type ParsedUpdate } from '@/lib/insights-parser';

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

  return NextResponse.json({ error: 'unsupported interaction' }, { status: 400 });
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

interface SlashCommandInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  data: {
    name: string;
    // option.type 11 is ATTACHMENT — value is the attachment id, resolved
    // via data.resolved.attachments. Other option types have string values.
    options?: Array<{ name: string; value: string; type?: number }>;
    resolved?: {
      attachments?: Record<string, DiscordAttachment>;
    };
  };
}

async function handleSlashCommand(interaction: SlashCommandInteraction): Promise<NextResponse> {
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

      const summary = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`).join('\n');
      const handle = user.global_name ?? user.username;

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Insight from @${handle}:**\n> ${narrative.slice(0, 240)}\n\n` +
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

      const { updates, debug } = await parseBreakPrice({ narrative, notes, imageBase64, imageMediaType });

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

      const summary = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`).join('\n');
      const handle = user.global_name ?? user.username;
      const sourceLabel = narrative
        ? `> ${narrative.slice(0, 240)}${attachment ? ` _(+ screenshot)_` : ''}`
        : `_(screenshot only: ${attachment?.filename})_`;

      await editInteractionResponse(interaction.application_id, interaction.token, {
        content:
          `**Slot ask from @${handle}:**\n${sourceLabel}\n\n` +
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
                  format: u.format,
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
                    format: u.format,
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
