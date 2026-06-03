/**
 * Verify the import-time player-name guards (normalizePlayerName /
 * isNonPlayerName) in lib/checklist-aggregates.ts.
 *
 * Run: npx tsx scripts/verify-name-guards.ts
 *
 * These guards stop checklist imports from creating junk player rows — section
 * headers ("BASEBALL STARS AUTOGRAPHS"), card-number-prefixed names
 * ("1 Jacob Wilson"), stray numbers ("221"), subset codes ("90CAS-DO") — that
 * the /admin/players directory surfaced (2026-06-03). Keep this green.
 */
import { normalizePlayerName, isNonPlayerName } from '../lib/checklist-aggregates';

// Real names: normalize must be a no-op AND not rejected.
const KEEP = [
  'Jacob Wilson', 'Roki Sasaki', 'José Ramírez', 'A.J. Causey', 'Ichiro',
  'Aaron Civale', 'C.J. Stroud', 'Shohei Ohtani', 'Luka Dončić',
];
// Card-number-prefixed real players: strip the prefix, then keep.
const STRIP: Array<[string, string]> = [
  ['1 Jacob Wilson', 'Jacob Wilson'],
  ['12 Roki Sasaki', 'Roki Sasaki'],
  ['62 Chase Dollander', 'Chase Dollander'],
  ['360 Owen Caissie', 'Owen Caissie'],
];
// Junk: must be rejected (after normalization).
const REJECT = [
  'BASEBALL STARS AUTOGRAPHS', 'HEAVY LUMBER AUTOGRAPH RELICS',
  'CITY CONNECT SWATCH COLLECTION', 'WORLD CHAMPION DUAL AUTOGRAPH CARDS',
  '1990 TOPPS BASEBALL ALL STAR AUTOGRAPH CARDS',
  '2025 TOPPS FLAGSHIP AUTOGRAPH PATCH CARDS',
  '90CAS-DO', 'MLMDA2-X', 'B25-AL', '221', '3D-37',
];
// Legit multi-player subset rows: NOT rejected here (caller keeps insert_only).
const KEEP_MULTI = ['Skubal / Blanco / Valdez', 'Witt Jr. / Crews'];

let fail = 0;
const bad = (msg: string) => { fail++; console.log('FAIL:', msg); };

for (const n of KEEP) {
  const norm = normalizePlayerName(n);
  if (norm !== n) bad(`keep normalize changed ${JSON.stringify(n)} -> ${JSON.stringify(norm)}`);
  if (isNonPlayerName(norm)) bad(`keep wrongly rejected ${JSON.stringify(n)}`);
}
for (const [raw, want] of STRIP) {
  const norm = normalizePlayerName(raw);
  if (norm !== want) bad(`strip ${JSON.stringify(raw)} -> ${JSON.stringify(norm)} (want ${JSON.stringify(want)})`);
  if (isNonPlayerName(norm)) bad(`stripped name wrongly rejected ${JSON.stringify(raw)}`);
}
for (const n of REJECT) {
  if (!isNonPlayerName(normalizePlayerName(n))) bad(`junk NOT rejected ${JSON.stringify(n)}`);
}
for (const n of KEEP_MULTI) {
  if (isNonPlayerName(normalizePlayerName(n))) bad(`multi-player wrongly rejected ${JSON.stringify(n)}`);
}

if (fail === 0) {
  console.log(`name-guards: ALL PASS (${KEEP.length + STRIP.length + REJECT.length + KEEP_MULTI.length} cases)`);
  process.exit(0);
} else {
  console.log(`name-guards: ${fail} FAILURE(S)`);
  process.exit(1);
}
