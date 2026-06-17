// Shared scrape → parse → stage → proposal-message logic for /url-source
// (web-sourced-intel Slice 4). Both the interaction reply (Slice 4a,
// handleUrlSource) and the recurring cron (Slice 4b,
// refresh-tracked-sources) call scrapeAndStageProposal and then deliver the
// returned message body their own way — the command edits its deferred
// interaction reply, the cron POSTs a fresh channel message.
//
// The two pure proposal-formatting helpers (formatProposalSummary,
// buildTargetsHeader) live here so this module can build the panel without
// importing from the route handler; the route re-imports them.

import { supabaseAdmin } from '@/lib/supabase';
import { scrapeEditorial } from '@/lib/scrapers/editorial';
import {
  parseInsights,
  summarizeUpdate,
  type ParsedUpdate,
  type ParseResult,
} from '@/lib/insights-parser';
import { ComponentType, ButtonStyle } from '@/lib/discord';
import { renderComposition } from '@/lib/observation-ranking';

/**
 * Discord caps message `content` at 2000 chars. A capture from a dense web
 * page can yield a dozen-plus rows that trip that limit. Build the proposal
 * summary defensively: walk rows in order, stop when the next row would push
 * past the budget, append a "+ N more" note.
 *
 * Returns the formatted block ready to drop into the message; the caller is
 * responsible for budgeting space for any wrapping text (header / source /
 * buttons hint) and passing that subtracted from 2000.
 */
