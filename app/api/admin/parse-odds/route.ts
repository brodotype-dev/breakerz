import { NextRequest, NextResponse } from 'next/server';
import type { ParsedOdds } from '@/lib/checklist-parser';

export const dynamic = 'force-dynamic';

// Coordinate-aware extractor for Topps multi-column odds PDFs.
//
// The PDF has 16 product-type columns (Distributor Jumbo, Hobby Box, HTA, Display, ...).
// We want the HOBBY BOX column only. pdf2json gives us each text item with x/y coords,
// so we can identify which column a token belongs to rather than relying on text order.
//
// Strategy:
//   1. Find the first "full" data row (≥10 odds tokens) — the 2nd "1:" x-position is Hobby Box.
//   2. For each subsequent row, find the "1:" token closest to hobbyX (±COL_TOLERANCE).
//   3. Subset names are label items at x < LABEL_CUTOFF.
//   4. Continuation rows (no odds/dash column items, all-caps label) get appended to the
//      previous emitted row's name. Mixed-case rows are page titles and are skipped.
//   5. A row that has column data but no hobby odds resets the continuation target so its
//      continuation lines don't bleed into the previous emitted row.
async function extractOddsPdfData(buffer: Buffer): Promise<ParsedOdds> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.on('pdfParser_dataReady', (data: any) => {
      const rows: ParsedOdds['rows'] = [];

      const LABEL_CUTOFF = 6.0;  // x < this → label token; x >= this → column data token
      const COL_TOLERANCE = 2.5; // max x-distance from hobbyX to match a token

      let hobbyX: number | null = null;
      let lastEmittedIdx = -1; // rows[] index of last emitted row; -1 means no valid target

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const page of data.Pages) {
        const lineMap = new Map<number, Array<{ x: number; text: string }>>();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of page.Texts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = decodeURIComponent(item.R.map((r: any) => r.T).join(''));
          if (!text.trim()) continue;
          const y = Math.round(item.y * 10);
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.x, text });
        }

        const sortedRows = Array.from(lineMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([, items]) => items.sort((a, b) => a.x - b.x));

        for (const items of sortedRows) {
          const labelItems = items.filter(i => i.x < LABEL_CUTOFF);
          const dataItems  = items.filter(i => i.x >= LABEL_CUTOFF);

          if (labelItems.length === 0) continue; // pure header row (card numbers, column titles)

          const labelText = labelItems.map(i => i.text).join(' ');

          // Mixed-case label → page title (e.g. "2025 Topps Baseball Series 2"). Skip.
          if (labelText !== labelText.toUpperCase()) {
            lastEmittedIdx = -1; // reset — page boundary, don't carry continuations across
            continue;
          }

          const hasColumnData = dataItems.some(i => i.text === '1:' || i.text === '-');

          if (!hasColumnData) {
            // Continuation row — append to last emitted row if one exists.
            if (lastEmittedIdx >= 0) {
              rows[lastEmittedIdx] = {
                ...rows[lastEmittedIdx],
                subsetName: rows[lastEmittedIdx].subsetName + ' ' + labelText,
              };
            }
            continue;
          }

          // This is a main data row. Detect hobby column on first full row (≥10 odds).
          if (hobbyX === null) {
            const colonItems = dataItems.filter(i => i.text === '1:');
            if (colonItems.length >= 10) {
              hobbyX = colonItems[1].x; // column 0 = Distributor Jumbo, column 1 = Hobby Box
            }
          }

          // Find the "1:" token closest to hobbyX.
          let hobbyOdds: string | null = null;
          if (hobbyX !== null) {
            const colonItems = dataItems.filter(i => i.text === '1:');
            const best = colonItems
              .map(i => ({ x: i.x, dist: Math.abs(i.x - hobbyX!) }))
              .filter(i => i.dist <= COL_TOLERANCE)
              .sort((a, b) => a.dist - b.dist)[0];

            if (best) {
              const colonIdx = dataItems.findIndex(
                i => i.text === '1:' && Math.abs(i.x - best.x) < 0.1
              );
              const numItem = dataItems[colonIdx + 1];
              if (numItem && /^[\d,]+$/.test(numItem.text)) {
                hobbyOdds = numItem.text.replace(/,/g, '');
              }
            }
          }

          if (hobbyOdds) {
            rows.push({ subsetName: labelText, hobbyOdds, breakerOdds: null });
            lastEmittedIdx = rows.length - 1;
          } else {
            // Row exists in PDF but hobby box has no odds (e.g. Value/Mega box exclusive).
            // Reset so its continuation lines don't bleed into the previous emitted row.
            lastEmittedIdx = -1;
          }
        }
      }

      resolve({ rows });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.on('pdfParser_dataError', (err: any) =>
      reject(new Error(err?.parserError ?? 'PDF parse error')));

    parser.parseBuffer(buffer);
  });
}

// Fallback: extract raw text from PDF then use the simple odds parser.
// Used when the coordinate-aware extractor finds 0 rows (e.g. Bowman, which has
// fewer product columns than Topps and never produces a ≥10-token calibration row).
async function extractOddsPdfFallback(buffer: Buffer): Promise<import('@/lib/checklist-parser').ParsedOdds> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require('pdf2json');
  const { parseOddsPdf } = await import('@/lib/checklist-parser');

  return new Promise((resolve, reject) => {
    const parser = new PDFParser();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.on('pdfParser_dataReady', (data: any) => {
      const lines: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const page of data.Pages) {
        const lineMap = new Map<number, Array<{ x: number; text: string }>>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of page.Texts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = decodeURIComponent(item.R.map((r: any) => r.T).join(''));
          if (!text.trim()) continue;
          const y = Math.round(item.y * 10);
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push({ x: item.x, text });
        }
        Array.from(lineMap.entries())
          .sort(([a], [b]) => a - b)
          .forEach(([, items]) => {
            lines.push(items.sort((a, b) => a.x - b.x).map(i => i.text).join(' '));
          });
        lines.push('');
      }
      resolve(parseOddsPdf(lines.join('\n')));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parser.on('pdfParser_dataError', (err: any) =>
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
    let odds = await extractOddsPdfData(buffer);
    // If coordinate-aware parser found nothing, fall back to simple text parser.
    // This handles simpler formats (Bowman, Panini) that don't have enough columns
    // to trigger the hobby-column calibration heuristic.
    if (odds.rows.length === 0) {
      odds = await extractOddsPdfFallback(buffer);
    }
    return NextResponse.json({ odds });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
