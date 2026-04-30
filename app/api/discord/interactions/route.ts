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
import { parseInsights, summarizeUpdate, type ParsedUpdate } from '@/lib/insights-parser';

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

interface SlashCommandInteraction {
  application_id: string;
  token: string;
  channel_id: string;
  member?: { user: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  data: {
    name: string;
    options?: Array<{ name: string; value: string }>;
  };
}

async function handleSlashCommand(interaction: SlashCommandInteraction): Promise<NextResponse> {
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
      }
    } catch (err) {
      errors.push(`${u.kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { applied, errors };
}
