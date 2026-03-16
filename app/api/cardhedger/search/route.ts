import { NextRequest, NextResponse } from 'next/server';
import { searchCards } from '@/lib/cardhedger';

export async function POST(req: NextRequest) {
  try {
    const { query, sport } = await req.json();
    if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

    const result = await searchCards(query, sport);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
