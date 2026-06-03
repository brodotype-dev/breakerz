import { Users } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import GlobalPlayersManager, { type GlobalPlayerRow } from './GlobalPlayersManager';

// Global player directory. Re-modeled 2026-06-02: icon tier, high-volatility,
// and risk flags are player-global attributes (they describe the athlete, not
// the card-in-a-product), so they're edited here rather than inside each
// product's roster.
//
// The players table is large (~7.8k rows, over PostgREST's 1k cap), so the
// default view server-loads only the "managed" set — players that already have
// an attribute set (icon / HV / active flag). The client manager's search box
// hits /api/admin/players/search to find and manage anyone else.

export const dynamic = 'force-dynamic';

type PlayerRowDb = {
  id: string;
  name: string;
  team: string | null;
  is_rookie: boolean | null;
  is_icon: boolean | null;
  is_high_volatility: boolean | null;
  sports: { name: string } | null;
};

export default async function AdminPlayersPage() {
  // Active flags first — they define part of the managed set and attach to rows.
  const { data: flagRows } = await supabaseAdmin
    .from('player_risk_flags')
    .select('id, player_id, flag_type, note')
    .is('cleared_at', null)
    .order('created_at', { ascending: true });

  // Dedup the legacy fan-out (same player+type+note across products).
  const flagsByPlayer = new Map<string, Array<{ id: string; flagType: string; note: string }>>();
  const seenFlag = new Set<string>();
  for (const f of (flagRows ?? []) as Array<{ id: string; player_id: string; flag_type: string; note: string }>) {
    if (!f.player_id) continue;
    const key = `${f.player_id}|${f.flag_type}|${f.note}`;
    if (seenFlag.has(key)) continue;
    seenFlag.add(key);
    const arr = flagsByPlayer.get(f.player_id) ?? [];
    arr.push({ id: f.id, flagType: f.flag_type, note: f.note });
    flagsByPlayer.set(f.player_id, arr);
  }

  // Players with an attribute set (icon or HV).
  const { data: attrRows } = await supabaseAdmin
    .from('players')
    .select('id, name, team, is_rookie, is_icon, is_high_volatility, sports(name)')
    .or('is_icon.eq.true,is_high_volatility.eq.true')
    .order('name', { ascending: true });

  const byId = new Map<string, PlayerRowDb>();
  for (const p of (attrRows ?? []) as unknown as PlayerRowDb[]) byId.set(p.id, p);

  // Pull in flagged players that aren't already covered by the attr query.
  const missingIds = [...flagsByPlayer.keys()].filter(id => !byId.has(id));
  if (missingIds.length) {
    const { data: extra } = await supabaseAdmin
      .from('players')
      .select('id, name, team, is_rookie, is_icon, is_high_volatility, sports(name)')
      .in('id', missingIds);
    for (const p of (extra ?? []) as unknown as PlayerRowDb[]) byId.set(p.id, p);
  }

  const managed: GlobalPlayerRow[] = [...byId.values()]
    .map(p => ({
      playerId: p.id,
      name: p.name,
      team: p.team ?? '',
      sport: p.sports?.name ?? null,
      isRookie: !!p.is_rookie,
      isIcon: !!p.is_icon,
      isHighVolatility: !!p.is_high_volatility,
      activeFlags: flagsByPlayer.get(p.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Dropdown options for the filter bar.
  const [{ data: sportRows }, { data: productRows }] = await Promise.all([
    supabaseAdmin.from('sports').select('id, name').order('name', { ascending: true }),
    supabaseAdmin
      .from('products')
      .select('id, name, year')
      .eq('is_active', true)
      .order('year', { ascending: false })
      .order('name', { ascending: true }),
  ]);
  const sports = ((sportRows ?? []) as Array<{ id: string; name: string }>).map(s => ({ id: s.id, name: s.name }));
  const products = ((productRows ?? []) as Array<{ id: string; name: string; year: string | null }>)
    .map(p => ({ id: p.id, label: `${p.year ? `${p.year} ` : ''}${p.name}` }));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Users className="w-5 h-5" />
          Players
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Global player attributes — icon tier, high-volatility, and risk flags. These follow the
          player across every product. Search or filter to manage any player; the list below shows
          everyone who already has an attribute set. Click a name to see their products.
        </p>
      </div>

      <GlobalPlayersManager initialManaged={managed} sports={sports} products={products} />
    </div>
  );
}
