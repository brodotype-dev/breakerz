// Editorial-content parser — Slice 3 (Bucket A).
//
// Takes the markdown of a scraped editorial page (Beckett product news,
// Topps blog, break preview, etc.) for a KNOWN product and extracts
// product/team/player hype + sentiment. Unlike parseInsights (tuned for
// SME debrief narratives), this is tuned for published editorial copy.
//
// Emits ONLY market-observation kinds — product_sentiment, team_sentiment,
// team_product_sentiment, hype_tag. It deliberately does NOT emit the
// 'sentiment' kind (which writes player_products.breakerz_score, the Track B
// SME score) — editorial is a distinct source and must not clobber SME
// sentiment. It also never emits asking_price / odds_observation (editorial
// doesn't carry trustworthy prices and we won't fabricate them).
//
// Roster-aware: player + team references are validated against the players
// in THIS product, so a mention of someone not in the set is dropped rather
// than invented.

import { supabaseAdmin } from './supabase';
import type { ParsedUpdate } from './insights-parser';

// The four kinds editorial is allowed to produce.
export type EditorialUpdate = Extract<
  ParsedUpdate,
  { kind: 'product_sentiment' } | { kind: 'team_sentiment' } | { kind: 'team_product_sentiment' } | { kind: 'hype_tag' }
>;

export interface EditorialParseResult {
  updates: EditorialUpdate[];
  debug: {
    rosterSize: number;
    rawResponseExcerpt: string;
    parsedRawCount: number;
    droppedReasons: string[];
  };
}

interface ProductContext {
  id: string;
  name: string;
  year: number | null;
}

