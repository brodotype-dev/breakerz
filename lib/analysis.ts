import { supabaseAdmin } from '@/lib/supabase';
import { MODELS } from '@/lib/models';
import { computeLiveEV, get90DayPrices } from '@/lib/cardhedger';
import { computeSlotPricing, computeTeamSlotPricing, computeSignal, formatCurrency } from '@/lib/engine';
import { computeRiskAdjustment, computeHypeAdjustment, type HypeObservation, type HypeTag } from '@/lib/score-modulation';
import { computeProspectAdjustment } from '@/lib/prospect-score';
import { isFeatureFlagEnabled, PROSPECT_RANK_FLAG } from '@/lib/feature-flags';
import { computeFallbackBaseEV } from '@/lib/pre-release-base-ev';
import {
  loadCascadeObservations,
  filterObservationsForPlayer,
  computeCascadeAdjustment,
} from '@/lib/cascading-sentiment';
import { getMarketMarkup, MARKET_MARKUP_RANGE } from '@/lib/market-markup';
import { getRecentObservationsForVerdict, configToComposition } from '@/lib/observation-context';
import type { PlayerWithPricing, BreakConfig, Signal, BreakFormat, PlayerRiskFlag, ProductLifecycle } from '@/lib/types';

const CACHE_TTL_HOURS = 24;

export interface AnalysisResult {
  signal: Signal;
  valuePct: number;
  // Pure-EV model fair value (unchanged from prior shape — still what we
  // persist into user_breaks snapshots and reference in admin tooling).
  fairValue: number;
  // Lifecycle-adjusted fair value (Plan B). signal/valuePct are computed
  // against this number, not pure fairValue.
  marketFairValue: number;
  marketFairLow: number;
  marketFairHigh: number;
  lifecycleStatus: ProductLifecycle;
  askPrice: number;
  analysis: string;
  topPlayers: Array<{ name: string; team: string; isRookie: boolean; isIcon: boolean; evMid: number; evHigh: number }>;
  teams: string[];
  extraPlayerNames: string[];
  productName: string;
  formats: { hobby: number; bd: number; jumbo: number };
  riskFlags: Array<{ playerName: string; flagType: string; note: string }>;
  hvPlayers: string[];
  // Slice 2b — telemetry on whether the verdict prompt was enriched with
  // recent /break-price observations. `applied` is true only when the
  // feature flag is on AND ≥3 ranked observations were available. Caller
  // (analysis API route) fires the verdict_observation_context_applied
  // PostHog event when this is true.
  observationContext: {
    enabled: boolean;          // feature flag state at request time
    applied: boolean;          // observations spliced into the prompt
    observationCount: number;  // top-N actually included (≤ 5)
  };
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

  // Track A kill switch — gates BOTH the prospect weight-share bump (below)
  // AND the rank-tiered base EV floor in the thin-data fallback paths.
  const prospectEnabled = await isFeatureFlagEnabled(PROSPECT_RANK_FLAG);

  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('*, player:players(*), buzz_score, breakerz_score')
    .eq('product_id', productId)
    .eq('insert_only', false);

  if (!playerProducts?.length) throw new Error('No players found for this product');

