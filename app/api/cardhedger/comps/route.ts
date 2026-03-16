import { NextRequest, NextResponse } from 'next/server';
import { getComps } from '@/lib/cardhedger';

export async function POST(req: NextRequest) {
  try {
    const { cardId, days } = await req.json();
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });

    const result = await getComps(cardId, days ?? 90);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
