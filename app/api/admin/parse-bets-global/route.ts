import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { narrative } = await req.json();
    if (!narrative?.trim()) {
      return NextResponse.json({ error: 'narrative required' }, { status: 400 });
    }

    // Fetch ALL players across all products
    const { data: players } = await supabaseAdmin
      .from('players')
      .select('id, name, team, sport:sports(name)')
      .order('name');

    if (!players?.length) {
      return NextResponse.json({ error: 'No players found in database' }, { status: 404 });
    }

    const rosterLines = players
      .map((p: any) => `- ${p.name} (${p.team || 'N/A'}, ${(p.sport as any)?.name ?? ''}) [id: ${p.id}]`)
      .join('\n');

    const prompt = `You are analyzing a sports card market debrief for ALL players across ALL products.

Here is the full player database:
${rosterLines}

The team has submitted the following market observations:
"""
${narrative.trim()}
"""

Find players from the database who are clearly mentioned in the narrative. Common nicknames are acceptable (e.g. "Wemby" = "Victor Wembanyama"), but ONLY match to a player if you are confident.

For each matched player, determine:
- player_id: copy the exact id from the roster line above — do not invent or modify IDs
- player_name: copy the exact name from the roster line above
- suggested_score: a float from -0.5 (very bearish/cold) to +0.5 (very bullish/hot), based on sentiment
- reason_note: a single sentence drawn directly from the narrative that captures WHY
- confidence: 0.0–1.0, how confident you are this mention refers to this specific player

Return JSON only — no explanation, no markdown fences, no text before or after the array:
[
  { "player_id": "...", "player_name": "...", "suggested_score": 0.3, "reason_note": "...", "confidence": 0.9 }
]

IMPORTANT: Only include players explicitly mentioned. If no players are clearly mentioned, return exactly: []`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 25_000 });

    const raw = (message.content[0] as { type: string; text: string }).text.trim();

    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      return NextResponse.json({ results: [] });
    }

    let parsed: Array<{
      player_id: string;
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

    // Validate player_ids are real
    const validIds = new Set(players.map((p: any) => p.id));
    const nameMap = new Map(players.map((p: any) => [p.id, p.name]));

    const validated = parsed
      .filter(r => validIds.has(r.player_id))
      .map(r => {
        const actualName = nameMap.get(r.player_id) ?? '';
        const nameMismatch = actualName.toLowerCase() !== r.player_name.toLowerCase();
        return {
          ...r,
          player_name: actualName || r.player_name,
          confidence: nameMismatch ? Math.min(r.confidence, 0.4) : r.confidence,
        };
      });

    return NextResponse.json({ results: validated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
