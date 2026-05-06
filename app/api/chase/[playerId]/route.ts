import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

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

// DELETE /api/chase/[playerId]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { playerId } = await ctx.params;
  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('user_chase_list')
    .delete()
    .eq('user_id', userId)
    .eq('player_id', playerId);

  if (error) {
    console.error('[DELETE /api/chase/[playerId]]', error);
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
