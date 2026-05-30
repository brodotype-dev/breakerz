// Public-sheet fetcher used by /break-price's `url` option (and the Capture
// break-price message context menu when the target post is a Google Sheets
// link). Transforms a share URL into the public CSV export endpoint and
// fetches — no auth, no OAuth, no API key. The sheet MUST be shared
// "anyone with the link can view"; private sheets return a 401/403 and we
// surface a clear, fixable error message instead of a stack trace.
//
// Single-tab by default — we fetch the `gid` named in the URL (the tab the
// SME was looking at when they copied it). Multi-tab support is deferred.

export interface GoogleSheetRef {
  spreadsheetId: string;
  /** Numeric tab id from the URL; null when no gid was supplied (→ first tab). */
  gid: string | null;
}

const URL_RE = /^https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i;

/** Returns a {spreadsheetId, gid} pair if the URL looks like a Google Sheets share URL, else null. */
export function detectGoogleSheet(url: string): GoogleSheetRef | null {
  const m = url.match(URL_RE);
  if (!m) return null;

  // gid lives in EITHER the query string (`?gid=N`) OR the fragment (`#gid=N`).
  // Google's "Get share link" UI emits the fragment form; some copy-paste
  // mangles it to the query form. Handle both.
  let gid: string | null = null;
  try {
    const u = new URL(url);
    gid = u.searchParams.get('gid');
    if (!gid && u.hash) {
      const hashMatch = u.hash.match(/gid=(\d+)/);
      if (hashMatch) gid = hashMatch[1];
    }
  } catch {
    /* malformed URL — proceed without gid (falls back to first tab) */
  }

  return { spreadsheetId: m[1], gid };
}

/** Public CSV export endpoint for a given (spreadsheet, tab). */
export function buildCsvExportUrl(ref: GoogleSheetRef): string {
  const base = `https://docs.google.com/spreadsheets/d/${ref.spreadsheetId}/export?format=csv`;
  return ref.gid ? `${base}&gid=${ref.gid}` : base;
}

const MAX_BYTES = 5_000_000; // 5 MB — well above any realistic break price sheet.

/**
 * Fetch the public CSV. Throws with a contributor-actionable message on the
 * common failure modes: not-a-sheets URL, not-shared-publicly, oversized.
 * Returns the raw CSV text — caller hands it to the tabular extractor.
 */
export async function fetchGoogleSheetCsv(url: string): Promise<string> {
  const ref = detectGoogleSheet(url);
  if (!ref) {
    throw new Error('That URL isn’t a Google Sheets link.');
  }
  const csvUrl = buildCsvExportUrl(ref);
  const res = await fetch(csvUrl, { redirect: 'follow' });
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
  // Most CSVs are tiny — guard anyway. Read with size budget by checking
  // content-length first, then arrayBuffer.
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) {
    throw new Error(`Sheet too large (${(declared / 1024 / 1024).toFixed(1)} MB > 5 MB cap)`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`Sheet too large (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB > 5 MB cap)`);
  }
  return Buffer.from(buf).toString('utf8');
}
