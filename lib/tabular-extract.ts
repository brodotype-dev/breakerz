// Buffer / CSV → markdown table conversion for the /break-price tabular
// input path. Reuses the `xlsx` lib we already ship for checklist imports —
// XLSX.read handles both .xlsx/.xls (`type: 'buffer'`) and CSV strings
// (`type: 'string'`), so one code path covers all three file shapes plus a
// Google Sheets xlsx export.
//
// Multi-sheet aware: iterates every tab in the workbook, classifies each as
// pricing vs notes by a numeric-density heuristic, drops the notes tabs
// (they'd pollute parseBreakPrice — they're prose, not asks), and concats the
// surviving tabs into one markdown blob with `## <sheet name>` headers so
// Claude can tell which tab a row came from (PYT vs PYP, etc.).
//
// We emit MARKDOWN (not raw rows) because Claude reads markdown tables
// natively, AND it forces us to flatten multi-line cells / weird formatting
// into something a prompt can cite without confusion. Width and row caps
// keep ridiculously large sheets from blowing the model's context budget;
// the typical break price sheet fits comfortably inside them.

export interface TabularExtractResult {
  /** Markdown — one or more `## <sheet name>` blocks, each followed by a markdown table. */
  markdown: string;
  /** Total data rows kept across all surviving sheets (excludes header rows). */
  rowCount: number;
  /** Whether the per-sheet or global cap clipped any data. */
  truncated: boolean;
  /** Sheets that passed the pricing-tab heuristic (rendered into markdown). */
  sheetsKept: string[];
  /** Sheets that were skipped — mostly prose / no dollar-shaped values. */
  sheetsSkipped: string[];
}

const MAX_ROWS_PER_SHEET = 400;
const MAX_COLS = 12;
const MAX_CELL_CHARS = 200;
const MAX_MARKDOWN_CHARS = 60_000;

// Pricing-tab heuristic thresholds. A sheet's BODY (rows 2..N) is
// considered a price sheet if at least PRICE_LIKE_MIN cells AND at least
// PRICE_LIKE_RATIO of all non-empty body cells look dollar-shaped (a number
// ≥ PRICE_LIKE_MIN_VALUE). The min-value guard keeps a rankings tab (a
// column of integers 1..100) from looking like prices.
const PRICE_LIKE_MIN = 5;
const PRICE_LIKE_RATIO = 0.15;
const PRICE_LIKE_MIN_VALUE = 10;

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

/** Parse an .xlsx/.xls buffer → markdown across all pricing-shaped sheets. */
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

/**
 * One-line human-readable summary for the proposal source field and the
 * Discord "no updates" / source_text rendering. Mirrors the shape of the
 * extracted result so the handler doesn't have to think about how many
 * sheets survived vs. were skipped.
 */
export function formatTabularSourceLabel(prefix: string, result: TabularExtractResult): string {
  const rows = `${result.rowCount} data row${result.rowCount === 1 ? '' : 's'}`;
  let sheets = '';
  if (result.sheetsKept.length > 1) {
    sheets = ` across ${result.sheetsKept.length} tabs (${result.sheetsKept.join(', ')})`;
  } else if (result.sheetsKept.length === 1) {
    sheets = ` from ${result.sheetsKept[0]}`;
  }
  const skipped = result.sheetsSkipped.length > 0
    ? ` · skipped ${result.sheetsSkipped.length} tab${result.sheetsSkipped.length === 1 ? '' : 's'}: ${result.sheetsSkipped.join(', ')}`
    : '';
  const trunc = result.truncated ? ' · truncated' : '';
  return `${prefix} · ${rows}${sheets}${skipped}${trunc}`;
}

function workbookToMarkdown(XLSX: XlsxLike, wb: XlsxWorkbook): TabularExtractResult {
  const blocks: string[] = [];
  const sheetsKept: string[] = [];
  const sheetsSkipped: string[] = [];
  let totalRows = 0;
  let truncated = false;
  let charBudget = MAX_MARKDOWN_CHARS;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    if (!looksLikePricingSheet(rows)) {
      sheetsSkipped.push(sheetName);
      continue;
    }

    const result = rowsToMarkdown(rows);
    if (!result.markdown) {
      sheetsSkipped.push(sheetName);
      continue;
    }

    // `## <name>` header + the table body. One blank line between blocks so
    // Claude can see where one tab ends and the next begins.
    const safeName = sheetName.replace(/\n/g, ' ').trim() || 'sheet';
    const block = `## ${safeName}\n\n${result.markdown}`;

    if (block.length > charBudget) {
      // Cap reached — drop this sheet whole rather than emit a half-table
      // that confuses the parser. Flag truncated so the caller surfaces it.
      truncated = true;
      sheetsSkipped.push(`${sheetName} (over budget)`);
      continue;
    }

    blocks.push(block);
    sheetsKept.push(sheetName);
    totalRows += result.rowCount;
    truncated = truncated || result.truncated;
    charBudget -= block.length + 2; // +2 for the blank separator we'll join with
  }

  return {
    markdown: blocks.join('\n\n'),
    rowCount: totalRows,
    truncated,
    sheetsKept,
    sheetsSkipped,
  };
}

/**
 * Pricing-tab heuristic. Body cells (rows 2..N) are scanned; we count cells
 * that parse as a number ≥ PRICE_LIKE_MIN_VALUE (or that read like a dollar
 * amount with $/commas). A sheet qualifies if both an absolute minimum AND a
 * ratio threshold are met — keeps tiny tabs from passing on coincidence, and
 * keeps notes tabs (mostly prose, occasional number) from misclassifying.
 */
function looksLikePricingSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  let priceLike = 0;
  let nonEmpty = 0;
  for (let r = 1; r < rows.length; r++) {
    for (const cell of rows[r]) {
      if (cell === null || cell === undefined || cell === '') continue;
      nonEmpty++;
      if (typeof cell === 'number') {
        if (cell >= PRICE_LIKE_MIN_VALUE) priceLike++;
        continue;
      }
      const s = String(cell).trim();
      // Match "$1,050" / "$1050" / "1050" / "1,050" — strip $, commas, then parse.
      const stripped = s.replace(/^\$\s*/, '').replace(/,/g, '');
      const n = Number(stripped);
      if (Number.isFinite(n) && n >= PRICE_LIKE_MIN_VALUE) priceLike++;
    }
  }
  if (priceLike < PRICE_LIKE_MIN) return false;
  if (nonEmpty === 0) return false;
  return priceLike / nonEmpty >= PRICE_LIKE_RATIO;
}

function rowsToMarkdown(rows: unknown[][]): { markdown: string; rowCount: number; truncated: boolean } {
  // Trim fully-empty trailing rows.
  let last = rows.length - 1;
  while (last >= 0 && rows[last].every(c => c === null || c === '' || c === undefined)) last--;
  const all = rows.slice(0, last + 1);
  const truncated = all.length > MAX_ROWS_PER_SHEET;
  const kept = all.slice(0, MAX_ROWS_PER_SHEET);
  if (kept.length === 0) {
    return { markdown: '', rowCount: 0, truncated: false };
  }

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
    if (cells.every(c => c === '')) continue;
    lines.push(`| ${cells.join(' | ')} |`);
    dataRowCount++;
  }

  return { markdown: lines.join('\n'), rowCount: dataRowCount, truncated };
}
