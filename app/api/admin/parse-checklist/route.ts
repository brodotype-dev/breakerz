import { NextRequest, NextResponse } from 'next/server';
import { parseChecklistPdf, parseChecklistCsv, parseChecklistXlsx } from '@/lib/checklist-parser';

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
  // It returns individual text items with x/y coordinates rather than
  // pre-assembled lines. We group items by y position and join them with
  // fixed spacing so the checklist parser's column-aware regexes still match.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on('pdfParser_dataReady', (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const pageLines: string[] = [];

      for (const page of data.Pages) { // eslint-disable-line @typescript-eslint/no-explicit-any
        // Group text items by rounded y (0.1 unit tolerance handles float drift)
        const lineMap = new Map<number, Array<{ x: number; text: string }>>();

        for (const item of page.Texts) { // eslint-disable-line @typescript-eslint/no-explicit-any
          const text = decodeURIComponent(item.R.map((r: any) => r.T).join('')); // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!text.trim()) continue;
          const y = Math.round(item.y * 10); // key in tenths of a unit
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.x, text });
        }

        // Sort rows by y, reconstruct each row left-to-right
        const sortedRows = Array.from(lineMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([, items]) => items.sort((a, b) => a.x - b.x));

        for (const items of sortedRows) {
          // Prepend 6 spaces (satisfies ^\s{2,} in numbered-line regex),
          // join text items with 3 spaces (satisfies \s{1,6} and \s{2,} gaps).
          pageLines.push('      ' + items.map(i => i.text).join('   '));
        }

        pageLines.push(''); // blank line between pages
      }

      resolve(pageLines.join('\n'));
    });

    parser.on('pdfParser_dataError', (err: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      reject(new Error(err?.parserError ?? 'PDF parse error')));

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
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const checklist = parseChecklistXlsx(buffer);
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
