/**
 * Multi-output Claude parser for market insights captured via Discord.
 *
 * Today's BreakIQ Bets parser only emits player-sentiment scores. This
 * extends the schema to four update types — sentiment, asking-price,
 * hype-tag, risk-flag — so a single narrative ("Flagg PYP is 12-15k on
 * streams, Wemby is hurt, Bowman Concan crystallized cooled off") can
 * produce all four with one Claude call.
 *
 * Each parsed update is staged into `pending_insights` first, then a
 * human ✅ confirmation applies it to the appropriate backing table.
 */

import { supabaseAdmin } from '@/lib/supabase';

export type ParsedUpdate =
  | {
      kind: 'sentiment';
      player_id: string;
      player_name: string;
      score: number;            // -0.5..0.5, snaps to 0.25 increments client-side
      note: string;
      confidence: number;
    }
  | {
      kind: 'asking_price';
      product_id: string;
      product_name: string;
      scope_type: 'team' | 'player' | 'product';
      scope_team?: string;       // when scope_type='team'
      scope_player_id?: string;  // when scope_type='player'
      format: 'hobby' | 'bd' | 'jumbo';
      price_low: number;
      price_high: number;
      source_note: string;
      confidence: number;
    }
  | {
      kind: 'hype_tag';
      product_id: string;
      product_name: string;
      scope_type: 'team' | 'player' | 'product';
      scope_team?: string;
      scope_player_id?: string;
      tag: 'release_premium' | 'cooled' | 'overhyped' | 'underhyped';
      strength: number;          // 0..1
      decay_days: number;
      source_note: string;
      confidence: number;
    }
  | {
      kind: 'risk_flag';
      player_id: string;
      player_name: string;
      flag_type: 'injury' | 'suspension' | 'legal' | 'trade' | 'retirement' | 'off_field';
      note: string;
      confidence: number;
    };

export interface ParseInput {
  narrative: string;
  // Soft cap on roster size sent to Claude. The full prod catalog is ~3k
  // players which fits easily in Haiku's 200k context (~75k tokens worth).
  // We cap at 5000 as a guard against future growth, and prefer
  // slot-eligible players (insert_only=false) — multi-player insert rows
  // and retired-legend subset cards aren't real targets for sentiment.
  maxPlayers?: number;
}

export interface ParseResult {
  updates: ParsedUpdate[];
  /** Diagnostic info attached to every result so we can debug 0-update returns
   * without log spelunking. The bot reply surfaces this when updates is empty. */
  debug: {
    rosterSize: number;
    productsCount: number;
    rawResponseExcerpt: string;
    parsedRawCount: number;
    droppedReasons: string[];
  };
}

