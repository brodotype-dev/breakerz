import { NextRequest, NextResponse } from 'next/server';
import { parseChecklistPdf, parseChecklistCsv } from '@/lib/checklist-parser';

export const dynamic = 'force-dynamic';

// Re-export ParsedPlayer for backward compatibility with ChecklistUpload.tsx
// (that component still imports from this route path)
export type ParsedPlayer = {
  name: string;
  team: string;
  isRookie: boolean;
  insertOnly: boolean;
};

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf2json is pure Node.js with no canvas / DOM dependencies.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on('pdfParser_dataReady', (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const text = data.Pages
        .map((page: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
          page.Texts
            .map((t: any) => decodeURIComponent(t.R.map((r: any) => r.T).join(''))) // eslint-disable-line @typescript-eslint/no-explicit-any
            .join(' ')
        )
        .join('\n');
      resolve(text);
    });

    parser.on('pdfParser_dataError', (err: any) => reject(new Error(err?.parserError ?? 'PDF parse error'))); // eslint-disable-line @typescript-eslint/no-explicit-any

    parser.parseBuffer(buffer);
  });
}

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
      const text = await extractPdfText(buffer);
      const checklist = parseChecklistPdf(text);
      return NextResponse.json({ checklist });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
