import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getManufacturerDescriptor } from '@/lib/card-knowledge';
import { aggregatePlayerEV, type AnchorStrategy, type VariantEV } from '@/lib/pricing-anchors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Conversational anchor-strategy configurator backend.
 *
 * Actions:
 *  - `propose`: take a chat message history + current strategy/patterns, ask Claude
 *               for an updated proposal (strategy, patterns, rationale). Also runs
 *               the preview against the proposal so the UI can render numbers immediately.
 *  - `preview`: run `aggregatePlayerEV` against cached variant prices for a hypothetical
 *               strategy/patterns combo without invoking Claude.
 *  - `save`:    persist `(anchor_strategy, anchor_variant_patterns, anchor_config_notes)`
 *               to the product row.
 *
 * Plan: docs/plans/2026-05-11-per-product-anchor-configurator.md
 */

type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface ProposeBody {
  productId: string;
  action: 'propose';
  messages: ChatMessage[];
}

interface PreviewBody {
  productId: string;
  action: 'preview';
  strategy: AnchorStrategy;
  patterns: string[];
}

interface SaveBody {
  productId: string;
  action: 'save';
  strategy: AnchorStrategy;
  patterns: string[];
  notes: string | null;
}

type Body = ProposeBody | PreviewBody | SaveBody;

interface PreviewPlayerRow {
  playerProductId: string;
  playerName: string | null;
  currentEvMid: number;
  proposedEvMid: number;
  proposedMatched: number;
  proposedFellBack: boolean;
}

interface ProposalPayload {
  strategy: AnchorStrategy;
  patterns: string[];
  notes: string;
  rationale: string;
}