export function formatProposalSummary(
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
 * Builds the "Writing to" header that surfaces which product(s) the proposed
 * updates will write to. Critical for review — multiple "2026 Bowman Baseball"
 * entries can exist in the products table, and contributors need to verify
 * Claude routed to the right one BEFORE clicking ✅. Shows full UUID so
 * admins can grep / cross-reference against the products table.
 *
 * Walks updates, dedupes by product_id, sorts by descending count so the
 * most-targeted product appears first. Updates without a product_id
 * (sentiment global, risk_flag, team_sentiment) are excluded.
 */
export function buildTargetsHeader(
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

/**
 * Full proposed-updates list as a Markdown table, for attaching to a proposal
 * whose inline preview truncated (Discord's 2000-char cap). The reviewer can
 * scan EVERY row's resolved DB targets — product (+ product_id), scope, the
 * resolved team / player name, the player_id, composition, price — before
 * clicking ✅. The ✅ already applies the full staged set; this is purely for
 * verification, not correctness.
 */
export function buildProposalMarkdown(updates: ParsedUpdate[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const esc = (v: any): string => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const out: string[] = [];
  out.push(`# Proposed updates (${updates.length})`);
  out.push('');
  out.push('Every staged row. Clicking ✅ on the Discord proposal applies all of them.');
  out.push('');
  out.push('| # | kind | product | product_id | scope | target | target_id | composition | price | source |');
  out.push('|--:|------|---------|------------|-------|--------|-----------|-------------|-------|--------|');
  updates.forEach((u, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = u as Record<string, any>;
    const kind = r.kind ?? '';
    const product = r.product_name ?? '';
    const productId = r.product_id ?? '';
    const scope = r.scope_type ?? r.scope ?? (kind === 'team_sentiment' ? 'team' : '');
    const target = r.scope_team ?? r.scope_player_name ?? r.player_name ?? r.team_name ?? r.variant_name ?? '';
    const targetId = r.scope_player_id ?? r.player_id ?? '';
    const comp = r.composition ? renderComposition(r.composition) : '';
    const price =
      r.price_low != null
        ? (r.price_low === r.price_high ? `$${r.price_low}` : `$${r.price_low}–$${r.price_high}`)
        : '';
    const source = r.source ?? '';
    out.push(
      `| ${i + 1} | ${esc(kind)} | ${esc(product)} | \`${esc(productId)}\` | ${esc(scope)} | ${esc(target)} | ${targetId ? `\`${esc(targetId)}\`` : ''} | ${esc(comp)} | ${esc(price)} | ${esc(source)} |`,
    );
  });
  return out.join('\n');
}

export interface ProposalMessageBody {
  content: string;
  components: unknown[];
  // Discord message-body shape — index signature lets this satisfy the
  // Record<string, unknown> param of createChannelMessage / editInteractionResponse.
  [key: string]: unknown;
}

/**
 * Render the ✅/✏️/❌ proposal panel for a staged /url-source pending_insights
 * row. Identical shape across the command reply and the cron post.
 *
 * `submitterLabel` is rendered verbatim into the source line — the command
 * passes "@handle" (it has the user object); the cron passes a "<@id>"
 * mention (it only has the stored discord user id).
 */
export function buildUrlSourceProposalMessage(opts: {
  updates: ParsedUpdate[];
  pendingId: string;
  url: string;
  scheduleLine: string;
  submitterLabel: string;
}): ProposalMessageBody {
  const { updates, pendingId, url, scheduleLine, submitterLabel } = opts;
  const lines = updates.map((u, i) => `**${i + 1}.** ${summarizeUpdate(u)}`);
  const { header: targetsHeader } = buildTargetsHeader(updates);
  const targetsBlock = targetsHeader ? `${targetsHeader}\n\n` : '';
  const sourceLabel = `> 📎 ${url}\n_(${scheduleLine}, via ${submitterLabel})_`;
  const wrapping =
    `**URL source:**\n${sourceLabel}\n\n` +
    targetsBlock +
    `**Proposed updates (${updates.length}):**\n\n\n` +
    `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`;
  const { summary } = formatProposalSummary(lines, 2000 - wrapping.length);
  return {
    content:
      `**URL source:**\n${sourceLabel}\n\n` +
      targetsBlock +
      `**Proposed updates (${updates.length}):**\n${summary}\n\n` +
      `Click ✅ to apply, ❌ to discard. Anyone on the allowlist can resolve.`,
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          { type: ComponentType.BUTTON, style: ButtonStyle.SUCCESS, label: 'Apply', custom_id: `confirm:${pendingId}`, emoji: { name: '✅' } },
          { type: ComponentType.BUTTON, style: ButtonStyle.SECONDARY, label: 'Refine', custom_id: `refine:${pendingId}`, emoji: { name: '✏️' } },
          { type: ComponentType.BUTTON, style: ButtonStyle.DANGER, label: 'Discard', custom_id: `discard:${pendingId}`, emoji: { name: '❌' } },
        ],
      },
    ],
  };
}

export type ScrapeStageResult =
  | { staged: true; pendingId: string; body: ProposalMessageBody; updateCount: number }
  | {
      staged: false;
      reason: 'no_updates';
      scrapedChars: number;
      scrapedPreview: string;
      debug: ParseResult['debug'];
    };

/**
 * Scrape a URL, parse it in web-source mode, and (when it yields updates)
 * stage a pending_insights proposal row. Returns the rendered proposal body
 * the caller delivers. Throws on scrape failure or staging failure — callers
 * catch and record last_error / surface the message.
 *
 * Does NOT post anything or touch tracked_sources scheduling — delivery +
 * bookkeeping stay with each caller (the command edits its interaction reply;
 * the cron posts to the channel + advances next_scrape_at).
 */
export async function scrapeAndStageProposal(opts: {
  url: string;
  note: string | null;
  channelId: string;
  submittedBy: string;
  scheduleLine: string;
  submitterLabel: string;
}): Promise<ScrapeStageResult> {
  const { url, note, channelId, submittedBy, scheduleLine, submitterLabel } = opts;

  const page = await scrapeEditorial(url); // throws on failure → caller catches
  const markdown = note ? `${page.markdown}\n\n[contributor note: ${note}]` : page.markdown;

  const { updates, debug } = await parseInsights({ narrative: markdown, webSource: true });

  if (updates.length === 0) {
    // Surface a snippet of what we actually SCRAPED so "empty because the
    // page was thin / paywalled" is distinguishable from "empty because the
    // parser was too conservative."
    const scrapedPreview = markdown.replace(/```/g, "'''").replace(/\s+/g, ' ').trim().slice(0, 400);
    return { staged: false, reason: 'no_updates', scrapedChars: markdown.length, scrapedPreview, debug };
  }

  const { data: pending, error } = await supabaseAdmin
    .from('pending_insights')
    .insert({
      discord_channel_id: channelId,
      source_user_id: submittedBy,
      source_text: url,
      parsed_updates: updates as unknown as object,
      source_kind: 'tracked_source_scrape',
      source_attachments: null,
    })
    .select('id')
    .single();

  if (error || !pending) {
    throw new Error(`couldn't stage updates: ${error?.message ?? 'unknown error'}`);
  }

  const body = buildUrlSourceProposalMessage({
    updates,
    pendingId: pending.id,
    url,
    scheduleLine,
    submitterLabel,
  });

  return { staged: true, pendingId: pending.id, body, updateCount: updates.length };
}
