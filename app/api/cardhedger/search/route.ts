import { NextRequest, NextResponse } from 'next/server';
import { searchCards } from '@/lib/cardhedger';
import { createClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { query, sport } = await req.json();
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

    const result = await searchCards(sport ? `${query} ${sport}` : query);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