export async function POST(req: NextRequest) {
  const ok = await checkRole('admin', 'contributor');
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body?.productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  if (body.action === 'save') {
    return saveAnchorConfig(body);
  }
  if (body.action === 'preview') {
    return runPreview(body.productId, body.strategy, body.patterns);
  }
  if (body.action === 'propose') {
    return proposeAnchorConfig(body);
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

// --- Save ---------------------------------------------------------------

async function saveAnchorConfig(body: SaveBody) {
  if (!isValidStrategy(body.strategy)) {
    return NextResponse.json({ error: 'invalid strategy' }, { status: 400 });
  }
  if (!Array.isArray(body.patterns)) {
    return NextResponse.json({ error: 'patterns must be array' }, { status: 400 });
  }
  // Validate each pattern compiles. We do this both client and server so a bad
  // pattern can never reach pricing-refresh.
  for (const p of body.patterns) {
    if (typeof p !== 'string') {
      return NextResponse.json({ error: 'patterns must be strings' }, { status: 400 });
    }
    try { new RegExp(p, 'i'); } catch (err) {
      return NextResponse.json({ error: `invalid regex: ${p} (${err instanceof Error ? err.message : 'unknown'})` }, { status: 400 });
    }
  }

  const { error } = await supabaseAdmin
    .from('products')
    .update({
      anchor_strategy: body.strategy,
      anchor_variant_patterns: body.patterns,
      anchor_config_notes: body.notes ?? null,
    })
    .eq('id', body.productId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Run a fresh preview so the UI can confirm the new config takes effect on next refresh.
  return runPreview(body.productId, body.strategy, body.patterns);
}

// --- Preview ------------------------------------------------------------

async function runPreview(productId: string, strategy: AnchorStrategy, patterns: string[]) {
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, anchor_strategy, anchor_variant_patterns')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const currentStrategy = (product.anchor_strategy ?? 'sets_weighted_all') as AnchorStrategy;
  const currentPatterns: string[] = Array.isArray(product.anchor_variant_patterns)
    ? (product.anchor_variant_patterns as string[])
    : [];

  // Top 5 players by cached ev_mid — these are the rows where a pricing shift will be most visible.
  const { data: topRows } = await supabaseAdmin
    .from('player_products')
    .select('id, player:players(id, name), pricing_cache!inner(ev_mid)')
    .eq('product_id', productId)
    .eq('insert_only', false)
    .order('ev_mid', { ascending: false, foreignTable: 'pricing_cache' })
    .limit(5);

  type Row = {
    id: string;
    player: { id: string; name: string } | { id: string; name: string }[] | null;
    pricing_cache: { ev_mid: number } | { ev_mid: number }[] | null;
  };
  const ppIds = ((topRows ?? []) as unknown as Row[]).map(r => r.id);
  if (ppIds.length === 0) {
    return NextResponse.json({ players: [] as PreviewPlayerRow[] });
  }

  // Pull variants for these specific player_products (with prices via ch_price_cache lookup).
  const { data: variantRows } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, player_product_id, cardhedger_card_id, variant_name, hobby_sets, bd_only_sets, jumbo_sets, hobby_odds, print_run')
    .in('player_product_id', ppIds)
    .not('cardhedger_card_id', 'is', null);

  type VRow = {
    id: string;
    player_product_id: string;
    cardhedger_card_id: string;
    variant_name: string | null;
    hobby_sets: number | null;
    bd_only_sets: number | null;
    jumbo_sets: number | null;
    hobby_odds: number | null;
    print_run: number | null;
  };
  const variants = (variantRows ?? []) as VRow[];
  const cardIds = Array.from(new Set(variants.map(v => v.cardhedger_card_id)));

  const { data: priceRows } = await supabaseAdmin
    .from('ch_price_cache')
    .select('cardhedger_card_id, raw_price, psa9_price, psa10_price, confidence')
    .in('cardhedger_card_id', cardIds);
  type PriceRow = {
    cardhedger_card_id: string;
    raw_price: number | null;
    psa9_price: number | null;
    psa10_price: number | null;
    confidence: number | null;
  };
  const priceByCard = new Map<string, PriceRow>();
  for (const r of (priceRows ?? []) as PriceRow[]) priceByCard.set(r.cardhedger_card_id, r);

  const variantsByPp = new Map<string, VRow[]>();
  for (const v of variants) {
    const list = variantsByPp.get(v.player_product_id) ?? [];
    list.push(v);
    variantsByPp.set(v.player_product_id, list);
  }

  const result: PreviewPlayerRow[] = [];
  for (const row of (topRows ?? []) as unknown as Row[]) {
    const playerObj = Array.isArray(row.player) ? row.player[0] : row.player;
    const pc = Array.isArray(row.pricing_cache) ? row.pricing_cache[0] : row.pricing_cache;
    const ppVariants = variantsByPp.get(row.id) ?? [];

    const aggregatable = ppVariants.filter(v => v.print_run == null || v.print_run > 1);
    const variantEVs: VariantEV[] = aggregatable.map(v => {
      const pr = priceByCard.get(v.cardhedger_card_id);
      const raw  = pr?.raw_price  != null && pr.raw_price  > 0 ? pr.raw_price  : null;
      const mid  = pr?.psa9_price != null && pr.psa9_price > 0 ? pr.psa9_price : raw;
      const high = pr?.psa10_price != null && pr.psa10_price > 0 ? pr.psa10_price : null;
      const evMid  = mid ?? 0;
      const evLow  = raw ?? Math.round(evMid * 0.35);
      const evHigh = high ?? Math.round(evMid * 2.5);
      const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0) + (v.jumbo_sets ?? 0);
      return {
        variantId: v.id,
        variantName: v.variant_name,
        evLow: Math.round(evLow),
        evMid: Math.round(evMid),
        evHigh: Math.round(evHigh),
        confidence: pr?.confidence ?? 0,
        sets: Math.max(sets, 1),
        hobbyOdds: v.hobby_odds,
        printRun: v.print_run,
      };
    });

    const current  = aggregatePlayerEV(variantEVs, currentStrategy,  currentPatterns);
    const proposed = aggregatePlayerEV(variantEVs, strategy,         patterns);

    result.push({
      playerProductId: row.id,
      playerName: playerObj?.name ?? null,
      currentEvMid: current.evMid || pc?.ev_mid || 0,
      proposedEvMid: proposed.evMid,
      proposedMatched: proposed.matchedVariants,
      proposedFellBack: proposed.fellBack,
    });
  }
  return NextResponse.json({ players: result });
}

// --- Propose (Claude call) ----------------------------------------------

async function proposeAnchorConfig(body: ProposeBody) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, name, year, lifecycle_status, anchor_strategy, anchor_variant_patterns, anchor_config_notes')
    .eq('id', body.productId)
    .single();
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 });

  const descriptor = getManufacturerDescriptor(product.name);

  // Sample 20 representative variant_name strings so Claude sees the actual catalog vocabulary.
  // De-duplicated and shuffled so we don't bias toward one section of the alphabet.
  const { data: variantSample } = await supabaseAdmin
    .from('player_product_variants')
    .select('variant_name, player_product:player_products!inner(product_id)')
    .eq('player_product.product_id', body.productId)
    .not('variant_name', 'is', null)
    .limit(200);
  const distinctVariantNames = Array.from(
    new Set(
      ((variantSample ?? []) as { variant_name: string | null }[])
        .map(r => r.variant_name?.trim())
        .filter((s): s is string => !!s),
    ),
  ).slice(0, 20);

  const systemPrompt = buildSystemPrompt({
    productName: product.name,
    productYear: product.year ?? null,
    lifecycle: product.lifecycle_status ?? null,
    descriptorName: descriptor.name,
    anchorConcepts: descriptor.anchorConcepts ?? [],
    sampleVariants: distinctVariantNames,
    currentStrategy: (product.anchor_strategy ?? 'sets_weighted_all') as AnchorStrategy,
    currentPatterns: Array.isArray(product.anchor_variant_patterns) ? (product.anchor_variant_patterns as string[]) : [],
    currentNotes: product.anchor_config_notes ?? null,
  });

  const claudeMessages = (body.messages ?? []).filter(m => m?.role && typeof m?.content === 'string');
  if (claudeMessages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1536,
    system: systemPrompt,
    messages: claudeMessages.map(m => ({ role: m.role, content: m.content })),
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();

  // Claude is instructed to return strict JSON. Be defensive: locate the first {...} block.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({
      error: 'no JSON in response',
      rawResponse: raw.slice(0, 600),
    }, { status: 502 });
  }

  let parsed: ProposalPayload;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return NextResponse.json({
      error: `JSON parse failed: ${err instanceof Error ? err.message : 'unknown'}`,
      rawResponse: raw.slice(0, 600),
    }, { status: 502 });
  }

  // Sanity-validate the proposal before previewing it.
  if (!isValidStrategy(parsed.strategy)) {
    return NextResponse.json({
      error: `Claude returned invalid strategy: ${String(parsed.strategy)}`,
      rawResponse: raw.slice(0, 600),
    }, { status: 502 });
  }
  if (!Array.isArray(parsed.patterns)) parsed.patterns = [];
  // Drop any pattern that doesn't compile to a regex.
  parsed.patterns = parsed.patterns.filter(p => {
    if (typeof p !== 'string') return false;
    try { new RegExp(p, 'i'); return true; } catch { return false; }
  });

  // Always include a preview alongside the proposal so the UI can render numbers immediately.
  const previewResp = await runPreview(body.productId, parsed.strategy, parsed.patterns);
  const preview = await previewResp.json();

  return NextResponse.json({
    proposal: parsed,
    preview,
    descriptorId: descriptor.id,
    descriptorName: descriptor.name,
  });
}

