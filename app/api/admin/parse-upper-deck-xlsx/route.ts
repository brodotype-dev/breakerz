import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { parseUpperDeckXlsx } from '@/lib/upper-deck-parser';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Multipart upload of the Beckett-published Upper Deck / O-Pee-Chee
// XLSX. Returns both checklist and odds extracted from the "Master Card
// List" sheet. See docs/manufacturer-rules/upper-deck.md.
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await parseUpperDeckXlsx(buffer);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
