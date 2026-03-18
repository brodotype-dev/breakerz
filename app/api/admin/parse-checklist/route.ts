import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
import { parseChecklistPdf, parseChecklistCsv } from '@/lib/checklist-parser';

// Re-export ParsedPlayer for backward compatibility with ChecklistUpload.tsx
// (that component still imports from this route path)
export type ParsedPlayer = {
  name: string;
  team: string;
  isRookie: boolean;
  insertOnly: boolean;
};

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  try {
    if (fileName.endsWith('.csv')) {
      const text = buffer.toString('utf-8');
      const checklist = parseChecklistCsv(text);
      return NextResponse.json({ checklist });
    } else {
      // PDF
      const data = await pdfParse(buffer);
      const checklist = parseChecklistPdf(data.text);
      return NextResponse.json({ checklist });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
