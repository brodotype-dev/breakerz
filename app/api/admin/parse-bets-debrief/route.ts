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

Extract every player mentioned (use fuzzy matching — nicknames and partial names are common, e.g. "Wemby" = "Victor Wembanyama", "Shohei" = "Shohei Ohtani").
For each mentioned player, determine:
- suggested_score: a float from -0.5 (very bearish/cold) to +0.5 (very bullish/hot), based on the sentiment expressed
- reason_note: a single sentence drawn directly from the narrative that captures WHY (use the team's own words where possible)
- confidence: 0.0–1.0, how confident you are this mention refers to this specific player

Return JSON only — no explanation, no markdown fences:
[
  { "player_product_id": "...", "player_name": "...", "suggested_score": 0.3, "reason_note": "...", "confidence": 0.9 }
]

Only include players that were explicitly or clearly implicitly mentioned. Do not return the full roster.
If no players are clearly mentioned, return [].`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 25_000 });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();
    const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(json) as Array<{
      player_product_id: string;
      player_name: string;
      suggested_score: number;
      reason_note: string;
      confidence: number;
    }>;

    // Validate player_product_ids are real (guard against hallucination)
    const validIds = new Set(roster.map(p => p.player_product_id));
    const validated = parsed.filter(r => validIds.has(r.player_product_id));

    return NextResponse.json({ results: validated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
