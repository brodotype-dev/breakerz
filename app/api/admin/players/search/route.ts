import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { looksLikeRealPlayerName } from '@/lib/checklist-aggregates';

export const dynamic = 'force-dynamic';

// GET /api/admin/players/search?q=&sport=&productId=&rookie=&limit=
//
// Admin-gated player query for the global /admin/players directory. Middleware
// protects /api/admin/* so no per-route auth check is needed. Returns the rich
// shape the global manager needs (icon + high-volatility + active risk flags +
// is_rookie + sport), and supports four orthogonal filters that AND together:
//   q         — name ilike (≥2 chars)
//   sport     — players.sport_id
//   productId — players in this product (inner join on player_products)
//   rookie    — 'yes' | 'no' (is_rookie)
// Returns [] when no filter is active (the page server-renders the managed set
// for the empty state).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const sportId = (sp.get('sport') ?? '').trim();
  const productId = (sp.get('productId') ?? '').trim();
  const rookie = (sp.get('rookie') ?? '').trim(); // 'yes' | 'no' | ''
  const rawLimit = parseInt(sp.get('limit') ?? '300', 10);
  const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 300));

  const hasNameSearch = q.length >= 2;
  const hasFilter = hasNameSearch || !!sportId || !!productId || rookie === 'yes' || rookie === 'no';
  if (!hasFilter) return NextResponse.json({ players: [], truncated: false });

  const selectCols = productId
    ? 'id, name, team, is_rookie, is_icon, is_high_volatility, sports(name), player_products!inner(product_id)'
    : 'id, name, team, is_rookie, is_icon, is_high_volatility, sports(name)';

  let query = supabaseAdmin.from('players').select(selectCols);
  if (productId) query = query.eq('player_products.product_id', productId);
  if (hasNameSearch) {
    const escaped = q.replace(/[\\%_]/g, m => `\\${m}`);
    query = query.ilike('name', `%${escaped}%`);
  }
  if (sportId) query = query.eq('sport_id', sportId);
  if (rookie === 'yes') query = query.eq('is_rookie', true);
  else if (rookie === 'no') query = query.eq('is_rookie', false);

  const { data, error } = await query.order('name', { ascending: true }).limit(limit + 1);
  if (error) {
    console.error('[GET /api/admin/players/search]', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    team: string | null;
    is_rookie: boolean | null;
    is_icon: boolean | null;
    is_high_volatility: boolean | null;
    sports: { name: string } | null;
  };
  // Dedup by id (the product inner-join can repeat a player) and detect the
  // over-fetch sentinel for truncation.
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const r of (data as unknown as Row[]) ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    // Drop card-code / card-number junk rows (e.g. "90CAS-DO", "221",
    // "B25-ÉP") that mis-parsed into the players table. These are all
    // insert-only subset cards quarantined everywhere else in the app; the
    // global directory should hide them too. See 2026-06-03 data note.
    if (!looksLikeRealPlayerName(r.name)) continue;
    rows.push(r);
  }
  const truncated = rows.length > limit;
  if (truncated) rows.length = limit;

  // Active flags for the matched players, deduped (player+type+note) against any
  // legacy fan-out copies still in the table.
  const ids = rows.map(r => r.id);
  const flagsByPlayer = new Map<string, Array<{ id: string; flagType: string; note: string }>>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data: flagRows } = await supabaseAdmin
      .from('player_risk_flags')
      .select('id, player_id, flag_type, note')
      .in('player_id', slice)
      .is('cleared_at', null)
      .order('created_at', { ascending: true });
    const seenFlag = new Set<string>();
    for (const f of (flagRows ?? []) as Array<{ id: string; player_id: string; flag_type: string; note: string }>) {
      const key = `${f.player_id}|${f.flag_type}|${f.note}`;
      if (seenFlag.has(key)) continue;
      seenFlag.add(key);
      const arr = flagsByPlayer.get(f.player_id) ?? [];
      arr.push({ id: f.id, flagType: f.flag_type, note: f.note });
      flagsByPlayer.set(f.player_id, arr);
    }
  }

  const players = rows.map(r => ({
    playerId: r.id,
    name: r.name,
    team: r.team ?? '',
    sport: r.sports?.name ?? null,
    isRookie: !!r.is_rookie,
    isIcon: !!r.is_icon,
    isHighVolatility: !!r.is_high_volatility,
    activeFlags: flagsByPlayer.get(r.id) ?? [],
  }));

  return NextResponse.json({ players, truncated });
}
