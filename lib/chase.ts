import { supabaseAdmin } from '@/lib/supabase';
import type { ChaseListEntry } from '@/lib/types';

// Returns the user's chase list with computed market data per saved player.
// One row per saved player; market is null when no pricing has landed yet for
// any of the player's player_products.
//
// We do the heavy lifting in JS rather than a single complex SQL query because
// the Supabase JS client doesn't expose LATERAL joins cleanly and the row
// counts are small (a few dozen players per user). Three round-trips total —
// fine for a list view that loads once.
export async function listChaseForUser(userId: string): Promise<ChaseListEntry[]> {
  // 1. Saved players. buzz/breakerz live on player_products (per product),
  //    not on players, so this query only pulls the immutable identity bits.
  const { data: rows, error: chaseErr } = await supabaseAdmin
    .from('user_chase_list')
    .select('player_id, added_at, players ( id, name, team, is_rookie, is_icon )')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (chaseErr) throw chaseErr;
  if (!rows || rows.length === 0) return [];

  const playerIds = rows.map(r => r.player_id);

  // 2. Per-player most-recent pricing_cache row across all of that player's
  //    player_products. We pull pp + pc + product in one shot, then pick the
  //    freshest per player_id in JS. Also captures buzz_score/breakerz_score
  //    from that same winning player_product row so the chase entry shows
  //    the signals from the freshest market data we have.
  const { data: pricedRows, error: priceErr } = await supabaseAdmin
    .from('player_products')
    .select(`
      id,
      player_id,
      buzz_score,
      breakerz_score,
      products ( id, name, slug ),
      pricing_cache ( ev_mid, fetched_at )
    `)
    .in('player_id', playerIds);

  if (priceErr) throw priceErr;

  type PricedRow = {
    id: string;
    player_id: string;
    buzz_score: number | null;
    breakerz_score: number | null;
    products: { id: string; name: string; slug: string } | null;
    pricing_cache: { ev_mid: number | null; fetched_at: string | null }[] | null;
  };

  // Track best (most-recent) market data per player. Also remember the
  // winning row's buzz/breakerz so the entry's signals come from the same
  // player_product as the price.
  const bestByPlayer = new Map<string, {
    market: NonNullable<ChaseListEntry['market']>;
    buzz_score: number;
    breakerz_score: number;
  }>();
  // Fallback signals if no priced player_product exists for this player —
  // use whatever buzz/breakerz the highest-buzz player_product has.
  const fallbackSignalsByPlayer = new Map<string, { buzz_score: number; breakerz_score: number }>();
  // player_product_id → player_id. Its values() give the distinct player ids
  // we fetch player-global risk flags for.
  const ppToPlayer = new Map<string, string>();

  for (const raw of (pricedRows ?? []) as unknown as PricedRow[]) {
    ppToPlayer.set(raw.id, raw.player_id);

    // Always update the fallback to track the highest-buzz player_product.
    const buzz = raw.buzz_score ?? 0;
    const brkrz = raw.breakerz_score ?? 0;
    const fb = fallbackSignalsByPlayer.get(raw.player_id);
    if (!fb || buzz > fb.buzz_score) {
      fallbackSignalsByPlayer.set(raw.player_id, { buzz_score: buzz, breakerz_score: brkrz });
    }

    const cache = raw.pricing_cache?.[0];
    if (!cache?.fetched_at || cache.ev_mid == null || !raw.products) continue;
    const existing = bestByPlayer.get(raw.player_id);
    if (!existing || new Date(cache.fetched_at) > new Date(existing.market.fetched_at)) {
      bestByPlayer.set(raw.player_id, {
        market: {
          ev_mid: cache.ev_mid,
          product_id: raw.products.id,
          product_slug: raw.products.slug,
          product_name: raw.products.name,
          fetched_at: cache.fetched_at,
        },
        buzz_score: buzz,
        breakerz_score: brkrz,
      });
    }
  }

  // 3. Active risk flags — player-global now (2026-06-02). Query by player_id
  //    directly; dedup the legacy Discord fan-out.
  const allPlayerIds = [...new Set(ppToPlayer.values())];
  const flagRowsResp = allPlayerIds.length === 0
    ? { data: [] as Array<{ player_id: string; flag_type: string; note: string | null }>, error: null }
    : await supabaseAdmin
        .from('player_risk_flags')
        .select('player_id, flag_type, note')
        .in('player_id', allPlayerIds)
        .is('cleared_at', null);

  if (flagRowsResp.error) throw flagRowsResp.error;

  const flagsByPlayer = new Map<string, Array<{ flag_type: string; note: string }>>();
  const seenFlagKey = new Set<string>();
  for (const f of flagRowsResp.data ?? []) {
    const key = `${f.player_id}|${f.flag_type}|${f.note ?? ''}`;
    if (seenFlagKey.has(key)) continue;
    seenFlagKey.add(key);
    const list = flagsByPlayer.get(f.player_id) ?? [];
    list.push({ flag_type: f.flag_type, note: f.note ?? '' });
    flagsByPlayer.set(f.player_id, list);
  }

  // 4. Stitch
  type ChaseRow = {
    player_id: string;
    added_at: string;
    players: {
      id: string;
      name: string;
      team: string | null;
      is_rookie: boolean | null;
      is_icon: boolean | null;
    } | null;
  };

  return (rows as unknown as ChaseRow[])
    .filter(r => r.players != null)
    .map((r): ChaseListEntry => {
      const best = bestByPlayer.get(r.player_id);
      const fb = fallbackSignalsByPlayer.get(r.player_id);
      return {
        player_id: r.player_id,
        player_name: r.players!.name,
        team: r.players!.team,
        is_rookie: !!r.players!.is_rookie,
        is_icon: !!r.players!.is_icon,
        buzz_score: best?.buzz_score ?? fb?.buzz_score ?? 0,
        breakerz_score: best?.breakerz_score ?? fb?.breakerz_score ?? 0,
        added_at: r.added_at,
        market: best?.market ?? null,
        risk_flags: flagsByPlayer.get(r.player_id) ?? [],
      };
    });
}

// Returns the set of player_ids on the calling user's chase list, scoped to
// the players we're rendering on the current page. Used to hydrate
// <ChaseHeartButton> initial state across the visible list without a
// per-row API call.
export async function chaseSetForUser(userId: string, playerIds: string[]): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from('user_chase_list')
    .select('player_id')
    .eq('user_id', userId)
    .in('player_id', playerIds);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.player_id));
}