export async function parseInsights({ narrative, maxPlayers = 5000 }: ParseInput): Promise<ParseResult> {
  if (!narrative.trim()) {
    return {
      updates: [],
      debug: { rosterSize: 0, productsCount: 0, rawResponseExcerpt: 'empty narrative', parsedRawCount: 0, droppedReasons: [] },
    };
  }

  // Roster is "every solo player in our DB" — including players who only
  // appear on insert subsets in active products (C.J. Stroud, Wemby on
  // SP-only sets, etc.). Earlier we restricted to slot-eligible players
  // only, but that excluded entities the user actually wanted to talk
  // about, and Claude responded by substituting "the closest match it
  // could find" (CJ Stroud → Shedeur Sanders). Including everyone keeps
  // matches honest; the prompt below tells Claude to OMIT rather than
  // substitute when no match exists.
  //
  // We do exclude multi-player concatenated rows ("Skubal / Blanco")
  // since those aren't real entities and would let Claude attach
  // sentiment to a meaningless aggregate.
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('id, name, year, lifecycle_status')
    .eq('is_active', true)
    .in('lifecycle_status', ['live', 'pre_release']);

  if (prodErr) {
    console.error('[insights-parser] products query failed:', prodErr);
    return {
      updates: [],
      debug: { rosterSize: 0, productsCount: 0, rawResponseExcerpt: `products query: ${prodErr.message}`, parsedRawCount: 0, droppedReasons: [] },
    };
  }

  let players: Array<{ id: string; name: string; team: string; sport: { name: string } | null }> = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error: plErr } = await supabaseAdmin
        .from('players')
        .select('id, name, team, sport:sports(name)')
        .not('name', 'like', '%/%')
        .order('name')
        .range(from, from + PAGE - 1);
      if (plErr) {
        console.error('[insights-parser] players query failed:', plErr);
        break;
      }
      if (!data || data.length === 0) break;
      players.push(...(data as any));
      if (data.length < PAGE || players.length >= maxPlayers) break;
    }
    players = players.slice(0, maxPlayers);
  }

  if (!products?.length || !players?.length) {
    return {
      updates: [],
      debug: {
        rosterSize: players?.length ?? 0,
        productsCount: products?.length ?? 0,
        rawResponseExcerpt: 'no roster fetched',
        parsedRawCount: 0,
        droppedReasons: [],
      },
    };
  }

  const productLines = products
    .map(p => `- ${p.year} ${p.name} [id: ${p.id}]`)
    .join('\n');
  const playerLines = players
    .map((p: any) => `- ${p.name} (${p.team || 'N/A'}, ${(p.sport as any)?.name ?? ''}) [id: ${p.id}]`)
    .join('\n');

  const prompt = `You are parsing a sports card market debrief into structured updates for BreakIQ.

Available products (use product ids exactly):
${productLines}

Available players (use player ids exactly):
${playerLines}

Narrative:
"""
${narrative.trim()}
"""

Extract zero or more updates. Each update is one of four kinds:

1. SENTIMENT — a player is hot/cold for non-obvious reasons (post-game buzz, injury return, etc.). Output:
   { "kind": "sentiment", "player_id": "...", "player_name": "...", "score": 0.3, "note": "...", "confidence": 0.9 }
   score is -0.5 (very bearish) to +0.5 (very bullish).

2. ASKING_PRICE — what streams or sellers are charging. Output:
   { "kind": "asking_price", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product",
     "scope_team": "Dallas Mavericks",  // only when scope_type='team'
     "scope_player_id": "...",          // only when scope_type='player'
     "format": "hobby" | "bd" | "jumbo",
     "price_low": 12000, "price_high": 15000,
     "source_note": "...", "confidence": 0.85 }
   If only one price was mentioned, set price_low=price_high.

3. HYPE_TAG — a temporary premium or cooldown. Output:
   { "kind": "hype_tag", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product", "scope_team"|"scope_player_id": ...,
     "tag": "release_premium" | "cooled" | "overhyped" | "underhyped",
     "strength": 0.7, "decay_days": 14,
     "source_note": "...", "confidence": 0.8 }

4. RISK_FLAG — injury, suspension, trade, retirement, legal, off_field. Output:
   { "kind": "risk_flag", "player_id": "...", "player_name": "...",
     "flag_type": "injury", "note": "...", "confidence": 0.9 }

Return JSON ONLY — a JSON array of update objects. No markdown, no explanation, no text before or after. If nothing extractable, return exactly: []

CRITICAL:
- Use exact ids from the roster lines above — never invent or guess ids.
- For player_name / product_name fields, copy the exact name from the matching roster line so we can verify your match. Common nicknames are fine (Wemby → Victor Wembanyama) — match to the canonical roster name.
- One narrative can produce multiple updates of different kinds.
- DO NOT SUBSTITUTE. If a named player or product isn't in the roster, OMIT that update entirely. Do not pick "the closest match" — wrong attributions are worse than missing ones. Example: if the narrative mentions "Joe Smith" and Joe Smith is not in the roster, drop that update — do not pick John Smith or any other Joe.
- It is fine to return fewer updates than the narrative implies, or even an empty array, if you can't make confident matches.`;

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
  console.log(`[insights-parser] roster=${players.length} products=${products.length} narrative_chars=${narrative.length} raw_response_chars=${raw.length}`);
  console.log(`[insights-parser] raw response (first 800): ${raw.slice(0, 800)}`);

  const debugBase = {
    rosterSize: players.length,
    productsCount: products.length,
    rawResponseExcerpt: raw.slice(0, 600),
  };

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    console.warn(`[insights-parser] no JSON array found in response`);
    return { updates: [], debug: { ...debugBase, parsedRawCount: 0, droppedReasons: ['no JSON array in response'] } };
  }

  let parsed: ParsedUpdate[];
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch (err) {
    console.warn(`[insights-parser] JSON parse failed: ${err instanceof Error ? err.message : err}`);
    return { updates: [], debug: { ...debugBase, parsedRawCount: 0, droppedReasons: [`json parse: ${err instanceof Error ? err.message : err}`] } };
  }
  console.log(`[insights-parser] parsed ${parsed.length} raw updates before validation`);

  // Validate: drop anything referencing an unknown id and clamp score/strength.
  const validProductIds = new Set(products.map(p => p.id));
  const playerById = new Map(players.map((p: any) => [p.id, { name: p.name, team: p.team }]));
  const productById = new Map(products.map(p => [p.id, p.name]));

  // We don't validate the model's claimed name against the DB name anymore
  // — the original Wemby->Robinson bug was caused by a truncated roster
  // (now fixed), not by hallucinated ids. A name-match check that's loose
  // enough to accept nicknames ("Wemby" matches "Victor Wembanyama") is
  // also loose enough to miss real hallucinations, and a tight check
  // false-rejects nicknames. Trust the player_id; the model's roster is
  // now complete so it has no reason to substitute.
  const out: ParsedUpdate[] = [];
  const dropReasons: string[] = [];
  for (const u of parsed) {
    if (!u || typeof u !== 'object' || !('kind' in u)) {
      dropReasons.push(`shape: ${JSON.stringify(u)?.slice(0, 100)}`);
      continue;
    }

    switch (u.kind) {
      case 'sentiment': {
        if (!playerById.has(u.player_id)) {
          dropReasons.push(`sentiment: unknown player_id=${u.player_id}`);
          continue;
        }
        const known = playerById.get(u.player_id)!;
        out.push({
          kind: 'sentiment',
          player_id: u.player_id,
          player_name: known.name,
          score: Math.max(-0.5, Math.min(0.5, Number(u.score) || 0)),
          note: String(u.note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'risk_flag': {
        if (!playerById.has(u.player_id)) {
          dropReasons.push(`risk_flag: unknown player_id=${u.player_id}`);
          continue;
        }
        const known = playerById.get(u.player_id)!;
        const validFlags = ['injury', 'suspension', 'legal', 'trade', 'retirement', 'off_field'] as const;
        if (!validFlags.includes(u.flag_type as typeof validFlags[number])) continue;
        out.push({
          kind: 'risk_flag',
          player_id: u.player_id,
          player_name: known.name,
          flag_type: u.flag_type,
          note: String(u.note ?? '').slice(0, 500),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'asking_price': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`asking_price: unknown product_id=${u.product_id}`);
          continue;
        }
        if (u.scope_type === 'player' && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`asking_price: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['hobby', 'bd', 'jumbo'].includes(u.format)) {
          dropReasons.push(`asking_price: invalid format=${u.format}`);
          continue;
        }
        out.push({
          kind: 'asking_price',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_team: u.scope_team,
          scope_player_id: u.scope_player_id,
          format: u.format,
          price_low: Math.max(0, Number(u.price_low) || 0),
          price_high: Math.max(0, Number(u.price_high) || 0),
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'hype_tag': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`hype_tag: unknown product_id=${u.product_id}`);
          continue;
        }
        if (u.scope_type === 'player' && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`hype_tag: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        const validTags = ['release_premium', 'cooled', 'overhyped', 'underhyped'] as const;
        if (!validTags.includes(u.tag as typeof validTags[number])) {
          dropReasons.push(`hype_tag: invalid tag=${u.tag}`);
          continue;
        }
        out.push({
          kind: 'hype_tag',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_team: u.scope_team,
          scope_player_id: u.scope_player_id,
          tag: u.tag,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 14)),
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
    }
  }

  if (dropReasons.length > 0) {
    console.log(`[insights-parser] dropped ${dropReasons.length} updates: ${dropReasons.slice(0, 8).join(' | ')}`);
  }
  console.log(`[insights-parser] returning ${out.length} validated updates`);

  return {
    updates: out,
    debug: {
      ...debugBase,
      parsedRawCount: parsed.length,
      droppedReasons: dropReasons,
    },
  };
}

/** Pretty one-line summary used in the bot reply. */
export function summarizeUpdate(u: ParsedUpdate): string {
  switch (u.kind) {
    case 'sentiment':
      return `${u.player_name}: sentiment ${u.score >= 0 ? '+' : ''}${u.score} — ${u.note}`;
    case 'risk_flag':
      return `${u.player_name}: ${u.flag_type} — ${u.note}`;
    case 'asking_price': {
      const where =
        u.scope_type === 'team' ? `${u.scope_team} slot`
        : u.scope_type === 'player' ? `player slot`
        : `${u.product_name} bundle`;
      const range = u.price_low === u.price_high ? `$${u.price_low}` : `$${u.price_low}–$${u.price_high}`;
      return `${where} (${u.format}): asking ${range} — ${u.source_note}`;
    }
    case 'hype_tag':
      return `${u.scope_team ?? u.product_name}: ${u.tag} (strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d)`;
  }
}