  const ids = playerProducts.map(pp => pp.id);
  // Risk flags are player-global now (2026-06-02) — fetch by player_id, not
  // player_product_id. Distinct player ids across the pool.
  const playerIds = [...new Set(playerProducts.map(pp => pp.player_id))];

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
          const raw = await get90DayPrices(`${pp.player?.name} ${cardType}`, 'Raw');
          if (raw && raw.avg_price > 0) {
            const evMid = Math.round(raw.avg_price);
            ev = {
              evLow: raw.min_price > 0 ? Math.round(raw.min_price) : Math.round(evMid * 0.35),
              evMid,
              evHigh: raw.max_price > evMid ? Math.round(raw.max_price) : Math.round(evMid * 2.5),
            };
          } else {
            const evMid = prospectEnabled
              ? computeFallbackBaseEV({ isRookie: pp.player?.is_rookie ?? false, prospectRank: pp.player?.prospect_rank, productLine: product.product_line })
              : (pp.player?.is_rookie ? 15 : 8);
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
        const evMid = prospectEnabled
          ? computeFallbackBaseEV({ isRookie: pp.player?.is_rookie ?? false, prospectRank: pp.player?.prospect_rank, productLine: product.product_line })
          : (pp.player?.is_rookie ? 15 : 8);
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

  // Fetch active risk flags (all player_products in this product) + active
  // hype-tag observations (product-wide) so the engine can fold them into
  // effectiveScore. The bundle-level riskFlags response below reuses the
  // same flags fetch — no second round-trip.
  const nowIso = new Date().toISOString();
  const [poolFlagsRes, poolObsRes, cascadeObs] = await Promise.all([
    supabaseAdmin
      .from('player_risk_flags')
      .select('player_id, flag_type, note')
      .in('player_id', playerIds)
      .is('cleared_at', null),
    supabaseAdmin
      .from('market_observations')
      .select('scope_type, scope_id, scope_team, payload, observed_at')
      .eq('product_id', productId)
      .eq('observation_type', 'hype_tag')
      .gt('expires_at', nowIso)
      .is('superseded_at', null),
    loadCascadeObservations(productId),
  ]);

  // Bucket flags by player, deduping the legacy Discord fan-out (same
  // player+type+note repeated across products). Then project onto each
  // player_product so riskAdjMap stays keyed by ppId for the engine.
  const flagsByPlayer = new Map<string, PlayerRiskFlag['flag_type'][]>();
  const seenFlagKey = new Set<string>();
  for (const f of poolFlagsRes.data ?? []) {
    const key = `${f.player_id}|${f.flag_type}|${f.note}`;
    if (seenFlagKey.has(key)) continue;
    seenFlagKey.add(key);
    const arr = flagsByPlayer.get(f.player_id) ?? [];
    arr.push(f.flag_type as PlayerRiskFlag['flag_type']);
    flagsByPlayer.set(f.player_id, arr);
  }
  const riskAdjMap = new Map<string, number>();
  for (const pp of playerProducts) {
    const types = flagsByPlayer.get(pp.player_id);
    if (types?.length) {
      riskAdjMap.set(pp.id, computeRiskAdjustment(types.map(t => ({ flag_type: t }))));
    }
  }

  type Obs = { scope_type: string; scope_id: string | null; scope_team: string | null; payload: { tag: HypeTag; strength: number; decay_days: number }; observed_at: string };
  const obsRows = (poolObsRes.data ?? []) as Obs[];
  const productScope: HypeObservation[] = [];
  const teamScope = new Map<string, HypeObservation[]>();
  const playerScope = new Map<string, HypeObservation[]>();
  for (const o of obsRows) {
    const obs: HypeObservation = {
      tag: o.payload.tag,
      strength: o.payload.strength,
      decay_days: o.payload.decay_days,
      observed_at: o.observed_at,
    };
    if (o.scope_type === 'product') productScope.push(obs);
    else if (o.scope_type === 'team' && o.scope_team) {
      const arr = teamScope.get(o.scope_team) ?? [];
      arr.push(obs);
      teamScope.set(o.scope_team, arr);
    } else if (o.scope_type === 'player' && o.scope_id) {
      const arr = playerScope.get(o.scope_id) ?? [];
      arr.push(obs);
      playerScope.set(o.scope_id, arr);
    }
  }

  const sportSlug = ((product.sport as { slug?: string } | null)?.slug ?? '').toLowerCase();
  const augmentedRawPlayers: PlayerWithPricing[] = rawPlayers.map(p => {
    const teamObs = teamScope.get(p.player?.team ?? '') ?? [];
    const playerObs = playerScope.get(p.player_id) ?? [];
    const all = [...productScope, ...teamObs, ...playerObs];
    const cascadeForPlayer = filterObservationsForPlayer(cascadeObs, p.player?.team);
    const cascade = computeCascadeAdjustment({
      observations: cascadeForPlayer,
      sportSlug,
    });
    return {
      ...p,
      risk_score_adj: riskAdjMap.get(p.id) ?? 0,
      hype_score_adj: computeHypeAdjustment(all),
      prospect_score_adj: prospectEnabled
        ? computeProspectAdjustment({
            prospect_rank: p.player?.prospect_rank,
            prospect_status: p.player?.prospect_status,
            sportSlug,
          })
        : 0,
      cascade_score_adj: cascade.adjustment,
    };
  });

  const pricedPlayers = computeSlotPricing(augmentedRawPlayers, config);
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

  // Plan B: lifecycle-aware market markup. The signal is judged against the
  // market-adjusted number — what breakers actually charge over pure EV —
  // not the raw model output. Pure fairValue stays in the response for the
  // "model: $X" sub-line and for user_breaks snapshot continuity.
  const lifecycleStatus = (product.lifecycle_status ?? 'live') as ProductLifecycle;
  const markup = getMarketMarkup(lifecycleStatus);
  const marketFairValue = fairValue * markup;
  const marketFairLow   = fairValue * (markup - MARKET_MARKUP_RANGE);
  const marketFairHigh  = fairValue * (markup + MARKET_MARKUP_RANGE);

  const { signal, valuePct } = computeSignal(marketFairValue, askPrice);

  // Union of all players in the bundle for top-players, risk flags, HV.
  const teamPlayers = selectedTeamSlots.flatMap(t => t.players);
  const allBundlePlayers = [...teamPlayers, ...extraPlayers]
    .sort((a, b) => b.evMid - a.evMid);

  // Reuse poolFlagsRes from the engine-modulation fetch above — same rows,
  // filtered down to the bundle's players (flags are player-global now) and
  // deduped against the legacy fan-out.
  const bundlePlayerIdSet = new Set(allBundlePlayers.map(p => p.player_id));
  const playerNameById = new Map(allBundlePlayers.map(p => [p.player_id, p.player.name]));
  const seenRiskKey = new Set<string>();
  const riskFlags = (poolFlagsRes.data ?? [])
    .filter(f => bundlePlayerIdSet.has(f.player_id))
    .filter(f => {
      const k = `${f.player_id}|${f.flag_type}|${f.note}`;
      if (seenRiskKey.has(k)) return false;
      seenRiskKey.add(k);
      return true;
    })
    .map(f => ({
      playerName: playerNameById.get(f.player_id) ?? '',
      flagType: f.flag_type as string,
      note: f.note,
    }));

  const hvPlayers = allBundlePlayers
    .filter(p => p.player?.is_high_volatility)
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

  // Slice 2b — feature-flagged observation context. Reads the flag at
  // request time so admin toggles take effect on the next verdict. When
  // enabled AND ≥3 ranked observations exist, splice into the prompt
  // with explicit grounding instruction. Caller fires the PostHog
  // verdict_observation_context_applied event when applied=true.
  const { data: flagRow } = await supabaseAdmin
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'verdict_observation_context_enabled')
    .maybeSingle();
  const observationContextEnabled = !!flagRow?.enabled;

