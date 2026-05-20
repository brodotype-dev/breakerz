/**
 * experiment-card-fmv-at-scale.mjs
 *
 * Samples ~500 cardhedger_card_ids from production player_product_variants,
 * fires both /v1/cards/card-fmv-batch and /v1/cards/batch-price-estimate
 * against them at Raw / PSA 9 / PSA 10, and reports how much our cached
 * EVs would shift if we swapped to FMV.
 *
 * Run: node scripts/experiment-card-fmv-at-scale.mjs            # default 500
 *      node scripts/experiment-card-fmv-at-scale.mjs 250         # smaller sample
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

// Card_ids supplied via tmp file (sampled separately, e.g. via Supabase MCP).
// Default path: /tmp/fmv-experiment-card-ids.txt
const IDS_FILE = process.argv[3] ?? '/tmp/fmv-experiment-card-ids.txt';

const BASE = 'https://api.cardhedger.com';
const HEADERS = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
const GRADES = ['Raw', 'PSA 9', 'PSA 10'];
const SAMPLE_SIZE = Number(process.argv[2] ?? 500);
const BATCH_SIZE = 100;
const CONCURRENCY = 4;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function loadCardIds(n) {
  const lines = readFileSync(IDS_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, n);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function withConcurrency(items, n, fn) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (idx < items.length) {
        const my = idx++;
        results[my] = await fn(items[my], my);
      }
    })
  );
  return results;
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function pct(n, d) {
  if (!d) return '—';
  return `${((n / d) * 100).toFixed(1)}%`;
}

async function run() {
  console.log(`Loading up to ${SAMPLE_SIZE} card_ids from ${IDS_FILE}...`);
  const ids = loadCardIds(SAMPLE_SIZE);
  console.log(`Loaded ${ids.length} card_ids.\n`);
  if (ids.length === 0) {
    console.error('No card_ids found.');
    process.exit(1);
  }

  const items = [];
  for (const card_id of ids) {
    for (const grade of GRADES) items.push({ card_id, grade });
  }
  const chunks = chunk(items, BATCH_SIZE);
  console.log(`Firing ${items.length} items × 2 endpoints = ${chunks.length * 2} batches (concurrency ${CONCURRENCY})...\n`);

  const t0 = Date.now();
  const fmvBatches = await withConcurrency(chunks, CONCURRENCY, (c) => post('/v1/cards/card-fmv-batch', { items: c }));
  const fmvMs = Date.now() - t0;
  const t1 = Date.now();
  const legBatches = await withConcurrency(chunks, CONCURRENCY, (c) => post('/v1/cards/batch-price-estimate', { items: c }));
  const legMs = Date.now() - t1;
  console.log(`FMV: ${fmvMs}ms total, ${(fmvMs / chunks.length).toFixed(0)}ms/chunk`);
  console.log(`Legacy: ${legMs}ms total, ${(legMs / chunks.length).toFixed(0)}ms/chunk\n`);

  const fmvResults = fmvBatches.flatMap((b) => b.results || []);
  const legResults = legBatches.flatMap((b) => b.results || []);

  // Index by (card_id, grade)
  const fmvByKey = new Map();
  const legByKey = new Map();
  for (const r of fmvResults) fmvByKey.set(`${r.card_id}|${r.grade}`, r);
  for (const r of legResults) legByKey.set(`${r.card_id}|${r.grade}`, r);

  // Buckets per grade
  const tally = {};
  for (const g of GRADES) {
    tally[g] = {
      total: 0,
      bothPriced: 0,
      bothNull: 0,
      fmvRescued: 0,
      legacyOnly: 0,
      methods: {},
      confBuckets: { '>=0.7': 0, '0.5-0.7': 0, '0.2-0.5': 0, '<0.2': 0 },
      // Delta distribution (when both priced)
      deltaBuckets: { '0-1%': 0, '1-5%': 0, '5-10%': 0, '10-25%': 0, '25-50%': 0, '50%+': 0 },
      // Directional drift
      fmvHigher: 0,
      fmvLower: 0,
      identical: 0,
      // For median-ish summary
      deltas: [],
    };
  }

  for (const id of ids) {
    for (const g of GRADES) {
      const f = fmvByKey.get(`${id}|${g}`);
      const l = legByKey.get(`${id}|${g}`);
      const fp = f?.price ?? null;
      const lp = l?.price ?? null;
      const t = tally[g];
      t.total++;

      if (fp === null && lp === null) t.bothNull++;
      else if (fp !== null && lp === null) t.fmvRescued++;
      else if (fp === null && lp !== null) t.legacyOnly++;
      else {
        t.bothPriced++;
        const delta = Math.abs(fp - lp);
        const baseline = (Math.abs(fp) + Math.abs(lp)) / 2;
        const dPct = baseline > 0 ? (delta / baseline) * 100 : 0;
        t.deltas.push(dPct);
        if (dPct < 1) t.deltaBuckets['0-1%']++;
        else if (dPct < 5) t.deltaBuckets['1-5%']++;
        else if (dPct < 10) t.deltaBuckets['5-10%']++;
        else if (dPct < 25) t.deltaBuckets['10-25%']++;
        else if (dPct < 50) t.deltaBuckets['25-50%']++;
        else t.deltaBuckets['50%+']++;

        if (Math.abs(fp - lp) < 0.005) t.identical++;
        else if (fp > lp) t.fmvHigher++;
        else t.fmvLower++;
      }

      const method = f?.method ?? 'n/a';
      t.methods[method] = (t.methods[method] || 0) + 1;

      const conf = f?.confidence;
      if (typeof conf === 'number') {
        if (conf >= 0.7) t.confBuckets['>=0.7']++;
        else if (conf >= 0.5) t.confBuckets['0.5-0.7']++;
        else if (conf >= 0.2) t.confBuckets['0.2-0.5']++;
        else t.confBuckets['<0.2']++;
      }
    }
  }

  console.log('=== Coverage (FMV vs Legacy) ===\n');
  console.log(
    'Grade'.padEnd(10) +
      'Total'.padStart(7) +
      'Both priced'.padStart(14) +
      'FMV rescued'.padStart(14) +
      'Both null'.padStart(12) +
      'Legacy only'.padStart(14)
  );
  for (const g of GRADES) {
    const t = tally[g];
    console.log(
      g.padEnd(10) +
        String(t.total).padStart(7) +
        `${t.bothPriced} (${pct(t.bothPriced, t.total)})`.padStart(14) +
        `${t.fmvRescued} (${pct(t.fmvRescued, t.total)})`.padStart(14) +
        `${t.bothNull} (${pct(t.bothNull, t.total)})`.padStart(12) +
        `${t.legacyOnly} (${pct(t.legacyOnly, t.total)})`.padStart(14)
    );
  }

  console.log('\n=== FMV vs Legacy price delta (where both priced) ===\n');
  console.log(
    'Grade'.padEnd(10) +
      '0-1%'.padStart(9) +
      '1-5%'.padStart(9) +
      '5-10%'.padStart(9) +
      '10-25%'.padStart(10) +
      '25-50%'.padStart(10) +
      '50%+'.padStart(9) +
      'median'.padStart(9)
  );
  for (const g of GRADES) {
    const t = tally[g];
    const sorted = [...t.deltas].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].toFixed(1) + '%' : '—';
    console.log(
      g.padEnd(10) +
        String(t.deltaBuckets['0-1%']).padStart(9) +
        String(t.deltaBuckets['1-5%']).padStart(9) +
        String(t.deltaBuckets['5-10%']).padStart(9) +
        String(t.deltaBuckets['10-25%']).padStart(10) +
        String(t.deltaBuckets['25-50%']).padStart(10) +
        String(t.deltaBuckets['50%+']).padStart(9) +
        median.padStart(9)
    );
  }

  console.log('\n=== Directional drift (FMV vs Legacy) ===\n');
  console.log('Grade'.padEnd(10) + 'FMV higher'.padStart(14) + 'FMV lower'.padStart(13) + 'Identical'.padStart(13));
  for (const g of GRADES) {
    const t = tally[g];
    const denom = t.fmvHigher + t.fmvLower + t.identical;
    console.log(
      g.padEnd(10) +
        `${t.fmvHigher} (${pct(t.fmvHigher, denom)})`.padStart(14) +
        `${t.fmvLower} (${pct(t.fmvLower, denom)})`.padStart(13) +
        `${t.identical} (${pct(t.identical, denom)})`.padStart(13)
    );
  }

  console.log('\n=== FMV method distribution ===\n');
  console.log('Method'.padEnd(34) + 'Raw'.padStart(10) + 'PSA 9'.padStart(10) + 'PSA 10'.padStart(10));
  const allMethods = new Set();
  for (const g of GRADES) for (const m of Object.keys(tally[g].methods)) allMethods.add(m);
  for (const m of [...allMethods].sort()) {
    let row = m.padEnd(34);
    for (const g of GRADES) {
      const c = tally[g].methods[m] || 0;
      row += `${c} (${pct(c, tally[g].total)})`.padStart(10);
    }
    console.log(row);
  }

  console.log('\n=== FMV confidence distribution ===\n');
  console.log('Bucket'.padEnd(12) + 'Raw'.padStart(10) + 'PSA 9'.padStart(10) + 'PSA 10'.padStart(10));
  for (const b of ['>=0.7', '0.5-0.7', '0.2-0.5', '<0.2']) {
    let row = b.padEnd(12);
    for (const g of GRADES) {
      const c = tally[g].confBuckets[b];
      row += `${c} (${pct(c, tally[g].total)})`.padStart(10);
    }
    console.log(row);
  }

  console.log('\nDone.');
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
