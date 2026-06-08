#!/usr/bin/env node
// Regression test for the Topps Motif Basketball (Beckett multi-sheet XLSX with
// parenthetical-odds parallels) checklist parser.
//
// Usage:
//   npx tsx scripts/verify-motif-parser.mjs
//   FIXTURE=~/Downloads/2025-26-Topps-Motif-Basketball-Checklist.xlsx npx tsx scripts/verify-motif-parser.mjs
//
// The Motif format is the same repeating-block Beckett XLSX the generic
// parseChecklistXlsx already walks, BUT each parallel label carries its pack
// odds glued on — "Platinum (Hobby - 1:157; FDI - 1:157)", "Pastel Pink (No
// odds given)" — and the source file ships at least one malformed line missing
// its closing paren ("Platinum (Hobby - 1:949; FDI - 1:633"). Before the fix,
// every odds-parallel line fell through to "new section header" and clobbered
// the real subset title, producing ~15 garbage odds-named sections.
//
// Regression target: real subset titles as sections, parallels captured (incl.
// the malformed-paren one), zero odds-named sections. See
// docs/manufacturer-rules/topps-motif.md.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE =
  process.env.FIXTURE ||
  resolve(process.env.HOME, 'Downloads/2025-26-Topps-Motif-Basketball-Checklist.xlsx');

if (!existsSync(FIXTURE)) {
  console.error(`Fixture not found at ${FIXTURE}. Set FIXTURE=<path> to override.`);
  process.exit(1);
}

const { parseChecklistXlsx } = await import('../lib/checklist-parser.ts');
const parsed = parseChecklistXlsx(readFileSync(FIXTURE));

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// 1. No section name should look like a pack-odds string.
const stray = parsed.sections.filter((s) => /\d+\s*:\s*\d|\((?:hobby|fdi)/i.test(s.sectionName));
check(stray.length === 0, `Expected 0 odds-named sections, got ${stray.length}: ${stray.map((s) => `"${s.sectionName}"`).join(', ')}`);

// 2. Real subset titles present.
const names = new Set(parsed.sections.map((s) => s.sectionName));
for (const expected of ['Base', 'Splatter Signatures', 'Still Life Signatures']) {
  check(names.has(expected), `Expected a "${expected}" section`);
}

// 3. Total card count (full Motif checklist).
const total = parsed.sections.reduce((n, s) => n + s.cards.length, 0);
check(total === 769, `Expected 769 total cards, got ${total}`);

// 4. Base parallels captured, including the trailing "Platinum".
const base = parsed.sections.find((s) => s.sectionName === 'Base');
const baseParallels = base?.cards?.[0]?.parallels ?? [];
check(baseParallels.includes('Platinum'), `Expected Base parallels to include "Platinum"; got [${baseParallels.join(', ')}]`);
check(baseParallels.includes('Pastel Pink'), `Expected Base parallels to include "Pastel Pink"; got [${baseParallels.join(', ')}]`);

// 5. The malformed-paren "Platinum (Hobby - 1:949; FDI - 1:633" line must NOT
//    have become a section — its cards belong to their real subset.
check(!names.has('Platinum'), `"Platinum" leaked as a section name (malformed-paren regression)`);

console.log(`=== verify-motif-parser ===`);
console.log(`fixture: ${FIXTURE.split('/').pop()}`);
console.log(`sections: ${parsed.sections.length} | cards: ${total} | stray odds-named: ${stray.length}`);
console.log(`Base parallels: ${baseParallels.join(', ')}`);

if (fails.length) {
  console.error(`\nFAILED (${fails.length}):`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nPASS — all ${5} checks green.`);
