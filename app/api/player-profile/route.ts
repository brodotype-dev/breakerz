import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { getComps } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const isDev = process.env.NODE_ENV === 'development';

async function isAuthed(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return true;
  return isDev;
}

// GET /api/player-profile?id=<player-uuid>
//
// Cross-product player profile: identity + every product the player is in
// (with EV per product where available) + recent graded sales aggregated
// from CardHedger across the player's products + BreakIQ insights (active
// risk flags, sentiment history, market observations).
//
// Each section is independently nullable so the UI can gray it out when
// empty. We intentionally don't call CardHedger when no player_products
// have a CH card_id — keeps the endpoint cheap for cold-cataloged players.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const playerId = req.nextUrl.searchParams.get('id');
  if (!playerId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // 1. Identity
  const { data: player, error: playerErr } = await supabaseAdmin
    .from('players')
    .select('id, name, team, is_rookie, is_icon, sports ( name )')
    .eq('id', playerId)
    .maybeSingle();

  if (playerErr) {
    console.error('[player-profile] identity', playerErr);
    return NextResponse.json({ error: 'Failed to load player' }, { status: 500 });
  }
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  type PlayerRow = {
    id: string;
    name: string;
    team: string | null;
    is_rookie: boolean | null;
    is_icon: boolean | null;
    sports: { name: string } | null;
  };
  const p = player as unknown as PlayerRow;

  // 2. Products + per-product EV + breakerz/buzz signals + breakerz_note
  const { data: ppRows, error: ppErr } = await supabaseAdmin
    .from('player_products')
    .select(`
      id,
      cardhedger_card_id,
      buzz_score,
      breakerz_score,
      breakerz_note,
      products ( id, name, slug, year, manufacturer, lifecycle_status, is_active, sport_id, sports ( name ) ),
      pricing_cache ( ev_low, ev_mid, ev_high, fetched_at )
    `)
    .eq('player_id', playerId);

  if (ppErr) {
    console.error('[player-profile] player_products', ppErr);
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  }

  type PriceCacheShape = { ev_low: number | null; ev_mid: number | null; ev_high: number | null; fetched_at: string | null };
  type PpRow = {
    id: string;
    cardhedger_card_id: string | null;
    buzz_score: number | null;
    breakerz_score: number | null;
    breakerz_note: string | null;
    products: {
      id: string;
      name: string;
      slug: string;
      year: string | null;
      manufacturer: string | null;
      lifecycle_status: 'pre_release' | 'live' | 'dormant';
      is_active: boolean | null;
      sports: { name: string } | null;
    } | null;
    // PostgREST returns a unique-constrained one-to-one as a single object,
    // but a non-unique join as an array. Handle both shapes defensively.
    pricing_cache: PriceCacheShape | PriceCacheShape[] | null;
  };

  function pickCache(raw: PpRow['pricing_cache']): PriceCacheShape | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw;
  }

  const lifecycleRank = { live: 0, pre_release: 1, dormant: 2 } as const;

  const products = ((ppRows ?? []) as unknown as PpRow[])
    .filter(r => r.products != null)
    .map(r => {
      const cache = pickCache(r.pricing_cache);
      return {
        player_product_id: r.id,
        product_id: r.products!.id,
        product_name: r.products!.name,
        product_slug: r.products!.slug,
        year: r.products!.year,
        manufacturer: r.products!.manufacturer,
        sport: r.products!.sports?.name ?? null,
        lifecycle_status: r.products!.lifecycle_status,
        is_active: !!r.products!.is_active,
        ev_mid: cache?.ev_mid ?? null,
        ev_low: cache?.ev_low ?? null,
        ev_high: cache?.ev_high ?? null,
        fetched_at: cache?.fetched_at ?? null,
        cardhedger_card_id: r.cardhedger_card_id,
        buzz_score: r.buzz_score ?? 0,
        breakerz_score: r.breakerz_score ?? 0,
        breakerz_note: r.breakerz_note,
      };
    })
    .sort((a, b) => {
      const lr = lifecycleRank[a.lifecycle_status] - lifecycleRank[b.lifecycle_status];
      if (lr !== 0) return lr;
      // Within the same lifecycle bucket, freshest pricing first.
      const aT = a.fetched_at ? new Date(a.fetched_at).getTime() : 0;
      const bT = b.fetched_at ? new Date(b.fetched_at).getTime() : 0;
      return bT - aT;
    });

  // Pick the same "best" product as /chase uses (most recent priced) so the
  // header EV reads consistently between the two pages.
  const featured = products.find(x => x.ev_mid != null) ?? null;

  // 3. Recent sales — pull a candidate pool of "base-ish" CH cards per
  //    product, then fetch comps for them in parallel.
  //
  //    The picker logic deserves the comment: a player_product can have
  //    many variants whose variant_name is literally "Base" (the real base
  //    card, plus every insert subset's base-of-subset row). Tied on length,
  //    PostgreSQL returns them in arbitrary order, which used to make us
  //    pick e.g. the Topps Chrome "Inspirational #IP-6" subset for Wemby
  //    instead of his actual #221 base. Score variants by:
  //      1. Card number is purely numeric (real bases: 1, 143, 221) wins
  //         over alphanumeric (inserts: IP-6, GT-11, SY-1).
  //      2. Then shortest variant_name as before.
  //    Take top 3 per pp to keep a safety net if the heuristic is wrong.
  //    Capped at 15 unique IDs total.
  const playerProductIds = ((ppRows ?? []) as unknown as PpRow[]).map(r => r.id);
  let candidateCardIds: string[] = [];
  if (playerProductIds.length > 0) {
    const { data: variantRows } = await supabaseAdmin
      .from('player_product_variants')
      .select('player_product_id, variant_name, card_number, cardhedger_card_id')
      .in('player_product_id', playerProductIds)
      .not('cardhedger_card_id', 'is', null);

    type VRow = {
      player_product_id: string;
      variant_name: string | null;
      card_number: string | null;
      cardhedger_card_id: string;
    };

    const numericNumber = /^\d+$/;
    const score = (v: VRow): number => {
      const numericBonus = v.card_number && numericNumber.test(v.card_number) ? 0 : 1000;
      const nameLen = v.variant_name?.length ?? 999;
      return numericBonus + nameLen;
    };

    // Bucket by pp; keep the 3 best-scoring variants per pp.
    const byPp = new Map<string, VRow[]>();
    for (const v of ((variantRows ?? []) as VRow[])) {
      const list = byPp.get(v.player_product_id) ?? [];
      list.push(v);
      byPp.set(v.player_product_id, list);
    }

    const seen = new Set<string>();
    for (const list of byPp.values()) {
      list.sort((a, b) => score(a) - score(b));
      for (const v of list.slice(0, 3)) {
        if (!seen.has(v.cardhedger_card_id)) seen.add(v.cardhedger_card_id);
        if (seen.size >= 15) break;
      }
      if (seen.size >= 15) break;
    }
    candidateCardIds = Array.from(seen);
  }

  let recentComps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> = [];
  if (candidateCardIds.length > 0) {
    // Three grades × N cards in parallel. Raw covers the bulk of the volume
    // for most players; PSA 9/10 surface graded sales. Promise.allSettled so
    // one bad ID doesn't kill the response.
    const calls: Promise<{ comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> }>[] = [];
    for (const cardId of candidateCardIds) {
      calls.push(getComps(cardId, 180, 'Raw',   10).catch(() => ({ comps: [] })));
      calls.push(getComps(cardId, 180, 'PSA 9', 10).catch(() => ({ comps: [] })));
      calls.push(getComps(cardId, 180, 'PSA 10', 10).catch(() => ({ comps: [] })));
    }
    const settled = await Promise.allSettled(calls);
    for (const r of settled) {
      if (r.status === 'fulfilled' && Array.isArray(r.value.comps)) {
        recentComps.push(...r.value.comps);
      }
    }
    // Dedupe (same sale can appear if multiple variants point to the same
    // CH listing), then sort by date desc and cap.
    const dedup = new Map<string, typeof recentComps[number]>();
    for (const c of recentComps) {
      const key = `${c.sale_date}|${c.sale_price}|${c.grade}|${c.platform}`;
      if (!dedup.has(key)) dedup.set(key, c);
    }
    recentComps = Array.from(dedup.values())
      .sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime())
      .slice(0, 25);
  }

  // 4. Insights — risk flags + recent sentiment history + active market
  //    observations. Reuses the playerProductIds list from the comp-fetch
  //    step above.
  const flagsResp = playerProductIds.length === 0
    ? { data: [] as Array<{ player_product_id: string; flag_type: string; note: string | null; created_at: string }>, error: null }
    : await supabaseAdmin
        .from('player_risk_flags')
        .select('player_product_id, flag_type, note, created_at')
        .in('player_product_id', playerProductIds)
        .is('cleared_at', null)
        .order('created_at', { ascending: false });

  if (flagsResp.error) {
    console.error('[player-profile] flags', flagsResp.error);
  }

  // Sentiment history — keyed by player_id directly
  const { data: sentimentRows } = await supabaseAdmin
    .from('breakerz_sentiment_history')
    .select('id, prev_score, new_score, prev_note, new_note, source, source_narrative, created_at')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(8);

  // Market observations — variant scope keys on player_id implicitly, player
  // scope keys directly. We filter both.
  const { data: obsRows } = await supabaseAdmin
    .from('market_observations')
    .select('id, observation_type, scope_type, scope_id, payload, source_narrative, observed_at, expires_at, superseded_at, products ( name, slug )')
    .eq('scope_type', 'player')
    .eq('scope_id', playerId)
    .is('superseded_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('observed_at', { ascending: false })
    .limit(10);

  type FlagRow = { player_product_id: string; flag_type: string; note: string | null; created_at: string };
  type SentimentRow = {
    id: string;
    prev_score: number | null;
    new_score: number | null;
    prev_note: string | null;
    new_note: string | null;
    source: string;
    source_narrative: string | null;
    created_at: string;
  };
  type ObsRow = {
    id: string;
    observation_type: string;
    scope_type: string;
    scope_id: string | null;
    payload: Record<string, unknown> | null;
    source_narrative: string | null;
    observed_at: string;
    expires_at: string | null;
    superseded_at: string | null;
    products: { name: string; slug: string } | null;
  };

  // Map flags back to their product name for display.
  const ppToProduct = new Map<string, { name: string; slug: string }>();
  for (const r of (ppRows ?? []) as unknown as PpRow[]) {
    if (r.products) ppToProduct.set(r.id, { name: r.products.name, slug: r.products.slug });
  }
  const riskFlags = ((flagsResp.data ?? []) as FlagRow[]).map(f => ({
    flag_type: f.flag_type,
    note: f.note,
    created_at: f.created_at,
    product: ppToProduct.get(f.player_product_id) ?? null,
  }));

  // Effective B-score from the featured product (or the highest-buzz pp).
  const featuredScore = featured ?? (products.find(x => x.buzz_score != null) ?? products[0] ?? null);

  // Normalize the supabase select-with-FK shape — `products(...)` may come
  // back as an array even though it's a one-to-one for these rows.
  const observations = ((obsRows ?? []) as unknown as Array<Omit<ObsRow, 'products'> & { products: ObsRow['products'] | { name: string; slug: string }[] | null }>)
    .map(o => ({
      ...o,
      products: Array.isArray(o.products) ? (o.products[0] ?? null) : o.products,
    })) as ObsRow[];

  return NextResponse.json({
    player: {
      id: p.id,
      name: p.name,
      team: p.team,
      sport: p.sports?.name ?? null,
      is_rookie: !!p.is_rookie,
      is_icon: !!p.is_icon,
      buzz_score: featuredScore?.buzz_score ?? 0,
      breakerz_score: featuredScore?.breakerz_score ?? 0,
      breakerz_note: featuredScore?.breakerz_note ?? null,
    },
    featured_market: featured
      ? {
          ev_low: featured.ev_low,
          ev_mid: featured.ev_mid,
          ev_high: featured.ev_high,
          fetched_at: featured.fetched_at,
          product_name: featured.product_name,
          product_slug: featured.product_slug,
        }
      : null,
    products,
    recent_comps: recentComps,
    insights: {
      risk_flags: riskFlags,
      sentiment: (sentimentRows ?? []) as SentimentRow[],
      observations,
    },
  });
}