function buildSystemPrompt(args: {
  productName: string;
  productYear: number | null;
  lifecycle: string | null;
  descriptorName: string;
  anchorConcepts: { name: string; example: string; description?: string }[];
  sampleVariants: string[];
  currentStrategy: AnchorStrategy;
  currentPatterns: string[];
  currentNotes: string | null;
}): string {
  const conceptsBlock = args.anchorConcepts.length === 0
    ? '(no manufacturer-specific anchor concepts defined — propose patterns purely from the variant sample.)'
    : args.anchorConcepts.map(c => `- ${c.name} — example: "${c.example}"${c.description ? ` — ${c.description}` : ''}`).join('\n');

  const sampleBlock = args.sampleVariants.length === 0
    ? '(no variants imported yet — patterns cannot be previewed until checklist is loaded.)'
    : args.sampleVariants.map(v => `  - ${v}`).join('\n');

  return `You configure per-product pricing anchor strategies for BreakIQ — a sports card break slot pricing tool.

PRODUCT
- Name: ${args.productName}
- Year: ${args.productYear ?? 'unknown'}
- Lifecycle: ${args.lifecycle ?? 'unknown'}
- Manufacturer family: ${args.descriptorName}

ANCHOR CONCEPTS FOR THIS MANUFACTURER
${conceptsBlock}

SAMPLE OF ACTUAL VARIANT NAMES FROM THIS PRODUCT
${sampleBlock}

CURRENT CONFIGURATION
- strategy: ${args.currentStrategy}
- patterns: ${JSON.stringify(args.currentPatterns)}
- notes: ${args.currentNotes ?? '(none)'}

YOUR JOB
The admin will describe in plain English which variants should anchor slot pricing for this product. Your job is to translate that into a strategy + regex patterns.

STRATEGIES
- sets_weighted_all: count every priced variant, sets-weighted average. The default. Use when the long tail of parallels has reliable CH comps (e.g. Bowman Chrome base, Topps Series 1/2).
- curated_variants: filter to variants whose variant_name matches any of the regex patterns; sets-weighted average over those only. Use when long-tail variants have thin comps and shouldn't drive slot price.
- curated_with_tail: same as curated_variants, plus a fixed +15% tail bonus representing long-tail option value. Use when curated variants are the primary anchor but the long tail still has some value.

PATTERN RULES
- Patterns are JavaScript regex strings, tested case-insensitively against variant_name with .test().
- Match the cleaned variant_name (no leading/trailing whitespace).
- Use ^ and $ anchors when you mean an exact phrase. Use .* for "any tail".
- Examples: ^Base Autograph$ matches exactly "Base Autograph". Gold Refractor.* matches "Gold Refractor", "Gold Refractor Autograph", "Gold Refractor /50".

OUTPUT
Reply with exactly one JSON object. No prose before or after. Shape:
{
  "strategy": "sets_weighted_all" | "curated_variants" | "curated_with_tail",
  "patterns": ["regex1", "regex2"],
  "notes": "1-3 sentences summarizing this config so a future reader knows why these patterns were chosen.",
  "rationale": "1-2 sentences explaining what you changed and why, addressed to the admin."
}

DEFENSIVE RULES
- If the admin hasn't given you enough info to commit, propose curated_with_tail with the most conservative concept patterns from the manufacturer's anchor concepts and explain what else you'd need in rationale.
- If the admin's intent is to revert to defaults, propose sets_weighted_all with patterns: [].
- NEVER fabricate variant names that aren't in the sample. Patterns must match the sample's actual vocabulary.
- If the sample is empty, return sets_weighted_all with patterns: [] and a rationale explaining the product needs checklist data first.`;
}

function isValidStrategy(s: unknown): s is AnchorStrategy {
  return s === 'sets_weighted_all' || s === 'curated_variants' || s === 'curated_with_tail';
}
