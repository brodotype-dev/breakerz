#!/usr/bin/env node
/**
 * One-shot ingest: Kyle's 2026 Bowman CrossRef → Track A prospect_rank +
 * prospect_status. Reads the `Players (Full)` sheet, parses the "Top 100"
 * column into either a numeric rank or one of the two status enums, and
 * POSTs the resulting rows to /api/admin/import-prospect-ranks.
 *
 * The "Top 100" column in Kyle's sheet carries:
 *   "1", "20", "47"               → prospect_rank=N
 *   "Graduated MLB"               → prospect_status='graduated_rc'
 *   "NPB signee (ineligible)"     → prospect_status='international_signee'
 *   "Top 100 (Mar '26 add)"       → SKIPPED (no precise rank, no status)
 *
 * Plan verification target: 17 ranked + 6 graduated_rc + 3 international_signee = 26 rows
 * (Andrew Fischer's "Mar '26 add" gets skipped — not enough metadata to write him
 * institutionally yet.)
 *
 * Usage:
 *   BREAKIQ_URL=https://www.getbreakiq.com \
 *   CRON_SECRET=... \
 *   XLSX=~/Downloads/2026_Bowman_BreakIQ_CrossRef.xlsx \
 *   node scripts/import-kyle-crossref.mjs [--dry-run] [--commit]
 *
 * Defaults to dry-run. Pass --commit to actually write.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import XLSX from 'xlsx';

const XLSX_PATH = process.env.XLSX
  ? resolve(process.env.XLSX.replace(/^~/, process.env.HOME ?? '~'))
  : resolve(process.env.HOME ?? '~', 'Downloads/2026_Bowman_BreakIQ_CrossRef.xlsx');

const BREAKIQ_URL = (process.env.BREAKIQ_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;
const SOURCE = 'MLB Pipeline May 2026 via Kyle CrossRef';
const ENDPOINT = `${BREAKIQ_URL}/api/admin/import-prospect-ranks`;

const args = new Set(process.argv.slice(2));
// dry-run is the default. --commit flips to a real write. --dry-run is also
// supported explicitly to make the behavior obvious in CI / shell history.
const COMMIT = args.has('--commit');
const DRY_RUN = !COMMIT;

if (!CRON_SECRET) {
  console.error('Missing CRON_SECRET env var.');
  process.exit(1);
}
if (!existsSync(XLSX_PATH)) {
  console.error(`XLSX not found at: ${XLSX_PATH}`);
  process.exit(1);
}

console.log(`[import-kyle-crossref] reading ${XLSX_PATH}`);
const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer' });
const ws = wb.Sheets['Players (Full)'];
if (!ws) {
  console.error("Sheet 'Players (Full)' not found.");
  process.exit(1);
}
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

const out = [];
const skipped = [];

for (const r of rows) {
  const player_name = String(r.Player ?? '').trim();
  const team = r.Team ? String(r.Team).trim() : null;
  const top100Raw = r['Top 100'];

  if (!player_name || top100Raw == null) continue;

  const top100 = String(top100Raw).trim();
  let prospect_rank = null;
  let prospect_status = null;

  // Numeric rank — strip a leading "#" if Kyle ever adds one back.
  const numericMatch = top100.match(/^#?\s*(\d{1,3})\s*$/);
  if (numericMatch) {
    prospect_rank = parseInt(numericMatch[1], 10);
  } else if (/^graduated\s*mlb$/i.test(top100)) {
    prospect_status = 'graduated_rc';
  } else if (/npb\s*signee/i.test(top100)) {
    prospect_status = 'international_signee';
  } else {
    skipped.push({ player_name, team, top100, reason: 'no precise rank or status mapping' });
    continue;
  }

  out.push({
    sport: 'baseball',
    player_name,
    team,
    prospect_rank,
    prospect_status,
  });
}

console.log(`[import-kyle-crossref] mapped ${out.length} rows, skipped ${skipped.length}`);
console.log(`  numeric rank:     ${out.filter(r => r.prospect_rank != null).length}`);
console.log(`  graduated_rc:     ${out.filter(r => r.prospect_status === 'graduated_rc').length}`);
console.log(`  international:    ${out.filter(r => r.prospect_status === 'international_signee').length}`);
if (skipped.length) {
  console.log('  skipped rows:');
  for (const s of skipped) console.log(`    - ${s.player_name} (${s.team}): "${s.top100}"`);
}

console.log(`\n[import-kyle-crossref] posting ${out.length} rows to ${ENDPOINT}`);
console.log(`  mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT (writes go to production!)'}`);
console.log(`  source: ${SOURCE}`);

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${CRON_SECRET}`,
  },
  body: JSON.stringify({
    source: SOURCE,
    dryRun: DRY_RUN,
    rows: out,
  }),
});

const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { json = { raw: text }; }

if (!res.ok) {
  console.error(`\n[import-kyle-crossref] FAILED — ${res.status}`);
  console.error(json);
  process.exit(1);
}

console.log('\n[import-kyle-crossref] response summary:');
console.log(json.summary);

const interesting = json.perRow.filter(r =>
  r.outcome.kind !== 'written' && r.outcome.kind !== 'dryrun_matched',
);
if (interesting.length) {
  console.log('\n[import-kyle-crossref] rows needing admin attention:');
  for (const r of interesting) {
    console.log(`  [${r.index}] ${r.player_name} (${r.team ?? '?'}) → ${r.outcome.kind}` +
      (r.outcome.kind === 'invalid' ? ` :: ${r.outcome.reason}`
       : r.outcome.kind === 'ambiguous' ? ` :: ${r.outcome.candidates.map(c => c.name).join(' | ')}`
       : ''));
  }
}

if (DRY_RUN) {
  console.log('\nDry-run only. Re-run with --commit to actually write.');
}
