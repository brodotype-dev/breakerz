/**
 * experiment-card-fmv.mjs
 *
 * Tests CardHedger's new /v1/cards/card-fmv-batch endpoint against the
 * legacy /v1/cards/batch-price-estimate path we use today.
 *
 * Goal: confirm whether FMV's correlated / cross-grade-interpolation methods
 * rescue the empty PSA 9 / PSA 10 cells that "Use Case 9" (player drawer
 * graded comps) is hobbled by today.
 *
 * Test subjects: Munetaka Murakami + Ethan Holliday — both prospect-heavy,
 * graded sales should be naturally sparse.
 *
 * Run: node scripts/experiment-card-fmv.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const [k, ...rest] = l.split('=');
      let v = rest.join('=').trim();
      // Strip surrounding quotes (matches dotenv / Next.js behavior)
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [k.trim(), v];
    })
);

const KEY = env.CARDHEDGER_API_KEY;
if (!KEY) {
  console.error('Missing CARDHEDGER_API_KEY in .env.local');
  process.exit(1);
}

const BASE = 'https://api.cardhedger.com';
const HEADERS = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };

// Players from CLI args, falling back to the original Murakami / Holliday pair.
// Usage: node scripts/experiment-card-fmv.mjs "Shohei Ohtani"
//        node scripts/experiment-card-fmv.mjs "Shohei Ohtani" "Roman Anthony"
const PLAYERS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['Munetaka Murakami', 'Ethan Holliday'];
const GRADES = ['Raw', 'PSA 9', 'PSA 10'];
const CARDS_PER_PLAYER = 10; // soft cap on cards per player

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function findCards(playerName) {
  // Use /v1/cards/card-search with the player name as free-text + sport filter
  const data = await post('/v1/cards/card-search', {
    search: playerName,
    sport: 'baseball',
    page_size: 50,
  });
  const cards = (data.cards || []).slice(0, CARDS_PER_PLAYER);
  return cards.map((c) => ({
    card_id: c.card_id,
    label: `${c.set || ''} #${c.number || ''} ${c.variant || ''}`.trim(),
  }));
}

async function fetchFmv(items) {
  const data = await post('/v1/cards/card-fmv-batch', { items });
  return data.results || [];
}

async function fetchLegacy(items) {
  const data = await post('/v1/cards/batch-price-estimate', { items });
  return data.results || [];
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function pct(n, d) {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(0)}%`;
}

async function run() {
  const allItems = [];
  const cardMeta = new Map(); // card_id → label

  console.log('=== Discovering cards via /v1/cards/card-search ===\n');
  for (const player of PLAYERS) {
    console.log(`${player}:`);
    const cards = await findCards(player);
    if (cards.length === 0) {
      console.log('  (no cards found)');
      continue;
    }
    for (const c of cards) {
      console.log(`  - ${c.card_id}  ${c.label}`);
      cardMeta.set(c.card_id, { player, label: c.label });
      for (const grade of GRADES) {
        allItems.push({ card_id: c.card_id, grade });
      }
    }
    console.log('');
  }

  if (allItems.length === 0) {
    console.error('No cards discovered. Aborting.');
    process.exit(1);
  }

  console.log(`\n=== Firing ${allItems.length} items × 2 endpoints ===\n`);

  // Chunk at 100 per request (both endpoints' batch limit)
  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  const chunks = chunk(allItems, 100);
  const fmvResults = [];
  const legacyResults = [];
  for (const c of chunks) {
    const [f, l] = await Promise.all([fetchFmv(c), fetchLegacy(c)]);
    fmvResults.push(...f);
    legacyResults.push(...l);
  }

  // Index by (card_id, grade)
  const fmvByKey = new Map();
  const legByKey = new Map();
  for (const r of fmvResults) fmvByKey.set(`${r.card_id}|${r.grade}`, r);
  for (const r of legacyResults) legByKey.set(`${r.card_id}|${r.grade}`, r);

  console.log('\n=== Per-card breakdown ===\n');
  const colWidths = { label: 60, grade: 7, leg: 10, fmv: 10, method: 28, conf: 6, fresh: 6 };
  const hdr = (s, w) => s.padEnd(w);
  console.log(
    hdr('Card', colWidths.label) +
      hdr('Grade', colWidths.grade) +
      hdr('Legacy', colWidths.leg) +
      hdr('FMV', colWidths.fmv) +
      hdr('Method', colWidths.method) +
      hdr('Conf', colWidths.conf) +
      hdr('Fresh', colWidths.fresh)
  );
  console.log('-'.repeat(127));

  // Tally
  const tally = {
    total: 0,
    byGrade: {},
    rescued: { Raw: 0, 'PSA 9': 0, 'PSA 10': 0 }, // legacy=null, fmv=number
    bothNull: { Raw: 0, 'PSA 9': 0, 'PSA 10': 0 },
    bothPriced: { Raw: 0, 'PSA 9': 0, 'PSA 10': 0 },
    legacyOnly: { Raw: 0, 'PSA 9': 0, 'PSA 10': 0 }, // legacy=number, fmv=null
    methodCounts: {},
  };
  for (const g of GRADES) tally.byGrade[g] = 0;

  for (const [card_id, meta] of cardMeta) {
    for (const grade of GRADES) {
      const f = fmvByKey.get(`${card_id}|${grade}`);
      const l = legByKey.get(`${card_id}|${grade}`);
      const fp = f?.price ?? null;
      const lp = l?.price ?? null;
      tally.total++;
      tally.byGrade[grade]++;
      if (fp === null && lp === null) tally.bothNull[grade]++;
      else if (fp !== null && lp === null) tally.rescued[grade]++;
      else if (fp === null && lp !== null) tally.legacyOnly[grade]++;
      else tally.bothPriced[grade]++;

      const method = f?.method ?? 'n/a';
      tally.methodCounts[method] = (tally.methodCounts[method] || 0) + 1;

      const labelTrunc = (meta.label || '(unlabeled)').slice(0, colWidths.label - 1);
      console.log(
        hdr(labelTrunc, colWidths.label) +
          hdr(grade, colWidths.grade) +
          hdr(fmt(lp), colWidths.leg) +
          hdr(fmt(fp), colWidths.fmv) +
          hdr(method, colWidths.method) +
          hdr(f?.confidence !== undefined ? Number(f.confidence).toFixed(2) : '—', colWidths.conf) +
          hdr(f?.freshness_days !== undefined && f?.freshness_days !== null ? String(f.freshness_days) : '—', colWidths.fresh)
      );
    }
  }

  console.log('\n=== Summary by grade ===\n');
  console.log(
    'Grade   '.padEnd(10) +
      'Total'.padStart(7) +
      'BothPriced'.padStart(13) +
      'FMV-rescued'.padStart(14) +
      'BothNull'.padStart(11) +
      'LegacyOnly'.padStart(13)
  );
  for (const g of GRADES) {
    const t = tally.byGrade[g];
    console.log(
      g.padEnd(10) +
        String(t).padStart(7) +
        `${tally.bothPriced[g]} (${pct(tally.bothPriced[g], t)})`.padStart(13) +
        `${tally.rescued[g]} (${pct(tally.rescued[g], t)})`.padStart(14) +
        `${tally.bothNull[g]} (${pct(tally.bothNull[g], t)})`.padStart(11) +
        `${tally.legacyOnly[g]} (${pct(tally.legacyOnly[g], t)})`.padStart(13)
    );
  }

  console.log('\n=== FMV method distribution ===\n');
  const sortedMethods = Object.entries(tally.methodCounts).sort((a, b) => b[1] - a[1]);
  for (const [m, c] of sortedMethods) {
    console.log(`  ${m.padEnd(32)} ${c} (${pct(c, tally.total)})`);
  }

  console.log('\nDone.');
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
