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
  // pdfjs-dist does pure-JS text extraction with no canvas/browser APIs needed.
  // Use the legacy build which ships a self-contained bundle for Node.js.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDocument, GlobalWorkerOptions } = require('pdfjs-dist/legacy/build/pdf.mjs');
  GlobalWorkerOptions.workerSrc = '';  // disable web worker in Node.js

  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(pageText);
  }

  return pages.join('\n');
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