export async function parseEditorial(args: {
  markdown: string;
  product: ProductContext;
  sourceUrl: string;
}): Promise<EditorialParseResult> {
  const { markdown, product } = args;

  const baseDebug = { rosterSize: 0, rawResponseExcerpt: '', parsedRawCount: 0, droppedReasons: [] as string[] };
  if (!markdown.trim()) {
    return { updates: [], debug: { ...baseDebug, rawResponseExcerpt: 'empty markdown' } };
  }

  // Roster = the players in THIS product (id, name, team). Editorial about a
  // product references players who are in it; validating against the product
  // roster keeps the parser from attaching signal to players we don't carry.
  const players: Array<{ id: string; name: string; team: string }> = [];
  {
    const seen = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('player_products')
        .select('player:players!inner(id, name, team)')
        .eq('product_id', product.id)
        .eq('insert_only', false)
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[editorial-parser] roster query failed:', error);
        break;
      }
      if (!data || data.length === 0) break;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of data as any[]) {
        const p = Array.isArray(row.player) ? row.player[0] : row.player;
        if (!p || seen.has(p.id) || !p.name) continue;
        seen.add(p.id);
        players.push({ id: p.id, name: p.name, team: p.team ?? '' });
      }
      if (data.length < PAGE) break;
    }
  }

  const teams = [...new Set(players.map(p => p.team).filter(Boolean))].sort();
  const playerLines = players.map(p => `- ${p.name} (${p.team || 'N/A'}) [id: ${p.id}]`).join('\n');
  const teamLines = teams.map(t => `- ${t}`).join('\n');

  const prompt = `You are extracting market signal from a published sports-card EDITORIAL page (e.g. Beckett product news, Topps blog, a break preview). The article is about this product:

Product: ${product.year ?? ''} ${product.name} [id: ${product.id}]

Players in this product (use ids exactly; only these are valid for player-scoped output):
${playerLines || '(none loaded)'}

Teams in this product (valid team names):
${teamLines || '(none loaded)'}

Editorial content (markdown):
"""
${markdown}
"""

Extract zero or more observations. You may ONLY emit these four kinds:

1. PRODUCT_SENTIMENT — an overall take on this product. "Loaded rookie class", "this is the chase set of Q1", "underwhelming checklist". Output:
   { "kind": "product_sentiment", "product_id": "${product.id}", "product_name": "${product.name}",
     "direction": 1 | -1, "strength": 0.0..1.0, "decay_days": 30..90,
     "tag": "loaded_class",  // optional free-text
     "source_note": "<short quote/paraphrase>", "confidence": 0.0..1.0 }

2. HYPE_TAG — a specific hype/cooldown pattern. Use ONLY when one of the four canonical labels fits. Output:
   { "kind": "hype_tag", "product_id": "${product.id}", "product_name": "${product.name}",
     "scope_type": "product" | "player",
     "scope_player_id": "...",   // required when scope_type='player'; MUST be an id from the roster above
     "tag": "release_premium" | "cooled" | "overhyped" | "underhyped",
     "strength": 0.0..1.0, "decay_days": 7..45,
     "source_note": "...", "confidence": 0.0..1.0 }
   - "chase parallel" / "hot release" / "everyone wants this" → tag='release_premium'
   - "overhyped" / "prices will fall" → tag='overhyped'
   - "sleeper" / "underrated" → tag='underhyped'
   - "cooling off" / "hype faded" → tag='cooled'

3. TEAM_SENTIMENT — a take on a team across products. "The Orioles farm is stacked". Output:
   { "kind": "team_sentiment", "team_name": "<canonical team from the list above>",
     "direction": 1 | -1, "strength": 0.0..1.0, "decay_days": 30..60,
     "tag": "...", "source_note": "...", "confidence": 0.0..1.0 }

4. TEAM_PRODUCT_SENTIMENT — a team specifically within this product. "Dodgers prospects headline this set". Output:
   { "kind": "team_product_sentiment", "team_name": "<canonical team>", "product_id": "${product.id}", "product_name": "${product.name}",
     "direction": 1 | -1, "strength": 0.0..1.0, "decay_days": 30..60,
     "tag": "...", "source_note": "...", "confidence": 0.0..1.0 }

CRITICAL RULES:
- Output JSON ONLY — a JSON array. No markdown, no prose. If nothing extractable, return exactly: []
- NEVER emit asking_price, odds_observation, or sentiment kinds. NEVER include prices or dollar amounts.
- For player-scoped hype_tag, scope_player_id MUST be an id from the roster. If the article names a player not in the roster, OMIT that observation — do not invent or substitute.
- team_name MUST match a team from the list. Drop team observations for teams not in the list.
- Editorial is opinion/marketing copy — be conservative. Only emit an observation when the article makes a clear directional claim. A neutral factual description (release date, box configuration, checklist size) is NOT a sentiment signal — skip it.
- direction: +1 bullish, -1 bearish. strength scales with how strong the claim is (0.8 = "the chase set of the year"; 0.3 = "solid release").
- source_note: a short paraphrase or quote grounding the observation. Do not fabricate.
- confidence: how unambiguous the editorial claim is.`;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: 25_000 },
  );

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  const debug = { ...baseDebug, rosterSize: players.length, rawResponseExcerpt: raw.slice(0, 600) };

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    return { updates: [], debug: { ...debug, droppedReasons: ['no JSON array in response'] } };
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch (err) {
    return { updates: [], debug: { ...debug, droppedReasons: [`json parse: ${err instanceof Error ? err.message : err}`] } };
  }

  const playerIds = new Set(players.map(p => p.id));
  const teamSet = new Set(teams);
  const allowedKinds = new Set(['product_sentiment', 'hype_tag', 'team_sentiment', 'team_product_sentiment']);
  const allowedTags = new Set(['release_premium', 'cooled', 'overhyped', 'underhyped']);
  const dropped: string[] = [];
  const updates: EditorialUpdate[] = [];

  for (const item of parsed) {
    const u = item as Record<string, unknown>;
    const kind = u.kind as string;
    if (!allowedKinds.has(kind)) {
      dropped.push(`disallowed kind: ${kind}`);
      continue;
    }
    // Force product_id to the known product for product-scoped kinds —
    // never trust a model-supplied product id.
    if (kind === 'product_sentiment' || kind === 'team_product_sentiment' || kind === 'hype_tag') {
      u.product_id = product.id;
      u.product_name = product.name;
    }
    if (kind === 'hype_tag') {
      if (!allowedTags.has(u.tag as string)) {
        dropped.push(`hype_tag bad tag: ${u.tag}`);
        continue;
      }
      if (u.scope_type === 'player') {
        if (typeof u.scope_player_id !== 'string' || !playerIds.has(u.scope_player_id)) {
          dropped.push(`hype_tag player not in roster: ${u.scope_player_id}`);
          continue;
        }
      } else {
        u.scope_type = 'product';
      }
    }
    if (kind === 'team_sentiment' || kind === 'team_product_sentiment') {
      if (typeof u.team_name !== 'string' || !teamSet.has(u.team_name)) {
        dropped.push(`team not in roster: ${u.team_name}`);
        continue;
      }
    }
    updates.push(u as unknown as EditorialUpdate);
  }

  return {
    updates,
    debug: { ...debug, parsedRawCount: parsed.length, droppedReasons: dropped },
  };
}
