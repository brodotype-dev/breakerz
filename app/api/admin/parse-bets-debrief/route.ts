import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { productId, narrative } = await req.json();
    if (!productId || !narrative?.trim()) {
      return NextResponse.json({ error: 'productId and narrative required' }, { status: 400 });
    }

    // Fetch product + player roster for Claude context
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('name, year')
      .eq('id', productId)
      .single();

    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const { data: playerProducts } = await supabaseAdmin
      .from('player_products')
      .select('id, player:players(name, team, is_rookie)')
      .eq('product_id', productId)
      .eq('insert_only', false);

    if (!playerProducts?.length) {
      return NextResponse.json({ error: 'No players found for this product' }, { status: 404 });
    }

    const roster = playerProducts
      .map((pp: any) => ({
        player_product_id: pp.id,
        name: pp.player?.name ?? '',
        team: pp.player?.team ?? '',
        is_rookie: pp.player?.is_rookie ?? false,
      }))
      .filter(p => p.name);

    // Build a name lookup for cross-validation after parsing
    const rosterNameMap = new Map(roster.map(p => [p.player_product_id, p.name]));

    const rosterLines = roster
      .map(p => `- ${p.name} (${p.team || 'N/A'}${p.is_rookie ? ', RC' : ''}) [id: ${p.player_product_id}]`)
      .join('\n');

    const prompt = `You are analyzing a sports card market debrief for the product: ${product.name} (${product.year}).

Here is the full player roster for this product:
${rosterLines}

The team has submitted the following market observations:
"""
${narrative.trim()}
"""

Find players from the roster who are clearly mentioned in the narrative. Common nicknames are acceptable (e.g. "Wemby" = "Victor Wembanyama"), but ONLY match to a player if you are confident the mention refers to someone on this specific roster. Do not substitute a similar player if the mentioned player is not on this roster.

For each matched player, determine:
- player_product_id: copy the exact id from the roster line above — do not invent or modify IDs
- player_name: copy the exact name from the roster line above
- suggested_score: a float from -0.5 (very bearish/cold) to +0.5 (very bullish/hot), based on the sentiment expressed
- reason_note: a single sentence drawn directly from the narrative that captures WHY
- confidence: 0.0–1.0, how confident you are this mention refers to this specific player

Return JSON only — no explanation, no markdown fences, no text before or after the array:
[
  { "player_product_id": "...", "player_name": "...", "suggested_score": 0.3, "reason_note": "...", "confidence": 0.9 }
]

IMPORTANT: Only include players explicitly mentioned. Do not include the full roster. If no players are clearly mentioned, return exactly: []`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 25_000 });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();

    // Extract just the JSON array — handles cases where Claude adds text before/after
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      return NextResponse.json({ results: [] });
    }

    let parsed: Array<{
      player_product_id: string;
      player_name: string;
      suggested_score: number;
      reason_note: string;
      confidence: number;
    }>;

    try {
      parsed = JSON.parse(arrayMatch[0]);
    } catch {
      return NextResponse.json({ results: [] });
    }

    // Validate player_product_ids are real (guard against hallucination)
    const validIds = new Set(roster.map(p => p.player_product_id));
    const validated = parsed
      .filter(r => validIds.has(r.player_product_id))
      .map(r => {
        // Cross-check: if Claude returned a different player_name than what's in the roster,
        // it likely matched the wrong player — penalise confidence
        const actualName = rosterNameMap.get(r.player_product_id) ?? '';
        const nameMismatch = actualName.toLowerCase() !== r.player_name.toLowerCase();
        return {
          ...r,
          player_name: actualName || r.player_name, // always use the DB name
          confidence: nameMismatch ? Math.min(r.confidence, 0.4) : r.confidence,
        };
      });

    return NextResponse.json({ results: validated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
