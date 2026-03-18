import { NextRequest, NextResponse } from 'next/server';
import { parseOddsPdf } from '@/lib/checklist-parser';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const odds = parseOddsPdf(data.text);
    return NextResponse.json({ odds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
