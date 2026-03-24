import { NextRequest, NextResponse } from 'next/server';
import { getAllPrices } from '@/lib/cardhedger';

export async function POST(req: NextRequest) {
  try {
    const { cardId } = await req.json();
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });

    const result = await getAllPrices(cardId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