  let observationBlock = '';
  let observationCount = 0;
  let observationApplied = false;
  if (observationContextEnabled) {
    const ctx = await getRecentObservationsForVerdict(productId, configToComposition(formats));
    if (ctx.hasEnough) {
      observationBlock = ctx.block;
      observationCount = ctx.observationCount;
      observationApplied = true;
    }
  }

  const observationSection = observationApplied
    ? `\n${observationBlock}\n` +
      `IMPORTANT — observation grounding rules:\n` +
      `- The observations above are recent market signals for this product. \`listing\` rows are what competitors are asking; \`estimate\` rows are SME reads on what the slot is worth; \`sale\` rows are completed prices.\n` +
      `- Reference these patterns where relevant — speak to ranges and recency.\n` +
      `- Never name individuals, breakers, platforms, or sources.\n` +
      `- Do not invent observations not listed here.\n` +
      `- Distinguish listing vs estimate voice where the data warrants it.\n`
    : '';

  const prompt = `You are a sports card break analyst at Card Breakerz. A collector is evaluating a bundled break configuration.

Product: ${product.name} (${product.year})
Sport: ${(product.sport as any)?.name ?? 'Unknown'}
Bundle composition: ${composition}
Format mix: ${formatSummary}
Selected teams:
${teamLines || '(none)'}
${extraPlayerLines ? `Standalone players:\n${extraPlayerLines}\n` : ''}
Pure model fair value: ${formatCurrency(fairValue)}
Market-adjusted fair value (signal reference): ${formatCurrency(marketFairValue)}
Bundle ask price: ${formatCurrency(askPrice)}
Signal: ${signal} (${Math.abs(valuePct).toFixed(1)}% ${valuePct >= 0 ? 'below' : 'above'} market value)

Top players in bundle:
${playerLines}

${rookieNote}${betsSection}${iconSection}${flagSection}${hvSection}${observationSection}

Write a 2–3 sentence analysis explaining whether this bundle is worth buying at this price. Be direct — lead with the signal. Mention the most important player(s) to hit, the rookie upside if applicable, and whether the price justifies the risk. If the bundle mixes teams and standalone players, briefly call out which slot is carrying the value. Use plain conversational language, no bullet points, no markdown.`;

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: MODELS.verdict,
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  }, { timeout: 15_000 });

  const analysis = (message.content[0] as { type: string; text: string }).text.trim();

  return {
    signal,
    valuePct,
    fairValue,
    marketFairValue,
    marketFairLow,
    marketFairHigh,
    lifecycleStatus,
    askPrice,
    analysis,
    topPlayers,
    teams,
    extraPlayerNames: extraPlayers.map(p => p.player.name),
    productName: product.name,
    formats: { hobby: config.hobbyCases, bd: config.bdCases, jumbo: config.jumboCases },
    riskFlags,
    hvPlayers,
    observationContext: {
      enabled: observationContextEnabled,
      applied: observationApplied,
      observationCount,
    },
  };
}
