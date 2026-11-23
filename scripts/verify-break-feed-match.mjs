#!/usr/bin/env node
// Regression test for break-title → product matching (lib/break-feed-match.ts).
//
// Usage:
//   npx tsx scripts/verify-break-feed-match.mjs
//
// Fixtures are REAL titles captured 2026-11-22 from the two source shapes we
// ingest, checked against the 11 products active in production that day:
//
//   - Steel City Collectibles group breaks (66 live listings, 3 pages) —
//     pre-listed as products, so they carry a spot price.
//   - Fanatics Live shows (East West Sports Cards) — title + time only; the
//     platform does not publish a break list before a show starts.
//
// What this guards is the asymmetry that makes the feed trustworthy: a MISS
// surfaces as a coverage gap for review, a FALSE POSITIVE silently claims we
// can price something we cannot. The one-word pairs below (Chrome vs Cosmic
// Chrome) and the year pairs (2025 vs 2026 Chrome Football) are the two ways
// that goes wrong in this data, so both are asserted explicitly.

import { matchBreakTitle } from '../lib/break-feed-match.ts';

/** The 11 products active in production on 2026-11-22. */
const PRODUCTS = [
  { id: 'p01', slug: '2025-topps-chrome-football', name: '2025 Topps Chrome Football' },
  { id: 'p02', slug: '2025-topps-cosmic-chrome-football', name: '2025 Topps Cosmic Chrome Football' },
  { id: 'p03', slug: '2026-bowman-basketball-sapphire', name: '2025-26 Bowman Basketball Sapphire' },
  { id: 'p04', slug: '2025-26-topps-chrome-basketball', name: '2025-26 Topps Chrome Basketball' },
  { id: 'p05', slug: '2025-26-topps-chrome-cactus-jack-basketball', name: '2025-26 Topps Chrome Cactus Jack Basketball' },
  { id: 'p06', slug: '2025-26-topps-cosmic-chrome-basketball', name: '2025-26 Topps Cosmic Chrome® Basketball' },
  { id: 'p07', slug: '2025-26-topps-motif-basketball', name: '2025-26 Topps Motif Basketball' },
  { id: 'p08', slug: '2026-bowman-baseball', name: '2026 Bowman Baseball' },
  { id: 'p09', slug: '2026-bowman-sapphire-baseball', name: '2026 Bowman Sapphire Baseball' },
  { id: 'p10', slug: '2026-topps-chrome-baseball', name: '2026 Topps Chrome Baseball' },
  { id: 'p11', slug: 'o-pee-chee-platinum-hockey', name: 'O-Pee-Chee Platinum Hockey' },
];

