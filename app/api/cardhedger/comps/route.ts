import { NextRequest, NextResponse } from 'next/server';
import { getComps } from '@/lib/cardhedger';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { cardId, days, grade, count } = await req.json();
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });

    const result = await getComps(cardId, days ?? 180, grade ?? 'Raw', count ?? 10);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
