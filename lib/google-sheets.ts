// Public-sheet fetcher used by /break-price's `url` option (and the Capture
// break-price message context menu when the target post is a Google Sheets
// link). We hit Google's public **xlsx** export endpoint — not per-tab CSV —
// so the whole workbook comes down in one request and the same xlsx parser
// handles uploaded files AND Sheets URLs. No auth, no OAuth, no API key; the
// sheet MUST be shared "anyone with the link can view," and we surface a
// contributor-actionable error on 401/403 instead of a stack trace.

export interface GoogleSheetRef {
  spreadsheetId: string;
}

const URL_RE = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i;

/** Returns the {spreadsheetId} if the URL is a Google Sheets share URL, else null. */
export function detectGoogleSheet(url: string): GoogleSheetRef | null {
  const m = url.match(URL_RE);
  return m ? { spreadsheetId: m[1] } : null;
}

/** Whole-workbook xlsx export endpoint — returns every tab in one download. */
export function buildXlsxExportUrl(ref: GoogleSheetRef): string {
  return `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=xlsx`;
}

const MAX_BYTES = 5_000_000; // 5 MB — well above any realistic break price sheet.

/**
 * Fetch the workbook as a binary xlsx Buffer. Caller hands the buffer to
 * xlsxBufferToMarkdown so URL and file-upload paths converge on the same
 * multi-sheet code. Throws with a contributor-actionable message on the
 * common failure modes: not-a-sheets URL, not-shared-publicly, oversized.
 */
export async function fetchGoogleSheetXlsx(url: string): Promise<Buffer> {
  const ref = detectGoogleSheet(url);
  if (!ref) {
    throw new Error('That URL isn’t a Google Sheets link.');
  }
  const xlsxUrl = buildXlsxExportUrl(ref);
  const res = await fetch(xlsxUrl, { redirect: 'follow' });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Sheet isn’t publicly accessible. Open it → Share → General access → "Anyone with the link" → "Viewer", then try again.',
    );
  }
  if (res.status === 404) {
    throw new Error('Sheet not found (404). Double-check the URL.');
  }
  if (!res.ok) {
    throw new Error(`Google Sheets returned HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) {
    throw new Error(`Sheet too large (${(declared / 1024 / 1024).toFixed(1)} MB > 5 MB cap)`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Sheet too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB > 5 MB cap)`);
  }
  return Buffer.from(buf);
}
