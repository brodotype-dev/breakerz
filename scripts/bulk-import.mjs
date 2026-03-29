/**
 * Bulk product import script
 *
 * Prerequisites:
 *   1. npm run dev  (in a separate terminal — this script calls http://localhost:3000)
 *   2. node scripts/bulk-import.mjs
 *
 * What it does per product:
 *   1. Creates the product in Supabase
 *   2. Parses the checklist XLSX → imports players + variants
 *   3. Runs CardHedger matching (polls until complete)
 *   4. Parses the odds PDF → applies odds to variants
 *
 * All products are imported as DRAFT. Go live manually from the product dashboard.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://zucuzhtiitibsvryenpi.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1Y3V6aHRpaXRpYnN2cnllbnBpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzYxNzgyOSwiZXhwIjoyMDg5MTkzODI5fQ.Ihm0gjb9aDvT24EOv32NouYQBYf2NFlgvHjX_qyEoiQ';
const API_BASE = 'http://localhost:3000';
const CHECKLIST_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '../checklists');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Product manifest ──────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    name: '2025 Bowman Chrome Baseball',
    year: 2025,
    sport: 'baseball',
    manufacturer: 'Topps',
    slug: '2025-bowman-chrome-baseball',
    hobby_case_cost: 5700,
    bd_case_cost: 3300,
    checklistFile: '2025 Bowman Chrome Baseball/2025-Bowman-Chrome-Baseball-Checklist.xlsx',
    oddsFile: '2025 Bowman Chrome Baseball/2025_Bowman_Chrome_Baseball_Odds.pdf',
  },
  {
    name: '2025 Bowman Draft Baseball',
    year: 2025,
    sport: 'baseball',
    manufacturer: 'Topps',
    slug: '2025-bowman-draft-baseball',
    hobby_case_cost: 5500,
    bd_case_cost: 4600,
    checklistFile: '2025 Bowman Draft Baseball/2025-Bowman-Draft-Baseball-Checklist.xlsx',
    oddsFile: '2025 Bowman Draft Baseball/2025_Bowman_Draft_Baseball_Odds.pdf',
  },
  {
    name: '2025 Bowman Draft Baseball Sapphire',
    year: 2025,
    sport: 'baseball',
    manufacturer: 'Topps',
    slug: '2025-bowman-draft-baseball-sapphire',
    hobby_case_cost: 11500,
    bd_case_cost: null,
    checklistFile: '2025 Bowman Draft Baseball Sapphire/2025-Bowman-Draft-Sapphire-Baseball-Checklist.xlsx',
    oddsFile: '2025 Bowman Draft Baseball Sapphire/2025_Bowman_Draft_Baseball_Odds (1).pdf',
  },
  {
    name: "2025 Bowman's Best Baseball",
    year: 2025,
    sport: 'baseball',
    manufacturer: 'Topps',
    slug: '2025-bowmans-best-baseball',
    hobby_case_cost: 5000,
    bd_case_cost: null,
    checklistFile: "2025 Bowmans Best Baseball/2025-Bowmans-Best-Baseball-Checklist.xlsx",
    oddsFile: "2025 Bowmans Best Baseball/2025_Bowman_s_Best_Baseball_Odds.pdf",
  },
  {
    name: '2025 Topps Pristine Baseball',
    year: 2025,
    sport: 'baseball',
    manufacturer: 'Topps',
    slug: '2025-topps-pristine-baseball',
    hobby_case_cost: 4400,
    bd_case_cost: null,
    checklistFile: '2025 Topps Pristine Baseball/2025-Topps-Pristine-Baseball-Checklist.xlsx',
    oddsFile: '2025 Topps Pristine Baseball/2025ToppsPristineBaseballOdds.pdf',
  },
  {
    name: '2025-26 Topps 3 Basketball',
    year: 2025,
    sport: 'basketball',
    manufacturer: 'Topps',
    slug: '2025-26-topps-3-basketball',
    hobby_case_cost: 9000,
    bd_case_cost: null,
    checklistFile: '2025-26 Topps 3 Basketball/2025-26-Topps-Three-Basketball-Checklist.xlsx',
    oddsFile: '2025-26 Topps 3 Basketball/2025-26_Topps_Three_Basketball_Odds.pdf',
  },
  {
    name: '2025-26 Topps Chrome Basketball',
    year: 2025,
    sport: 'basketball',
    manufacturer: 'Topps',
    slug: '2025-26-topps-chrome-basketball',
    hobby_case_cost: 13100,
    bd_case_cost: 21000,
    checklistFile: '2025-26 Topps Chrome Basketball/2025-26-Topps-Chrome-Basketball-Checklist.xlsx',
    oddsFile: '2025-26 Topps Chrome Basketball/2025-26_Topps_Chrome_Basketball_Odds.pdf',
  },
  {
    name: '2025-26 Topps Chrome Basketball Midnight',
    year: 2025,
    sport: 'basketball',
    manufacturer: 'Topps',
    slug: '2025-26-topps-chrome-basketball-midnight',
    hobby_case_cost: 7600,
    bd_case_cost: null,
    checklistFile: '2025-26 Topps Chrome Basketball Midnight/2025-26-Topps-Midnight-Basketball-Checklist.xlsx',
    oddsFile: '2025-26 Topps Chrome Basketball Midnight/2025-26_Topps_Midnight_Basketball_Odds.pdf',
  },
  {
    name: '2025-26 Topps Chrome Sapphire Basketball',
    year: 2025,
    sport: 'basketball',
    manufacturer: 'Topps',
    slug: '2025-26-topps-chrome-sapphire-basketball',
    hobby_case_cost: 46000,
    bd_case_cost: null,
    checklistFile: '2025-26 Topps Chrome Sapphire/2025-26-Topps-Chrome-Sapphire-Basketball-Checklist.xlsx',
    oddsFile: '2025-26 Topps Chrome Sapphire/2025-26-Topps-Chrome-Sapphire-Basketball-Checklist-Downloads-Odds.pdf',
  },
  {
    name: '2025-26 Topps Finest Basketball',
    year: 2025,
    sport: 'basketball',
    manufacturer: 'Topps',
    slug: '2025-26-topps-finest-basketball',
    hobby_case_cost: 7500,
    bd_case_cost: 14000,
    checklistFile: '2025-26 Topps Finest Basketball/2025-26-Topps-Finest-Basketball-Checklist.xlsx',
    oddsFile: '2025-26 Topps Finest Basketball/2025-2026_Topps_Finest_Basketball_Odds.pdf',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(product, stage, msg) {
  console.log(`[${product}] ${stage}: ${msg}`);
}

function warn(product, stage, msg) {
  console.warn(`[${product}] ⚠ ${stage}: ${msg}`);
}

function fail(product, stage, msg) {
  console.error(`[${product}] ✗ ${stage}: ${msg}`);
}

// ── Step 1: Create product ────────────────────────────────────────────────────

async function createProduct(p, sportMap) {
  const sportId = sportMap[p.sport];
  if (!sportId) throw new Error(`Unknown sport: ${p.sport}`);

  // Check for existing slug
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('slug', p.slug)
    .single();

  if (existing) {
    warn(p.name, 'create', `slug already exists — skipping creation, using existing id ${existing.id}`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      name: p.name,
      year: p.year,
      sport_id: sportId,
      manufacturer: p.manufacturer,
      slug: p.slug,
      hobby_case_cost: p.hobby_case_cost,
      bd_case_cost: p.bd_case_cost ?? null,
      is_active: false,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  log(p.name, 'create', `✓ product id ${data.id}`);
  return data.id;
}

// ── Step 2: Parse checklist ───────────────────────────────────────────────────

async function parseChecklist(productName, checklistPath) {
  const buffer = fs.readFileSync(checklistPath);
  const filename = path.basename(checklistPath);

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);

  const res = await fetch(`${API_BASE}/api/admin/parse-checklist`, {
    method: 'POST',
    body: formData,
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  const { sections } = json.checklist;
  const totalCards = sections.reduce((n, s) => n + s.cards.length, 0);
  log(productName, 'parse', `✓ ${sections.length} sections, ${totalCards} cards`);
  return json.checklist;
}

// ── Step 3: Import checklist ──────────────────────────────────────────────────

async function importChecklist(productName, productId, checklist) {
  // Default hobbySets/bdSets: 1 hobby set per section — matches wizard defaults
  const sections = checklist.sections.map(s => ({
    sectionName: s.sectionName,
    hobbySets: 1,
    bdSets: 0,
    cards: s.cards,
  }));

  const res = await fetch(`${API_BASE}/api/admin/import-checklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, sections }),
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  log(productName, 'import', `✓ ${json.playersCreated} players, ${json.variantsCreated} variants`);
  return json;
}

// ── Step 4: Run CardHedger matching (chunked poll) ────────────────────────────

async function runMatching(productName, productId) {
  let offset = 0;
  let total = null;
  let auto = 0, review = 0, noMatch = 0;

  while (true) {
    const res = await fetch(`${API_BASE}/api/admin/match-cardhedger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, offset, limit: 40 }),
    });

    const json = await res.json();
    if (json.error) throw new Error(json.error);

    if (total === null) total = json.total;

    for (const r of json.results) {
      if (r.status === 'auto') auto++;
      else if (r.status === 'review') review++;
      else noMatch++;
    }

    process.stdout.write(`\r[${productName}] matching: ${offset + json.processed}/${total} variants…`);

    if (!json.hasMore) break;
    offset = json.nextOffset;

    // Small pause between chunks to avoid hammering CardHedger
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(''); // newline after progress
  log(productName, 'matching', `✓ ${auto} auto, ${review} review, ${noMatch} no-match (of ${total})`);
  return { auto, review, noMatch, total };
}

// ── Step 5: Parse odds PDF ────────────────────────────────────────────────────

async function parseOdds(productName, productId, oddsPath) {
  const buffer = fs.readFileSync(oddsPath);
  const filename = path.basename(oddsPath);

  const formData = new FormData();
  formData.append('productId', productId);
  formData.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);

  const res = await fetch(`${API_BASE}/api/admin/parse-odds`, {
    method: 'POST',
    body: formData,
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  log(productName, 'parse-odds', `✓ ${json.odds?.rows?.length ?? 0} rows`);
  return json.odds;
}

// ── Step 6: Apply odds ────────────────────────────────────────────────────────

async function applyOdds(productName, productId, odds) {
  const res = await fetch(`${API_BASE}/api/admin/apply-odds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, odds }),
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  log(productName, 'apply-odds', `✓ ${json.updatedCount} variants updated`);
  return json;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Breakerz Bulk Import');
  console.log('='.repeat(60));

  // Verify dev server is up
  try {
    await fetch(`${API_BASE}/api/admin/products`);
  } catch {
    console.error('\n✗ Cannot reach http://localhost:3000 — is "npm run dev" running?\n');
    process.exit(1);
  }

  // Get sport IDs
  const { data: sports, error: sportsErr } = await supabase.from('sports').select('id, name');
  if (sportsErr) { console.error('Failed to fetch sports:', sportsErr.message); process.exit(1); }
  const sportMap = {};
  for (const s of sports) sportMap[s.name.toLowerCase()] = s.id;
  console.log('Sports loaded:', Object.keys(sportMap).join(', '));
  console.log('');

  const results = [];

  for (const product of PRODUCTS) {
    console.log('-'.repeat(60));
    console.log(`Starting: ${product.name}`);
    const result = { name: product.name, productId: null, error: null, matching: null };

    try {
      const checklistPath = path.join(CHECKLIST_DIR, product.checklistFile);
      const oddsPath = product.oddsFile ? path.join(CHECKLIST_DIR, product.oddsFile) : null;

      if (!fs.existsSync(checklistPath)) throw new Error(`Checklist not found: ${checklistPath}`);

      // 1. Create product
      result.productId = await createProduct(product, sportMap);

      // 2. Parse + import checklist
      const checklist = await parseChecklist(product.name, checklistPath);
      await importChecklist(product.name, result.productId, checklist);

      // 3. CardHedger matching
      result.matching = await runMatching(product.name, result.productId);

      // 4. Odds (if file exists)
      if (oddsPath && fs.existsSync(oddsPath)) {
        try {
          const odds = await parseOdds(product.name, result.productId, oddsPath);
          await applyOdds(product.name, result.productId, odds);
        } catch (oddsErr) {
          warn(product.name, 'odds', `failed (non-fatal): ${oddsErr.message}`);
        }
      } else if (product.oddsFile) {
        warn(product.name, 'odds', `file not found, skipping`);
      }

      log(product.name, 'DONE', `✓ /admin/products/${result.productId}`);
    } catch (err) {
      result.error = err.message;
      fail(product.name, 'FAILED', err.message);
    }

    results.push(result);
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  const ok = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);

  console.log(`✓ ${ok.length} products imported`);
  if (failed.length) {
    console.log(`✗ ${failed.length} failed:`);
    for (const r of failed) console.log(`   - ${r.name}: ${r.error}`);
  }

  console.log('\nMatching summary:');
  for (const r of ok) {
    if (r.matching) {
      const { auto, review, noMatch, total } = r.matching;
      const pct = total ? Math.round((auto / total) * 100) : 0;
      console.log(`  ${r.name}: ${pct}% auto (${auto}/${total}), ${noMatch} unmatched`);
    }
  }

  console.log('\nAll products imported as DRAFT — activate from /admin/products.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
