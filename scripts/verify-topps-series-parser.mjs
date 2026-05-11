#!/usr/bin/env node
// Sanity-check the Topps Series XLSX parser against the 2025 Topps Series 1 Baseball file.
// Regression target: section names should be real titles ("Base Set", "1990 Topps Baseball
// Checklist", "Larry David Autographs Checklist"), NOT prose metadata rows
// ("350 cards.", "Hobby only.", "Players may have multiple cards.").

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = process.env.FIXTURE
  || resolve(process.env.HOME, 'Downloads/2025-Topps-Series-1-Baseball-Checklist (1).xlsx');

if (!existsSync(FIXTURE)) {
  console.error(`Fixture not found at ${FIXTURE}. Set FIXTURE=<path> to override.`);
  process.exit(1);
}

// Load the parser via tsx (TypeScript runtime) so we don't need a build step.
// Inline-require pattern keeps this script standalone.
const { parseChecklistXlsx } = await import('../lib/checklist-parser.ts');

const buf = readFileSync(FIXTURE);
const parsed = parseChecklistXlsx(buf);

console.log(`\n=== Parsed ${parsed.sections.length} sections from ${FIXTURE.split('/').pop()} ===\n`);

const periodSections = parsed.sections.filter(s => s.sectionName.endsWith('.'));
if (periodSections.length > 0) {
  console.log('❌ REGRESSION — sections with trailing periods (prose metadata leaked as section names):');
  for (const s of periodSections) {
    console.log(`   • "${s.sectionName}" (${s.cards.length} cards)`);
  }
  process.exit(1);
}

console.log('✅ No section names end with a period (no prose metadata leakage)\n');

// Surface a few specific expectations from the 2025 Topps Series 1 fixture.
// "Base Set" gets collapsed to "Base" (sheet name) via STRUCTURAL_LABEL_RE —
// that's intentional and predates this fix. Section names below are titles
// that should round-trip exactly.
const expectations = [
  '1990 Topps Baseball Checklist',
  '1990 Topps Baseball Autographs Checklist',
  '1990 Topps Baseball Relics Checklist',
  'Larry David Autographs Checklist',
  'Dancing Dodgers Variations Checklist',
  'Golden Mirror Image Variations Checklist',
];

// Section names that MUST NOT appear — these are the prose metadata rows
// the old parser misidentified as section headers (per the 2026-05-11 bug
// report screenshot from /admin/import-checklist on Topps Series 1).
const regressionTraps = [
  '350 cards.',
  '1 card.',
  '201 cards.',
  'Hobby only.',
  'Silver packs only.',
  'Fanatics box only.',
  'Hobby and jumbo packs only.',
  'Players may have multiple cards.',
];

console.log('=== Regression traps (must NOT appear) ===');
let trapped = false;
for (const trap of regressionTraps) {
  if (parsed.sections.find(s => s.sectionName === trap)) {
    console.log(`  ❌ "${trap}" — bug regressed`);
    trapped = true;
  }
}
if (!trapped) console.log('  ✅ none of the prose metadata leaked as section names');
console.log();

console.log('=== Expectations ===');
let allFound = true;
for (const name of expectations) {
  const hit = parsed.sections.find(s => s.sectionName === name);
  if (hit) {
    console.log(`  ✅ "${name}" → ${hit.cards.length} cards`);
  } else {
    console.log(`  ❌ "${name}" — NOT FOUND`);
    allFound = false;
  }
}

console.log(`\nTotal cards parsed: ${parsed.sections.reduce((s, x) => s + x.cards.length, 0).toLocaleString()}`);
console.log(`Section count: ${parsed.sections.length}`);
console.log('\nTop 10 sections by card count:');
const sorted = [...parsed.sections].sort((a, b) => b.cards.length - a.cards.length).slice(0, 10);
for (const s of sorted) {
  console.log(`  ${s.cards.length.toString().padStart(5)}  ${s.sectionName}`);
}

if (!allFound) {
  console.log('\n❌ Some expected sections missing');
  process.exit(1);
}

console.log('\n✅ All expected sections present');
