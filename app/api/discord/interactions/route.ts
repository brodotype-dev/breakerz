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
      const updates = await parseInsights({ narrative });

      if (updates.length === 0) {
        await editInteractionResponse(interaction.application_id, interaction.token, {
          content: `❓ I couldn't extract any structured updates from:\n> ${narrative.slice(0, 200)}\n\nTry naming specific players or products.`,
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
          parsed_updates: updates,
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

  if (action === 'discard') {
    await supabaseAdmin
      .from('pending_insights')
      .update({ status: 'discarded', resolved_at: new Date().toISOString() })
      .eq('id', pendingId)
      .eq('status', 'pending');

    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: `${interaction.message.content}\n\n— ❌ **Discarded** by @${user.global_name ?? user.username}`,
        components: [],
      },
    });
  }

  if (action === 'confirm') {
    const updates = pending.parsed_updates as ParsedUpdate[];
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

    return NextResponse.json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content:
          `${interaction.message.content}\n\n— ✅ **Applied** by @${user.global_name ?? user.username}: ` +
          `${result.applied} of ${updates.length} updates committed.` +
          (result.errors.length > 0 ? `\nErrors: ${result.errors.slice(0, 3).join('; ')}` : ''),
        components: [],
      },
    });
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
          // Apply the breakerz_score to ALL player_products for this player —
          // mirrors the global BreakIQ Bets behavior.
          const { error } = await supabaseAdmin
            .from('player_products')
            .update({
              breakerz_score: u.score,
              breakerz_note: u.note || null,
            })
            .eq('player_id', u.player_id);
          if (error) throw error;
          applied++;
          break;
        }
        case 'risk_flag': {
          // player_risk_flags rows are scoped to player_product, so we
          // create one per player_product the player appears in.
          const { data: pps } = await supabaseAdmin
            .from('player_products')
            .select('id')
            .eq('player_id', u.player_id);

          if (!pps?.length) throw new Error('no player_products for this player');

          const rows = pps.map(pp => ({
            player_product_id: pp.id,
            flag_type: u.flag_type,
            note: u.note,
          }));
          const { error } = await supabaseAdmin.from('player_risk_flags').insert(rows);
          if (error) throw error;
          applied++;
          break;
        }
        case 'asking_price':
        case 'hype_tag': {
          const payload =
            u.kind === 'asking_price'
              ? {
                  format: u.format,
                  price_low: u.price_low,
                  price_high: u.price_high,
                }
              : {
                  tag: u.tag,
                  strength: u.strength,
                  decay_days: u.decay_days,
                };

          const expiresAt = new Date(
            Date.now() +
              (u.kind === 'hype_tag'
                ? Math.max(1, u.decay_days) * 24 * 3600 * 1000
                : 14 * 24 * 3600 * 1000),
          ).toISOString();

          const { error } = await supabaseAdmin.from('market_observations').insert({
            observation_type: u.kind,
            scope_type: u.scope_type,
            scope_id: u.scope_type === 'player' ? u.scope_player_id : null,
            scope_team: u.scope_type === 'team' ? u.scope_team : null,
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
