import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { searchSets } from '@/lib/cardhedger';

export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { query, category } = await req.json();
  if (!query?.trim()) return NextResponse.json({ sets: [] });

  try {
    const result = await searchSets(query.trim(), category);
    return NextResponse.json({ sets: result.sets ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Set search failed' },
      { status: 500 }
    );
  }
}
