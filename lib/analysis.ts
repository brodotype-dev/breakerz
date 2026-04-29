import { supabaseAdmin } from '@/lib/supabase';
import { computeLiveEV, get90DayPrices } from '@/lib/cardhedger';
import { computeSlotPricing, computeTeamSlotPricing, computeSignal, formatCurrency } from '@/lib/engine';
import type { PlayerWithPricing, BreakConfig, Signal, BreakFormat } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

export interface AnalysisResult {
  signal: Signal;
  valuePct: number;
  fairValue: number;
  askPrice: number;
  analysis: string;
  topPlayers: Array<{ name: string; team: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }>;
  teams: string[];
  extraPlayerNames: string[];
  productName: string;
  formats: { hobby: number; bd: number; jumbo: number };
  riskFlags: Array<{ playerName: string; flagType: string; note: string }>;
  hvPlayers: string[];
}

export interface AnalysisInput {
  productId: string;
  teams: string[];
  extraPlayerProductIds?: string[];
  formats: { hobby: number; bd: number; jumbo: number };
  caseCosts?: { hobby?: number; bd?: number; jumbo?: number };
  askPrice: number;
}

const formatLabel: Record<BreakFormat, string> = {
  hobby: 'Hobby',
  bd: "Breaker's Delight",
  jumbo: 'Jumbo',
};

