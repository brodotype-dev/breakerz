import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV, get90DayPrices } from '@/lib/cardhedger';
import { computeSlotPricing, computeTeamSlotPricing, computeSignal, formatCurrency } from '@/lib/engine';
import type { PlayerWithPricing, BreakConfig } from '@/lib/types';

export const maxDuration = 60;

const CACHE_TTL_HOURS = 24;

export async function POST(req: NextRequest) {
  try {
    const { productId, team, askPrice, breakType = 'hobby', numCases = 10 } = await req.json();
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
      .select('*, player:players(*), buzz_score, breakerz_score')
      .eq('product_id', productId)
      .eq('insert_only', false);

    if (!playerProducts?.length) {
      return NextResponse.json({ error: 'No players found for this product' }, { status: 404 });
    }

    const ids = playerProducts.map(pp => pp.id);

    // Load variants (needed for weighted EV on players with multiple card types)
    const { data: allVariants } = await supabaseAdmin
      .from('player_product_variants')
      .select('id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, hobby_odds')
      .in('player_product_id', ids)
      .not('cardhedger_card_id', 'is', null);

    const variantMap = new Map<string, typeof allVariants>();
    for (const v of allVariants ?? []) {
      const list = variantMap.get(v.player_product_id) ?? [];
      list.push(v);
      variantMap.set(v.player_product_id, list);
    }

    const { data: cached } = await supabaseAdmin
      .from('pricing_cache')
      .select('*')
      .in('player_product_id', ids)
      .gt('expires_at', new Date().toISOString());

    const cacheMap = new Map(cached?.map(c => [c.player_product_id, c]) ?? []);

    // For uncached players, fetch live pricing from CardHedger (same chain as /api/pricing)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

    const rawPlayers: PlayerWithPricing[] = await Promise.all(
      playerProducts.map(async pp => {
        const c = cacheMap.get(pp.id);
        if (c) {
          return {
            ...pp,
            evLow: c.ev_low, evMid: c.ev_mid, evHigh: c.ev_high,
            hobbyEVPerBox: c.ev_mid,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'cached' as const,
          };
        }

        // No cache — fetch live
        try {
          const variants = variantMap.get(pp.id) ?? [];
          let ev: { evLow: number; evMid: number; evHigh: number };
          let hobbyEVPerBox: number;

          if (variants.length > 0) {
            const variantEVs = await Promise.all(
              variants.map(async v => {
                const variantEV = await computeLiveEV(v.cardhedger_card_id!);
                const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0);
                return { ...variantEV, sets: Math.max(sets, 1), hobby_odds: v.hobby_odds };
              })
            );
            const totalSets = variantEVs.reduce((sum, v) => sum + v.sets, 0);
            ev = {
              evLow: variantEVs.reduce((sum, v) => sum + v.evLow * v.sets, 0) / totalSets,
              evMid: variantEVs.reduce((sum, v) => sum + v.evMid * v.sets, 0) / totalSets,
              evHigh: variantEVs.reduce((sum, v) => sum + v.evHigh * v.sets, 0) / totalSets,
            };
            const oddsVariants = variantEVs.filter(v => v.hobby_odds != null && v.hobby_odds > 0);
            hobbyEVPerBox = oddsVariants.length > 0
              ? oddsVariants.reduce((sum, v) => sum + v.evMid * (1 / v.hobby_odds!), 0)
              : ev.evMid;
          } else if (pp.cardhedger_card_id) {
            ev = await computeLiveEV(pp.cardhedger_card_id);
            hobbyEVPerBox = ev.evMid;
          } else {
            // Search fallback
            const cardType = pp.player?.is_rookie ? 'Auto RC' : 'Base';
            const result = await get90DayPrices(`${pp.player?.name} ${cardType}`, 'Raw');
            const raw = result.prices.find((p: { grade: string }) => p.grade.toLowerCase().includes('raw'));
            if (raw && (raw as any).avg_price > 0) {
              const evMid = Math.round((raw as any).avg_price);
              ev = {
                evLow: (raw as any).min_price > 0 ? Math.round((raw as any).min_price) : Math.round(evMid * 0.35),
                evMid,
                evHigh: (raw as any).max_price > evMid ? Math.round((raw as any).max_price) : Math.round(evMid * 2.5),
              };
            } else {
              const evMid = pp.player?.is_rookie ? 15 : 8;
              ev = { evLow: Math.round(evMid * 0.35), evMid, evHigh: Math.round(evMid * 2.5) };
            }
            hobbyEVPerBox = ev.evMid;
          }

          if (ev.evMid > 0) {
            await supabaseAdmin.from('pricing_cache').upsert({
              player_product_id: pp.id,
              cardhedger_card_id: pp.cardhedger_card_id ?? null,
              ev_low: ev.evLow, ev_mid: ev.evMid, ev_high: ev.evHigh,
              raw_comps: {}, fetched_at: new Date().toISOString(), expires_at: expiresAt.toISOString(),
            }, { onConflict: 'player_product_id' });
          }

          return {
            ...pp,
            evLow: ev.evLow, evMid: ev.evMid, evHigh: ev.evHigh,
            hobbyEVPerBox,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'live' as const,
          };
        } catch {
          const evMid = pp.player?.is_rookie ? 15 : 8;
          return {
            ...pp,
            evLow: Math.round(evMid * 0.35), evMid, evHigh: Math.round(evMid * 2.5),
            hobbyEVPerBox: evMid,
            hobbyWeight: 0, bdWeight: 0, hobbySlotCost: 0, bdSlotCost: 0,
            totalCost: 0, hobbyPerCase: 0, bdPerCase: 0, maxPay: 0,
            pricingSource: 'default' as const,
          };
        }
      })
    );

    const cases = Math.max(1, Math.min(50, parseInt(numCases) || 10));
    const config: BreakConfig = {
      hobbyCases: cases,
      bdCases: cases,
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
    const teamPlayerProductIds = teamPlayers.map(p => p.id);

    // Fetch active risk flags for this team's players
    const { data: teamFlags } = teamPlayerProductIds.length
      ? await supabaseAdmin
          .from('player_risk_flags')
          .select('player_product_id, flag_type, note')
          .in('player_product_id', teamPlayerProductIds)
          .is('cleared_at', null)
      : { data: [] };

    // Build name lookup for flags
    const ppNameMap = new Map(teamPlayers.map(p => [p.id, p.player.name]));
    const riskFlags = (teamFlags ?? []).map(f => ({
      playerName: ppNameMap.get(f.player_product_id) ?? '',
      flagType: f.flag_type as string,
      note: f.note,
    }));

    const hvPlayers = teamPlayers
      .filter(p => p.is_high_volatility)
      .map(p => p.player.name);

    // Always include icon players even if outside top 5 by EV
    const top5 = teamPlayers.slice(0, 5);
    const iconPlayersOutsideTop5 = teamPlayers.slice(5).filter(p => p.player.is_icon);
    const topPlayers = [...top5, ...iconPlayersOutsideTop5].map(p => ({
      name: p.player.name,
      isRookie: p.player.is_rookie,
      isIcon: p.player.is_icon ?? false,
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

    // Breakerz Bets editorial notes for players on this team
    const betsNotes = teamPlayers
      .filter(p => p.breakerz_score != null && p.breakerz_score !== 0)
      .map(p => {
        const direction = (p.breakerz_score ?? 0) > 0 ? 'bullish' : 'bearish';
        const note = p.breakerz_note ? ` — "${p.breakerz_note}"` : '';
        return `- ${p.player.name}: Breakerz is ${direction} (score: ${p.breakerz_score})${note}`;
      }).join('\n');

    const betsSection = betsNotes
      ? `\nBreakerz editorial market read:\n${betsNotes}`
      : '';

    // Icon-tier players
    const iconNames = teamPlayers.filter(p => p.player.is_icon).map(p => p.player.name);
    const iconSection = iconNames.length
      ? `\nIcon-tier players on this team (structural demand baked into EV — not amplified by buzz): ${iconNames.join(', ')}.`
      : '';

    // Risk flags
    const flagLines = riskFlags.map(f => `- ${f.playerName} [${f.flagType}]: ${f.note}`).join('\n');
    const flagSection = flagLines
      ? `\nRisk flags (consumer-visible disclosures):\n${flagLines}\nIMPORTANT: Mention flagged players directly — buyers need to know about these risks.`
      : '';

    // High volatility
    const hvSection = hvPlayers.length
      ? `\nHigh Volatility: ${hvPlayers.join(', ')} — pricing for these players is unusually uncertain. Note this in your analysis.`
      : '';

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
Total players on team: ${teamSlot.playerCount}${betsSection}${iconSection}${flagSection}${hvSection}

Write a 2–3 sentence analysis explaining whether this break slot is worth buying at this price. Be direct — lead with the signal. Mention the most important player(s) to hit, the rookie upside if applicable, and whether the price justifies the risk. Use plain conversational language, no bullet points, no markdown.`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
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
      riskFlags,
      hvPlayers,
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
