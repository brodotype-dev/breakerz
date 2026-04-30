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

export async function parseInsights({ narrative, maxPlayers = 5000 }: ParseInput): Promise<ParsedUpdate[]> {
  if (!narrative.trim()) return [];

  // Only include players who appear as slot-eligible in at least one
  // active product. Combined-name multi-player rows ("Skubal / Blanco")
  // and retired-legend subset cards have insert_only=true on every
  // player_product and shouldn't show up for sentiment matching.
  const [{ data: products }, { data: eligibleRows }] = await Promise.all([
    supabaseAdmin
      .from('products')
      .select('id, name, year, lifecycle_status')
      .eq('is_active', true)
      .in('lifecycle_status', ['live', 'pre_release']),
    supabaseAdmin
      .from('player_products')
      .select('player_id, products!inner(is_active, lifecycle_status)')
      .eq('insert_only', false)
      .eq('products.is_active', true)
      .in('products.lifecycle_status', ['live', 'pre_release']),
  ]);

  const eligiblePlayerIds = Array.from(new Set((eligibleRows ?? []).map((r: any) => r.player_id)));
  const { data: players } = eligiblePlayerIds.length
    ? await supabaseAdmin
        .from('players')
        .select('id, name, team, sport:sports(name)')
        .in('id', eligiblePlayerIds)
        .order('name')
        .limit(maxPlayers)
    : { data: [] as any[] };

  if (!products?.length || !players?.length) return [];

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
- Use exact ids from the lists above. Never invent ids.
- The "player_name" or "product_name" field MUST be the exact name from the roster line whose id you used. After writing each update, re-read the id you put in player_id and verify it matches the name you wrote. Mismatched name+id pairs will be silently dropped.
- One narrative can produce multiple updates of different kinds.
- Skip anything you can't tie to a real id with high confidence.`;

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
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  let parsed: ParsedUpdate[];
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch {
    return [];
  }

  // Validate: drop anything referencing an unknown id and clamp score/strength.
  const validProductIds = new Set(products.map(p => p.id));
  const playerById = new Map(players.map((p: any) => [p.id, { name: p.name, team: p.team }]));
  const productById = new Map(products.map(p => [p.id, p.name]));

  // Fuzzy name match — case-insensitive substring either way. Claude
  // sometimes returns nicknames ("Wemby" → "Victor Wembanyama"); we accept
  // those as long as one is a substring of the other. But if the model
  // wrote a totally different name than the id resolves to (e.g. wrote
  // "Victor Wembanyama" while id resolves to "David Robinson"), we drop
  // the update — that's a hallucination, not a nickname mismatch.
  const namesAreCompatible = (claimed: string, actual: string): boolean => {
    if (!claimed || !actual) return false;
    const a = claimed.toLowerCase().trim();
    const b = actual.toLowerCase().trim();
    if (a === b) return true;
    return a.includes(b) || b.includes(a);
  };

  const out: ParsedUpdate[] = [];
  for (const u of parsed) {
    if (!u || typeof u !== 'object' || !('kind' in u)) continue;

    switch (u.kind) {
      case 'sentiment': {
        if (!playerById.has(u.player_id)) continue;
        const known = playerById.get(u.player_id)!;
        if (!namesAreCompatible(u.player_name, known.name)) {
          console.warn(`[insights-parser] dropped sentiment: id=${u.player_id} name="${known.name}" claimed="${u.player_name}"`);
          continue;
        }
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
        if (!playerById.has(u.player_id)) continue;
        const known = playerById.get(u.player_id)!;
        if (!namesAreCompatible(u.player_name, known.name)) {
          console.warn(`[insights-parser] dropped risk_flag: id=${u.player_id} name="${known.name}" claimed="${u.player_name}"`);
          continue;
        }
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
        if (!validProductIds.has(u.product_id)) continue;
        if (u.scope_type === 'player' && !playerById.has(u.scope_player_id ?? '')) continue;
        if (!['hobby', 'bd', 'jumbo'].includes(u.format)) continue;
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
        if (!validProductIds.has(u.product_id)) continue;
        if (u.scope_type === 'player' && !playerById.has(u.scope_player_id ?? '')) continue;
        const validTags = ['release_premium', 'cooled', 'overhyped', 'underhyped'] as const;
        if (!validTags.includes(u.tag as typeof validTags[number])) continue;
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

  return out;
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