export async function runBreakAnalysis(input: AnalysisInput): Promise<AnalysisResult> {
  const {
    productId,
    teams,
    extraPlayerProductIds = [],
    formats,
    caseCosts,
    askPrice,
  } = input;

  if (!teams.length && !extraPlayerProductIds.length) {
    throw new Error('Pick at least one team or player.');
  }
  if (formats.hobby + formats.bd + formats.jumbo <= 0) {
    throw new Error('Pick at least one case for any format.');
  }

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, sport:sports(*)')
    .eq('id', productId)
    .single();
  if (!product) throw new Error('Product not found');

  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*), buzz_score, breakerz_score')
    .eq('product_id', productId)
    .eq('insert_only', false);

  if (!playerProducts?.length) throw new Error('No players found for this product');

  const ids = playerProducts.map(pp => pp.id);

  // Variants drive weighted EV. 1/1s get filtered at the query level — they're
  // outliers that skew slot math without representing a pull-rate path most
  // breakers will hit.
  const { data: allVariants } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, player_product_id, cardhedger_card_id, hobby_sets, bd_only_sets, jumbo_sets, hobby_odds, print_run')
    .in('player_product_id', ids)
    .not('cardhedger_card_id', 'is', null)
    .or('print_run.is.null,print_run.gt.1');

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
          hobbyWeight: 0, bdWeight: 0, jumboWeight: 0,
          hobbySlotCost: 0, bdSlotCost: 0, jumboSlotCost: 0,
          totalCost: 0,
          hobbyPerCase: 0, bdPerCase: 0, jumboPerCase: 0,
          maxPay: 0,
          pricingSource: 'cached' as const,
        };
      }

      try {
        const variants = variantMap.get(pp.id) ?? [];
        let ev: { evLow: number; evMid: number; evHigh: number };
        let hobbyEVPerBox: number;

        if (variants.length > 0) {
          const variantEVs = await Promise.all(
            variants.map(async v => {
              const variantEV = await computeLiveEV(v.cardhedger_card_id!);
              const sets = (v.hobby_sets ?? 0) + (v.bd_only_sets ?? 0) + (v.jumbo_sets ?? 0);
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
          hobbyWeight: 0, bdWeight: 0, jumboWeight: 0,
          hobbySlotCost: 0, bdSlotCost: 0, jumboSlotCost: 0,
          totalCost: 0,
          hobbyPerCase: 0, bdPerCase: 0, jumboPerCase: 0,
          maxPay: 0,
          pricingSource: 'live' as const,
        };
      } catch {
        const evMid = pp.player?.is_rookie ? 15 : 8;
        return {
          ...pp,
          evLow: Math.round(evMid * 0.35), evMid, evHigh: Math.round(evMid * 2.5),
          hobbyEVPerBox: evMid,
          hobbyWeight: 0, bdWeight: 0, jumboWeight: 0,
          hobbySlotCost: 0, bdSlotCost: 0, jumboSlotCost: 0,
          totalCost: 0,
          hobbyPerCase: 0, bdPerCase: 0, jumboPerCase: 0,
          maxPay: 0,
          pricingSource: 'default' as const,
        };
      }
    })
  );

  // Resolve case costs — explicit override > AM > MSRP.
  const hobbyCaseCost = caseCosts?.hobby ?? product.hobby_am_case_cost ?? product.hobby_case_cost ?? 0;
  const bdCaseCost = caseCosts?.bd ?? product.bd_am_case_cost ?? product.bd_case_cost ?? 0;
  const jumboCaseCost = caseCosts?.jumbo ?? product.jumbo_am_case_cost ?? product.jumbo_case_cost ?? 0;

  const config: BreakConfig = {
    hobbyCases: Math.max(0, Math.min(50, formats.hobby)),
    bdCases: Math.max(0, Math.min(50, formats.bd)),
    jumboCases: Math.max(0, Math.min(50, formats.jumbo)),
    hobbyCaseCost,
    bdCaseCost,
    jumboCaseCost,
  };

  const pricedPlayers = computeSlotPricing(rawPlayers, config);
  const playerById = new Map(pricedPlayers.map(p => [p.id, p]));
  const teamSlots = computeTeamSlotPricing(pricedPlayers, config);

  // Resolve selected teams — surface unknown teams as a single combined error
  // instead of failing on the first one (better UX for typos in API callers).
  const knownTeams = new Set(teamSlots.map(t => t.team));
  const missingTeams = teams.filter(t => !knownTeams.has(t));
  if (missingTeams.length) {
    throw new Error(`Team(s) not found in this product: ${missingTeams.join(', ')}`);
  }
  const selectedTeamSlots = teamSlots.filter(t => teams.includes(t.team));

  // Resolve standalone players (must belong to the product, must not be on a
  // selected team to avoid double-counting).
  const selectedTeamSet = new Set(teams);
  const extraPlayers = extraPlayerProductIds
    .map(id => playerById.get(id))
    .filter((p): p is PlayerWithPricing => !!p && !selectedTeamSet.has(p.player?.team ?? ''));

  // Bundle fair value = sum of selected teams + standalone players across all formats.
  const teamsTotal = selectedTeamSlots.reduce((sum, t) => sum + t.totalCost, 0);
  const playersTotal = extraPlayers.reduce((sum, p) => sum + p.totalCost, 0);
  const fairValue = teamsTotal + playersTotal;

  const { signal, valuePct } = computeSignal(fairValue, askPrice);

  // Union of all players in the bundle for top-players, risk flags, HV.
  const teamPlayers = selectedTeamSlots.flatMap(t => t.players);
  const allBundlePlayers = [...teamPlayers, ...extraPlayers]
    .sort((a, b) => b.evMid - a.evMid);
  const bundlePlayerProductIds = allBundlePlayers.map(p => p.id);

  const { data: bundleFlags } = bundlePlayerProductIds.length
    ? await supabaseAdmin
        .from('player_risk_flags')
        .select('player_product_id, flag_type, note')
        .in('player_product_id', bundlePlayerProductIds)
        .is('cleared_at', null)
    : { data: [] };

  const ppNameMap = new Map(allBundlePlayers.map(p => [p.id, p.player.name]));
  const riskFlags = (bundleFlags ?? []).map(f => ({
    playerName: ppNameMap.get(f.player_product_id) ?? '',
    flagType: f.flag_type as string,
    note: f.note,
  }));

  const hvPlayers = allBundlePlayers
    .filter(p => p.is_high_volatility)
    .map(p => p.player.name);

  const top10 = allBundlePlayers.slice(0, 10);
  const iconPlayersOutsideTop10 = allBundlePlayers.slice(10).filter(p => p.player.is_icon);
  const topPlayers = [...top10, ...iconPlayersOutsideTop10].map(p => ({
    name: p.player.name,
    team: p.player.team,
    isRookie: p.player.is_rookie,
    isIcon: p.player.is_icon ?? false,
    evMid: p.evMid,
    evHigh: p.evHigh,
  }));

  // --- Build Claude prompt ---
  const activeFormats: BreakFormat[] = (['hobby', 'jumbo', 'bd'] as BreakFormat[])
    .filter(f => (f === 'hobby' ? config.hobbyCases : f === 'bd' ? config.bdCases : config.jumboCases) > 0);
  const formatSummary = activeFormats
    .map(f => `${f === 'hobby' ? config.hobbyCases : f === 'bd' ? config.bdCases : config.jumboCases} ${formatLabel[f]}`)
    .join(' + ');

  const teamLines = selectedTeamSlots
    .map(t => `- ${t.team}: fair ${formatCurrency(t.totalCost)} (${t.players.length} players, ${t.rookieCount} RC)`)
    .join('\n');
  const extraPlayerLines = extraPlayers.length
    ? extraPlayers
        .map(p => `- ${p.player.name} (${p.player.team})${p.player.is_rookie ? ' RC' : ''}: fair ${formatCurrency(p.totalCost)}`)
        .join('\n')
    : '';

  const playerLines = top10.map(p =>
    `- ${p.player.name} (${p.player.team})${p.player.is_rookie ? ' RC' : ''}: EV $${p.evMid} | Upside $${p.evHigh}`
  ).join('\n');

  const rookies = allBundlePlayers.filter(p => p.player.is_rookie);
  const rookieNote = rookies.length > 0
    ? `Rookies in this bundle: ${rookies.map(r => r.player.name).join(', ')}.`
    : 'No rookies in this bundle.';

  const betsNotes = allBundlePlayers
    .filter(p => p.breakerz_score != null && p.breakerz_score !== 0)
    .map(p => {
      const direction = (p.breakerz_score ?? 0) > 0 ? 'bullish' : 'bearish';
      const note = p.breakerz_note ? ` — "${p.breakerz_note}"` : '';
      return `- ${p.player.name}: Breakerz is ${direction} (score: ${p.breakerz_score})${note}`;
    }).join('\n');

  const betsSection = betsNotes ? `\nBreakerz editorial market read:\n${betsNotes}` : '';

  const iconNames = allBundlePlayers.filter(p => p.player.is_icon).map(p => p.player.name);
  const iconSection = iconNames.length
    ? `\nIcon-tier players in this bundle (structural demand baked into EV — not amplified by buzz): ${iconNames.join(', ')}.`
    : '';

  const flagLines = riskFlags.map(f => `- ${f.playerName} [${f.flagType}]: ${f.note}`).join('\n');
  const flagSection = flagLines
    ? `\nRisk flags (consumer-visible disclosures):\n${flagLines}\nIMPORTANT: Mention flagged players directly — buyers need to know about these risks.`
    : '';

  const hvSection = hvPlayers.length
    ? `\nHigh Volatility: ${hvPlayers.join(', ')} — pricing for these players is unusually uncertain. Note this in your analysis.`
    : '';

  const composition = teams.length && extraPlayers.length
    ? `${teams.length} team slot(s) plus ${extraPlayers.length} standalone player slot(s)`
    : teams.length
      ? `${teams.length} team slot(s)`
      : `${extraPlayers.length} standalone player slot(s)`;

  const prompt = `You are a sports card break analyst at Card Breakerz. A collector is evaluating a bundled break configuration.

Product: ${product.name} (${product.year})
Sport: ${(product.sport as any)?.name ?? 'Unknown'}
Bundle composition: ${composition}
Format mix: ${formatSummary}
Selected teams:
${teamLines || '(none)'}
${extraPlayerLines ? `Standalone players:\n${extraPlayerLines}\n` : ''}
Bundle fair value (our model): ${formatCurrency(fairValue)}
Bundle ask price: ${formatCurrency(askPrice)}
Signal: ${signal} (${Math.abs(valuePct).toFixed(1)}% ${valuePct >= 0 ? 'below' : 'above'} fair value)

Top players in bundle:
${playerLines}

${rookieNote}${betsSection}${iconSection}${flagSection}${hvSection}

Write a 2–3 sentence analysis explaining whether this bundle is worth buying at this price. Be direct — lead with the signal. Mention the most important player(s) to hit, the rookie upside if applicable, and whether the price justifies the risk. If the bundle mixes teams and standalone players, briefly call out which slot is carrying the value. Use plain conversational language, no bullet points, no markdown.`;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  }, { timeout: 15_000 });

  const analysis = (message.content[0] as { type: string; text: string }).text.trim();

  return {
    signal,
    valuePct,
    fairValue,
    askPrice,
    analysis,
    topPlayers,
    teams,
    extraPlayerNames: extraPlayers.map(p => p.player.name),
    productName: product.name,
    formats: { hobby: config.hobbyCases, bd: config.bdCases, jumbo: config.jumboCases },
    riskFlags,
    hvPlayers,
  };
}
