import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/admin/players/search?q=string&limit=25
//
// Admin-gated player search for the global /admin/players directory. Middleware
// protects /api/admin/* so no per-route auth check is needed. Returns the rich
// shape the global manager needs: icon + high-volatility (both player-global as
// of the 2026-06-02 re-model) plus the player's active risk flags, deduped.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 25));

  if (q.length < 2) return NextResponse.json({ players: [] });

  const escaped = q.replace(/[\\%_]/g, m => `\\${m}`);

  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id, name, team, is_rookie, is_icon, is_high_volatility, sports ( name )')
    .ilike('name', `%${escaped}%`)
    .order('name', { ascending: true })
    .limit(limit);

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
  const rows = (data as unknown as Row[]) ?? [];

  // Active flags for the matched players, deduped (player+type+note) against
  // any legacy fan-out copies still in the table.
  const ids = rows.map(r => r.id);
  const flagsByPlayer = new Map<string, Array<{ id: string; flagType: string; note: string }>>();
  if (ids.length) {
    const { data: flagRows } = await supabaseAdmin
      .from('player_risk_flags')
      .select('id, player_id, flag_type, note')
      .in('player_id', ids)
      .is('cleared_at', null)
      .order('created_at', { ascending: true });
    const seen = new Set<string>();
    for (const f of (flagRows ?? []) as Array<{ id: string; player_id: string; flag_type: string; note: string }>) {
      const key = `${f.player_id}|${f.flag_type}|${f.note}`;
      if (seen.has(key)) continue;
      seen.add(key);
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

  return NextResponse.json({ players });
}
