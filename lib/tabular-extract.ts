// Buffer / CSV → markdown table conversion for the /break-price tabular
// input path. Reuses the `xlsx` lib we already ship for checklist imports —
// XLSX.read handles both .xlsx/.xls (`type: 'buffer'`) and CSV strings
// (`type: 'string'`), so one code path covers all three file shapes plus a
// Google Sheets CSV export.
//
// We emit MARKDOWN (not raw rows) because Claude reads markdown tables
// natively, AND it forces us to flatten multi-line cells / weird formatting
// into something a prompt can cite without confusion. Width and row caps
// keep ridiculously large sheets from blowing the model's context budget;
// the typical break price sheet fits comfortably inside them.

export interface TabularExtractResult {
  /** First sheet's name (diagnostic). */
  sheetName?: string;
  /** Markdown-table representation, header row + N data rows. */
  markdown: string;
  /** Total data rows kept (excludes the header row). */
  rowCount: number;
  /** Whether the row cap clipped any data. */
  truncated: boolean;
}

const MAX_ROWS = 400;       // ~3-4x the biggest real PYP sheet we've seen.
const MAX_COLS = 12;
const MAX_CELL_CHARS = 200;
const MAX_MARKDOWN_CHARS = 60_000;

interface XlsxLike {
  read: (data: Buffer | string, opts: { type: 'buffer' | 'string' }) => XlsxWorkbook;
  utils: {
    sheet_to_json: (ws: unknown, opts: { header: 1; defval: null }) => unknown[][];
  };
}
interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

function loadXlsx(): XlsxLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('xlsx') as XlsxLike;
}

/** Parse an .xlsx/.xls buffer → markdown of the first sheet. */
export function xlsxBufferToMarkdown(buffer: Buffer): TabularExtractResult {
  const XLSX = loadXlsx();
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return workbookToMarkdown(XLSX, wb);
}

/** Parse a CSV string → markdown of the (only) sheet. */
export function csvTextToMarkdown(csvText: string): TabularExtractResult {
  const XLSX = loadXlsx();
  const wb = XLSX.read(csvText, { type: 'string' });
  return workbookToMarkdown(XLSX, wb);
}

function workbookToMarkdown(XLSX: XlsxLike, wb: XlsxWorkbook): TabularExtractResult {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { markdown: '', rowCount: 0, truncated: false };
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  return { sheetName, ...rowsToMarkdown(rows) };
}

function rowsToMarkdown(rows: unknown[][]): Omit<TabularExtractResult, 'sheetName'> {
  // Trim fully-empty trailing rows.
  let last = rows.length - 1;
  while (last >= 0 && rows[last].every(c => c === null || c === '' || c === undefined)) last--;
  const all = rows.slice(0, last + 1);
  const truncated = all.length > MAX_ROWS;
  const kept = all.slice(0, MAX_ROWS);
  if (kept.length === 0) {
    return { markdown: '', rowCount: 0, truncated: false };
  }

  // Column count = widest row, capped.
  const widest = Math.max(...kept.map(r => r.length));
  const colCount = Math.min(MAX_COLS, widest || 1);

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    // `|` would break the markdown table — substitute. Newlines collapse.
    return String(v)
      .replace(/\|/g, '/')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CELL_CHARS);
  };

  const headerCells = Array.from({ length: colCount }, (_, i) => fmt(kept[0][i]) || `col${i + 1}`);

  const lines: string[] = [];
  lines.push(`| ${headerCells.join(' | ')} |`);
  lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`);

  let dataRowCount = 0;
  for (let r = 1; r < kept.length; r++) {
    const cells = Array.from({ length: colCount }, (_, i) => fmt(kept[r][i]));
    if (cells.every(c => c === '')) continue; // skip blank rows
    lines.push(`| ${cells.join(' | ')} |`);
    dataRowCount++;
  }

  let markdown = lines.join('\n');
  // Last-resort overall cap so a wide sheet can't tip the prompt over its
  // budget. Trim from the end (rows beyond budget) and flag truncated.
  let mdTruncated = false;
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS);
    // Drop a (likely partial) final line to keep the table parseable.
    const lastNl = markdown.lastIndexOf('\n');
    if (lastNl > 0) markdown = markdown.slice(0, lastNl);
    mdTruncated = true;
  }

  return { markdown, rowCount: dataRowCount, truncated: truncated || mdTruncated };
}
