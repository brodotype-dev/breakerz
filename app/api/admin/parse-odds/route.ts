import { NextRequest, NextResponse } from 'next/server';
import { parseOddsPdf } from '@/lib/checklist-parser';

export const dynamic = 'force-dynamic';

async function extractOddsPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    parser.on('pdfParser_dataReady', (data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const pageLines: string[] = [];

      for (const page of data.Pages) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const lineMap = new Map<number, Array<{ x: number; text: string }>>();

        for (const item of page.Texts) { // eslint-disable-line @typescript-eslint/no-explicit-any
          const text = decodeURIComponent(item.R.map((r: any) => r.T).join('')); // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!text.trim()) continue;
          const y = Math.round(item.y * 10);
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.x, text });
        }

        Array.from(lineMap.entries())
          .sort(([a], [b]) => a - b)
          .forEach(([, items]) => {
            const line = items.sort((a, b) => a.x - b.x).map(i => i.text).join('   ');
            // Normalize odds tokens: "1:   79,764" → "1:79764"
            // pdf2json splits "1:" and the number into separate items
            const normalized = line
              .replace(/1:\s+([\d,]+)/g, (_, n) => '1:' + n.replace(/,/g, ''));
            pageLines.push(normalized);
          });

        pageLines.push('');
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
  try {
    const text = await extractOddsPdfText(buffer);
    const odds = parseOddsPdf(text);
    return NextResponse.json({ odds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
