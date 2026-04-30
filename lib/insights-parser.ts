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

/**
 * Where an asking_price observation came from. CardHedger covers sold comps
 * (reactive); the whole point of capturing observations is the things CH
 * can't see — unsold listings, breaker stream asks, social posts during the
 * release-week window when sold-data is sparse.
 */
export type AskingPriceSource = 'ebay_listing' | 'stream_ask' | 'social_post' | 'other';

export type ParsedUpdate =
  | {
      kind: 'sentiment';
      player_id: string;
      player_name: string;
      // 'global' applies to every player_product for this player (today's
      // default behavior). 'product' applies only to the (player, product)
      // pair — for narrative like "Wemby in 2024 Topps Chrome is going wild"
      // where the read is product-specific and should not bleed across SKUs.
      scope: 'global' | 'product';
      product_id?: string;       // required when scope='product'
      score: number;            // -0.5..0.5, snaps to 0.25 increments client-side
      note: string;
      confidence: number;
    }
  | {
      kind: 'asking_price';
      product_id: string;
      product_name: string;
      // 'variant' is variant-specific ("Ohtani orange ref listed at $3.5k").
      // variant_name is free-text — variant_id resolution is deferred until
      // the engine starts reading variant-scope observations (Phase 3).
      scope_type: 'team' | 'player' | 'product' | 'variant';
      scope_team?: string;       // when scope_type='team'
      scope_player_id?: string;  // when scope_type='player' OR 'variant' (variant rolls up to player)
      variant_name?: string;     // when scope_type='variant'
      format: 'hobby' | 'bd' | 'jumbo';
      price_low: number;
      price_high: number;
      source: AskingPriceSource;
      source_note: string;
      confidence: number;
    }
  | {
      kind: 'hype_tag';
      product_id: string;
      product_name: string;
      scope_type: 'team' | 'player' | 'product' | 'variant';
      scope_team?: string;
      scope_player_id?: string;  // when 'player' OR 'variant'
      variant_name?: string;     // when scope_type='variant'
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
    }
  | {
      // Field intel: a specific card pulls at a different rate than the
      // odds sheet says. Variant-level by nature; format-keyed because odds
      // differ across hobby/jumbo/bd. observed_odds_per_case is "1 in N
      // cases" — the same shape breakers describe rare hits ("1:80 cases").
      kind: 'odds_observation';
      product_id: string;
      product_name: string;
      scope_type: 'variant' | 'player';
      scope_player_id?: string;  // always set (variant rolls up to player too)
      variant_name?: string;     // when scope_type='variant'
      format: 'hobby' | 'bd' | 'jumbo';
      observed_odds_per_case: number;  // e.g. 80 for "1 in 80 cases"
      source: AskingPriceSource;
      source_note: string;
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

Extract zero or more updates. Each update is one of five kinds:

1. SENTIMENT — a player is hot/cold for non-obvious reasons (post-game buzz, injury return, etc.). Output:
   { "kind": "sentiment", "player_id": "...", "player_name": "...",
     "scope": "global" | "product",     // see scope rules below
     "product_id": "...",                // REQUIRED when scope='product'
     "score": 0.3, "note": "...", "confidence": 0.9 }
   score is -0.5 (very bearish) to +0.5 (very bullish).
   SCOPE RULES:
   - 'global' = applies to every product the player appears in. Use for general player narrative: "Wemby is on a heater", "Flagg's stock is up post-combine", "X is a sell".
   - 'product' = applies only to this (player, product). Use when the narrative names a specific product/set/year/break: "Wemby in 2024 Topps Chrome is going wild", "Flagg's Bowman Chrome cards are hot", "this product's [player] is moving". Default to 'global' if unsure.

2. ASKING_PRICE — what streams or sellers are charging (NOT what's selling). Output:
   { "kind": "asking_price", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product" | "variant",
     "scope_team": "Dallas Mavericks",   // only when scope_type='team'
     "scope_player_id": "...",           // when scope_type='player' OR 'variant' (variants roll up to a player)
     "variant_name": "Orange Refractor /99",  // free-text variant description, only when scope_type='variant'
     "format": "hobby" | "bd" | "jumbo",
     "price_low": 12000, "price_high": 15000,
     "source": "ebay_listing" | "stream_ask" | "social_post" | "other",
     "source_note": "...", "confidence": 0.85 }
   If only one price was mentioned, set price_low=price_high.
   SOURCE RULES:
   - 'ebay_listing' = unsold eBay listing (asking price on a live listing). This is the leading-indicator signal — CardHedger only sees sold comps, so eBay listings during the first few days of a release are critical intel we can't get elsewhere.
   - 'stream_ask' = what a breaker is charging on a live break (Whatnot/Fanatics Live/etc.).
   - 'social_post' = a price mentioned in a tweet, IG post, Discord message, etc.
   - 'other' = anywhere else.

3. HYPE_TAG — a temporary premium or cooldown. Output:
   { "kind": "hype_tag", "product_id": "...", "product_name": "...",
     "scope_type": "team" | "player" | "product" | "variant",
     "scope_team": ..., "scope_player_id": ..., "variant_name": ...,
     "tag": "release_premium" | "cooled" | "overhyped" | "underhyped",
     "strength": 0.7, "decay_days": 14,
     "source_note": "...", "confidence": 0.8 }
   Prefer scope_type='variant' when the narrative names a specific card or parallel ("Ohtani's orange ref is wild", "the Wemby auto"). Use 'player' only when it's about the player generally in this product. Use 'product' for the whole release. Use 'team' for team-wide moves.

4. RISK_FLAG — injury, suspension, trade, retirement, legal, off_field. Output:
   { "kind": "risk_flag", "player_id": "...", "player_name": "...",
     "flag_type": "injury", "note": "...", "confidence": 0.9 }

5. ODDS_OBSERVATION — a specific card pulls at a different rate than the published odds. Output:
   { "kind": "odds_observation", "product_id": "...", "product_name": "...",
     "scope_type": "variant" | "player",
     "scope_player_id": "...",                    // always set
     "variant_name": "Black Prism /1",            // when scope_type='variant'
     "format": "hobby" | "bd" | "jumbo",
     "observed_odds_per_case": 80,                // "1 in 80 cases" → 80
     "source": "ebay_listing" | "stream_ask" | "social_post" | "other",
     "source_note": "...", "confidence": 0.7 }
   Use this only when someone explicitly reports a per-case pull rate that contradicts the odds sheet (e.g. "this card is hitting 1 in 80 cases on hobby, way rarer than published"). DO NOT emit this for "X is a chase" or "X is rare" without a number.

Return JSON ONLY — a JSON array of update objects. No markdown, no explanation, no text before or after. If nothing extractable, return exactly: []

CRITICAL:
- Use exact ids from the roster lines above — never invent or guess ids.
- For player_name / product_name fields, copy the exact name from the matching roster line so we can verify your match. Common nicknames are fine (Wemby → Victor Wembanyama) — match to the canonical roster name.
- One narrative can produce multiple updates of different kinds.
- DO NOT SUBSTITUTE. If a named player or product isn't in the roster, OMIT that update entirely. Do not pick "the closest match" — wrong attributions are worse than missing ones. Example: if the narrative mentions "Joe Smith" and Joe Smith is not in the roster, drop that update — do not pick John Smith or any other Joe.
- variant_name is free text — copy it verbatim from the narrative ("Orange Refractor /99", "Black Prism /1"). We don't have a variant roster yet, so don't try to match against one.
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
        // Default to global if scope is missing/invalid — preserves today's
        // fan-out behavior. 'product' requires a valid product_id.
        const rawScope = (u as { scope?: string }).scope;
        const scope: 'global' | 'product' = rawScope === 'product' ? 'product' : 'global';
        if (scope === 'product' && !validProductIds.has(u.product_id ?? '')) {
          dropReasons.push(`sentiment: scope=product but unknown product_id=${u.product_id}`);
          continue;
        }
        const known = playerById.get(u.player_id)!;
        out.push({
          kind: 'sentiment',
          player_id: u.player_id,
          player_name: known.name,
          scope,
          product_id: scope === 'product' ? u.product_id : undefined,
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
        if ((u.scope_type === 'player' || u.scope_type === 'variant') && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`asking_price: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['team', 'player', 'product', 'variant'].includes(u.scope_type)) {
          dropReasons.push(`asking_price: invalid scope_type=${u.scope_type}`);
          continue;
        }
        if (!['hobby', 'bd', 'jumbo'].includes(u.format)) {
          dropReasons.push(`asking_price: invalid format=${u.format}`);
          continue;
        }
        const validSources: AskingPriceSource[] = ['ebay_listing', 'stream_ask', 'social_post', 'other'];
        const source: AskingPriceSource = validSources.includes(u.source) ? u.source : 'other';
        out.push({
          kind: 'asking_price',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_team: u.scope_team,
          scope_player_id: u.scope_player_id,
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          format: u.format,
          price_low: Math.max(0, Number(u.price_low) || 0),
          price_high: Math.max(0, Number(u.price_high) || 0),
          source,
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
        if ((u.scope_type === 'player' || u.scope_type === 'variant') && !playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`hype_tag: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['team', 'player', 'product', 'variant'].includes(u.scope_type)) {
          dropReasons.push(`hype_tag: invalid scope_type=${u.scope_type}`);
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
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          tag: u.tag,
          strength: Math.max(0, Math.min(1, Number(u.strength) || 0)),
          decay_days: Math.max(1, Math.min(60, Number(u.decay_days) || 14)),
          source_note: String(u.source_note ?? '').slice(0, 240),
          confidence: Math.max(0, Math.min(1, Number(u.confidence) || 0)),
        });
        break;
      }
      case 'odds_observation': {
        if (!validProductIds.has(u.product_id)) {
          dropReasons.push(`odds_observation: unknown product_id=${u.product_id}`);
          continue;
        }
        if (!playerById.has(u.scope_player_id ?? '')) {
          dropReasons.push(`odds_observation: unknown scope_player_id=${u.scope_player_id}`);
          continue;
        }
        if (!['variant', 'player'].includes(u.scope_type)) {
          dropReasons.push(`odds_observation: invalid scope_type=${u.scope_type}`);
          continue;
        }
        if (!['hobby', 'bd', 'jumbo'].includes(u.format)) {
          dropReasons.push(`odds_observation: invalid format=${u.format}`);
          continue;
        }
        const obs = Number(u.observed_odds_per_case);
        if (!Number.isFinite(obs) || obs <= 0) {
          dropReasons.push(`odds_observation: invalid observed_odds_per_case=${u.observed_odds_per_case}`);
          continue;
        }
        const validSources: AskingPriceSource[] = ['ebay_listing', 'stream_ask', 'social_post', 'other'];
        const source: AskingPriceSource = validSources.includes(u.source) ? u.source : 'other';
        out.push({
          kind: 'odds_observation',
          product_id: u.product_id,
          product_name: productById.get(u.product_id) ?? u.product_name,
          scope_type: u.scope_type,
          scope_player_id: u.scope_player_id,
          variant_name: u.scope_type === 'variant' ? String(u.variant_name ?? '').slice(0, 120) : undefined,
          format: u.format,
          // Cap at 10000 — anything rarer than 1:10000 is almost certainly
          // a misread of "1/1" or per-set numbering. Smallest is 1 (every case).
          observed_odds_per_case: Math.max(1, Math.min(10000, Math.round(obs))),
          source,
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
    case 'sentiment': {
      const scopeLabel = u.scope === 'product' ? ' (this product only)' : '';
      return `${u.player_name}${scopeLabel}: sentiment ${u.score >= 0 ? '+' : ''}${u.score} — ${u.note}`;
    }
    case 'risk_flag':
      return `${u.player_name}: ${u.flag_type} — ${u.note}`;
    case 'asking_price': {
      const where =
        u.scope_type === 'team' ? `${u.scope_team} slot`
        : u.scope_type === 'variant' ? `${u.variant_name ?? 'variant'}`
        : u.scope_type === 'player' ? `player slot`
        : `${u.product_name} bundle`;
      const range = u.price_low === u.price_high ? `$${u.price_low}` : `$${u.price_low}–$${u.price_high}`;
      return `${where} (${u.format}, ${u.source}): asking ${range} — ${u.source_note}`;
    }
    case 'hype_tag': {
      const where =
        u.scope_type === 'team' ? u.scope_team
        : u.scope_type === 'variant' ? (u.variant_name ?? 'variant')
        : u.scope_type === 'player' ? 'player'
        : u.product_name;
      return `${where}: ${u.tag} (strength ${u.strength.toFixed(2)}, decay ${u.decay_days}d)`;
    }
    case 'odds_observation':
      return `${u.variant_name ?? 'card'} (${u.format}): observed 1:${u.observed_odds_per_case} cases — ${u.source_note}`;
  }
}
