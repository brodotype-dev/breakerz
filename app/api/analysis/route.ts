import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeSlotPricing, computeTeamSlotPricing, computeSignal, formatCurrency } from '@/lib/engine';
import type { PlayerWithPricing, BreakConfig } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { productId, team, askPrice, breakType = 'hobby' } = await req.json();
    if (!productId || !team || askPrice == null) {
      return NextResponse.json({ error: 'productId, team, and askPrice required' }, { status: 400 });
    }

    // Fetch product
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('*, sport:sports(*)')
      .eq('id', productId)
      .single();
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    // Fetch players with cached pricing
    const { data: playerProducts } = await supabaseAdmin
      .from('player_products')
      .select('*, player:players(*), buzz_score')
      .eq('product_id', productId)
      .eq('insert_only', false);

    if (!playerProducts?.length) {
      return NextResponse.json({ error: 'No players found for this product' }, { status: 404 });
    }

    const ids = playerProducts.map(pp => pp.id);
    const { data: cached } = await supabaseAdmin
      .from('pricing_cache')
      .select('*')
      .in('player_product_id', ids)
      .gt('expires_at', new Date().toISOString());

    const cacheMap = new Map(cached?.map(c => [c.player_product_id, c]) ?? []);

    const rawPlayers: PlayerWithPricing[] = playerProducts.map(pp => {
      const c = cacheMap.get(pp.id);
      const evMid = c?.ev_mid ?? (pp.player?.is_rookie ? 15 : 8);
      return {
        ...pp,
        evLow: c?.ev_low ?? Math.round(evMid * 0.35),
        evMid,
        evHigh: c?.ev_high ?? Math.round(evMid * 2.5),
        hobbyEVPerBox: evMid,
        hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
        totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
        pricingSource: c ? 'cached' as const : 'default' as const,
      };
    });

    const config: BreakConfig = {
      hobbyCases: 10,
      bdCases: 10,
      hobbyCaseCost: product.hobby_case_cost ?? 1200,
      bdCaseCost: product.bd_case_cost ?? 800,
    };

    const pricedPlayers = computeSlotPricing(rawPlayers, config);
    const teamSlots = computeTeamSlotPricing(pricedPlayers, config);
    const teamSlot = teamSlots.find(t => t.team === team);

    if (!teamSlot) {
      return NextResponse.json({ error: 'Team not found in this product' }, { status: 404 });
    }

    const fairValue = breakType === 'hobby' ? teamSlot.hobbySlotCost : teamSlot.bdSlotCost;
    const { signal, valuePct } = computeSignal(fairValue, askPrice);

    const teamPlayers = teamSlot.players.sort((a, b) => b.evMid - a.evMid);
    const topPlayers = teamPlayers.slice(0, 5).map(p => ({
      name: p.player.name,
      isRookie: p.player.is_rookie,
      evMid: p.evMid,
      evHigh: p.evHigh,
    }));

    // Build Claude prompt
    const playerLines = teamPlayers.slice(0, 10).map(p =>
      `- ${p.player.name}${p.player.is_rookie ? ' (RC)' : ''}: EV $${p.evMid} | Upside $${p.evHigh}`
    ).join('\n');

    const rookies = teamPlayers.filter(p => p.player.is_rookie);
    const rookieNote = rookies.length > 0
      ? `Rookies on this team: ${rookies.map(r => r.player.name).join(', ')}.`
      : 'No rookies on this team.';

    const prompt = `You are a sports card break analyst at Card Breakerz. A collector is evaluating a group break slot.

Product: ${product.name} (${product.year})
Sport: ${(product.sport as any)?.name ?? 'Unknown'}
Team: ${team}
Break type: ${breakType === 'hobby' ? 'Hobby Case' : "Breaker's Delight"}
Fair slot value (our model): ${formatCurrency(fairValue)}
Break price being offered: ${formatCurrency(askPrice)}
Signal: ${signal} (${Math.abs(valuePct).toFixed(1)}% ${valuePct >= 0 ? 'below' : 'above'} fair value)

Top players on ${team}:
${playerLines}

${rookieNote}
Total players on team: ${teamSlot.playerCount}

Write a 2–3 sentence analysis explaining whether this break slot is worth buying at this price. Be direct — lead with the signal. Mention the most important player(s) to hit, the rookie upside if applicable, and whether the price justifies the risk. Use plain conversational language, no bullet points, no markdown.`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 15_000 });

    const analysis = (message.content[0] as { type: string; text: string }).text.trim();

    return NextResponse.json({
      signal,
      valuePct,
      fairValue,
      askPrice,
      analysis,
      topPlayers,
      teamName: team,
      productName: product.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — return active products and their teams (for the analysis page dropdowns)
export async function GET() {
  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, year, sport:sports(name), hobby_case_cost, bd_case_cost')
    .eq('is_active', true)
    .order('name');

  return NextResponse.json({ products: products ?? [] });
}
