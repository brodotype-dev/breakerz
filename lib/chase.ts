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
  // 1. Saved players
  const { data: rows, error: chaseErr } = await supabaseAdmin
    .from('user_chase_list')
    .select('player_id, added_at, players ( id, name, team, is_rookie, is_icon, buzz_score, breakerz_score )')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (chaseErr) throw chaseErr;
  if (!rows || rows.length === 0) return [];

  const playerIds = rows.map(r => r.player_id);

  // 2. Per-player most-recent pricing_cache row across all of that player's
  //    player_products. We pull pp + pc + product in one shot, then pick the
  //    freshest per player_id in JS.
  const { data: pricedRows, error: priceErr } = await supabaseAdmin
    .from('player_products')
    .select(`
      id,
      player_id,
      products ( id, name, slug ),
      pricing_cache ( ev_mid, fetched_at )
    `)
    .in('player_id', playerIds);

  if (priceErr) throw priceErr;

  type PricedRow = {
    player_id: string;
    products: { id: string; name: string; slug: string } | null;
    pricing_cache: { ev_mid: number | null; fetched_at: string | null }[] | null;
  };

  const bestByPlayer = new Map<string, ChaseListEntry['market']>();
  for (const raw of (pricedRows ?? []) as unknown as PricedRow[]) {
    const cache = raw.pricing_cache?.[0];
    if (!cache?.fetched_at || cache.ev_mid == null || !raw.products) continue;
    const existing = bestByPlayer.get(raw.player_id);
    if (!existing || new Date(cache.fetched_at) > new Date(existing.fetched_at)) {
      bestByPlayer.set(raw.player_id, {
        ev_mid: cache.ev_mid,
        product_id: raw.products.id,
        product_slug: raw.products.slug,
        product_name: raw.products.name,
        fetched_at: cache.fetched_at,
      });
    }
  }

  // 3. Active risk flags for these players
  const { data: flagRows, error: flagErr } = await supabaseAdmin
    .from('player_risk_flags')
    .select('player_id, flag_type, note')
    .in('player_id', playerIds)
    .is('cleared_at', null);

  if (flagErr) throw flagErr;

  const flagsByPlayer = new Map<string, Array<{ flag_type: string; note: string }>>();
  for (const f of flagRows ?? []) {
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
      buzz_score: number | null;
      breakerz_score: number | null;
    } | null;
  };

  return (rows as unknown as ChaseRow[])
    .filter(r => r.players != null)
    .map((r): ChaseListEntry => ({
      player_id: r.player_id,
      player_name: r.players!.name,
      team: r.players!.team,
      is_rookie: !!r.players!.is_rookie,
      is_icon: !!r.players!.is_icon,
      buzz_score: r.players!.buzz_score ?? 0,
      breakerz_score: r.players!.breakerz_score ?? 0,
      added_at: r.added_at,
      market: bestByPlayer.get(r.player_id) ?? null,
      risk_flags: flagsByPlayer.get(r.player_id) ?? [],
    }));
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
