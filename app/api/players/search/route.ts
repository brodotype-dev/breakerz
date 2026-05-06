import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const isDev = process.env.NODE_ENV === 'development';

async function isAuthed(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return true;
  return isDev;
}

// GET /api/players/search?q=string&limit=20
//
// Auth-gated player name search. Used by /chase to let consumers find any
// player in the database and heart them without first navigating to a break
// page. Returns up to `limit` matches (default 20, capped at 50), ordered
// alphabetically. The result shape mirrors what ChaseListEntry needs to
// render a row plus a heart — sport name is included so the consumer can
// disambiguate two athletes who share a name across sports.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));

  if (q.length < 2) return NextResponse.json({ players: [] });

  // Escape ILIKE wildcards in user input so a search for "100%" doesn't act
  // like a wildcard match.
  const escaped = q.replace(/[\\%_]/g, m => `\\${m}`);

  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id, name, team, is_rookie, is_icon, sports ( name )')
    .ilike('name', `%${escaped}%`)
    .order('name', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[GET /api/players/search]', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    team: string | null;
    is_rookie: boolean | null;
    is_icon: boolean | null;
    sports: { name: string } | null;
  };

  const players = (data as unknown as Row[]).map(r => ({
    id: r.id,
    name: r.name,
    team: r.team,
    is_rookie: !!r.is_rookie,
    is_icon: !!r.is_icon,
    sport: r.sports?.name ?? null,
  }));

  return NextResponse.json({ players });
}