// expected = product slug, or null for "we do not carry this"
const CASES = [
  // ---- real Steel City titles that SHOULD match -------------------------
  {
    title: '2025-26 Topps Cosmic Chrome Basketball Hobby Box Random Division Group Break #44 - Steve',
    expected: '2025-26-topps-cosmic-chrome-basketball',
    note: 'the one clean match in the live feed',
  },
  {
    title: '2025-26 Topps Cosmic Chrome Basketball Hobby Box Random Division Group Break #40 - Brett',
    expected: '2025-26-topps-cosmic-chrome-basketball',
    note: 'same product, different breaker',
  },
  {
    title: '2026 Bowman Chrome Baseball Sapphire Edition Box Random Pack Group Break #3 - Steve',
    expected: '2026-bowman-sapphire-baseball',
    note: 'retail says "Bowman Chrome ... Sapphire Edition"; we say "Bowman Sapphire" — alias',
  },

  // ---- the year trap: they break 2026, we carry 2025 ---------------------
  {
    title: '2026 Topps Chrome Football Jumbo Hobby Box Random Division Group Break #5 - Steve',
    expected: null,
    note: 'we carry 2025 Chrome Football — must NOT claim coverage',
  },
  {
    title: '2026 Topps Chrome Football Jumbo Hobby 4-Box (HALF CASE) PYT Group Break #3 - Steve',
    expected: null,
    note: 'same product, PYT configuration',
  },
  {
    title: '2026 Topps Chrome Football Hobby TWO Box Random Division Group Break #4 - Steve',
    expected: null,
  },
  {
    title: '2024 Topps Cosmic Chrome Football Hobby Box Random Division Group Break #4 - Brett',
    expected: null,
    note: 'we carry 2025 Cosmic Chrome Football, not 2024',
  },

  // ---- the one-word trap: Chrome vs Cosmic Chrome ------------------------
  {
    title: '2026 Topps Cosmic Chrome Baseball Hobby Box Random Division Group Break #10 - Brett',
    expected: null,
    note: 'MUST NOT fall through to 2026 Topps Chrome Baseball — different product, different price',
  },

  // ---- lines we have never onboarded ------------------------------------
  { title: '2026 Topps Museum Collection Baseball Hobby 8-Box Case PYT Group Break #3 - Steve', expected: null },
  { title: '2025-26 Topps Stadium Club Basketball Hobby 12-Box Case PYT Group Break #1 - Steve', expected: null },
  { title: '2025-26 Topps Five Star Basketball Hobby 3-Box Case PYT Group Break #1 - Brett', expected: null },
  { title: '2026 Topps Inception Football Hobby 8-Box Case PYT Group Break #3 - Steve', expected: null },
  { title: '2026 Topps Finest Baseball Hobby Box Random Division Group Break #15 - Brett', expected: null },
  { title: '2025-26 Panini Select Basketball Hobby Box Random Division Group Break #3 - Brett', expected: null },
  { title: '2026-27 Upper Deck Black Diamond Hockey Hobby Box Random Card Group Break #1 - Brett', expected: null },
  { title: '2025-26 Upper Deck Stature Hockey Hobby Box Random Card Group Break #12 - Brett', expected: null },
  { title: '2026-27 Topps Basketball Jumbo Hobby Box Random Division Group Break #1 - Steve', expected: null },

  // ---- non-sports rows the provider hands us ----------------------------
  { title: 'Pokemon Fossil Unlimited Booster Pack -- Random Card Group Break #35 -- Mikey', expected: null },
  { title: '2026 Topps Neon Marvel Hobby Box -- Random 2-Pack Group Break #3 -- Mikey', expected: null },

  // ---- Fanatics Live shows: title + time only, no break list ------------
  {
    title: 'GILDED BASEBALL RELEASE DAY w/ EAST WEST!',
    expected: null,
    note: 'no year stated and we do not carry Gilded — still a legitimate miss',
  },
  { title: 'EW NFL MONDAY! PYTS AND BREAKS ALL DAY! AUCTIONS AT NOON!', expected: null },
  { title: 'BIGGEST AND BEST CHARACTER BREAKS ON FANATICS - GIVEAWAYS ALL DAY', expected: null },
  { title: '$20K CASE HIT CHASE W/ SEAN', expected: null },

  // ---- synthetic: products with no live listing today -------------------
  {
    title: '2025-26 Topps Chrome Cactus Jack Basketball Hobby Box PYT Group Break #2',
    expected: '2025-26-topps-chrome-cactus-jack-basketball',
    note: 'multi-word line must match as a unit',
  },
  {
    title: '2026 Bowman Baseball Hobby Jumbo Box Random Division Group Break #7',
    expected: '2026-bowman-baseball',
  },
  {
    title: '2026 Bowman Chrome Baseball Hobby Box Random Division Group Break #1',
    expected: null,
    note: 'Bowman Chrome is not Bowman flagship — intruder check must hold',
  },
  {
    title: 'OPC Platinum Hockey Hobby Box Random Division Group Break #1',
    expected: 'o-pee-chee-platinum-hockey',
    note: 'retail abbreviates O-Pee-Chee to OPC — alias',
  },
  {
    title: '2025 Topps Chrome Football Jumbo Hobby Box Random Division Group Break #9',
    expected: '2025-topps-chrome-football',
    note: 'the year we DO carry must match',
  },
];

const bySlug = new Map(PRODUCTS.map(p => [p.slug, p.id]));
let failures = 0;

console.log(`\nbreak-title matcher — ${CASES.length} cases against ${PRODUCTS.length} active products\n`);

for (const { title, expected, note } of CASES) {
  const result = matchBreakTitle(title, PRODUCTS);
  const expectedId = expected === null ? null : bySlug.get(expected);

  if (expected !== null && expectedId === undefined) {
    console.error(`FIXTURE BUG: no product with slug "${expected}"`);
    failures++;
    continue;
  }

  const pass = result.productId === expectedId;
  if (!pass) failures++;

  const mark = pass ? '  ok  ' : ' FAIL ';
  const got = result.productName ?? `— (${result.reason})`;
  console.log(`${mark} ${title.slice(0, 68)}`);
  console.log(`        → ${got}${result.confidence === 'alias' ? '  [alias]' : ''}`);
  if (!pass) {
    console.log(`        expected: ${expected ?? 'no match'}`);
  }
  if (note && !pass) console.log(`        note: ${note}`);
}

const matched = CASES.filter(c => c.expected !== null).length;
console.log(
  `\n${CASES.length - failures}/${CASES.length} passed · ` +
    `${matched} of these titles are products we carry\n`
);

if (failures > 0) {
  console.error(`${failures} failure(s)\n`);
  process.exit(1);
}
