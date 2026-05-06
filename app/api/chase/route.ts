import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { listChaseForUser, chaseSetForUser } from '@/lib/chase';

export const dynamic = 'force-dynamic';

const isDev = process.env.NODE_ENV === 'development';

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user.id;
  if (isDev) {
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    return data?.id ?? null;
  }
  return null;
}

// GET /api/chase
//   default            → full list with computed market data per player
//   ?ids=p1,p2,p3      → returns just `{ ids: string[] }` of which of those
//                        player_ids are saved (used by <ChaseHeartButton>'s
//                        hydrating set on a page mount — no per-row API call)
export async function GET(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const idsParam = req.nextUrl.searchParams.get('ids');
  if (idsParam) {
    const ids = idsParam.split(',').filter(Boolean).slice(0, 500);
    const set = await chaseSetForUser(userId, ids);
    return NextResponse.json({ ids: Array.from(set) });
  }

  try {
    const list = await listChaseForUser(userId);
    return NextResponse.json({ entries: list });
  } catch (err) {
    console.error('[GET /api/chase]', err);
    return NextResponse.json({ error: 'Failed to load chase list' }, { status: 500 });
  }
}

// POST /api/chase  body: { player_id }
// Idempotent — re-adding an already-saved player is a no-op.
export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { player_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const playerId = typeof body.player_id === 'string' ? body.player_id : null;
  if (!playerId) return NextResponse.json({ error: 'player_id required' }, { status: 400 });

  // Defensive — confirm the player exists. RLS would reject silently otherwise
  // since chase rows reference players by FK.
  const { data: player, error: playerErr } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('id', playerId)
    .maybeSingle();
  if (playerErr || !player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('user_chase_list')
    .upsert({ user_id: userId, player_id: playerId }, { onConflict: 'user_id,player_id', ignoreDuplicates: true });

  if (error) {
    console.error('[POST /api/chase]', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
