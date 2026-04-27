#!/usr/bin/env node
// One-off: re-import checklists for multiple products via the production
// parse-checklist + import-checklist endpoints. Used to populate
// player_products.checklist_card_numbers across the active product set after
// the 2026-04-27 architectural shift to checklist-as-source-of-truth.
//
// Usage:
//   CRON_SECRET=... node scripts/bulk-import-checklists.mjs <root_dir>
//
//   <root_dir> should contain one subdirectory per product, each with a
//   *.xlsx checklist file. Directory names are matched against the products
//   table (with a few hand-coded aliases for known mismatches like "Bowmans"
//   vs "Bowman's").
//
// Skips:
//   - directories with no .xlsx
//   - directories that don't map to a product
//   - .xlsx files that look like odds PDFs or alt formats (prefers files with
//     "Checklist" in the name)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2];
const HOST = process.env.HOST ?? 'https://www.getbreakiq.com';
const CRON_SECRET = process.env.CRON_SECRET;

if (!ROOT || !CRON_SECRET) {
  console.error('Usage: CRON_SECRET=... node scripts/bulk-import-checklists.mjs <root_dir>');
  process.exit(1);
}

// Hardcoded directory-name → product UUID mapping. One-off script; hardcoding
// avoids needing a list-products endpoint and makes the run reproducible.
const DIR_TO_PRODUCT_ID = {
  '2025 Bowman Chrome Baseball': '1b18d673-2e9a-4580-8a74-0652c1b7f2aa',
  '2025 Bowman Draft Baseball': '633e60f1-b67f-4d8c-a6fd-53d63b6415ca',
  '2025 Bowman Draft Baseball Sapphire': 'cb2bd0ef-41dd-49d7-a846-40f778cb1225',
  '2025 Bowmans Best Baseball': '3a9e1249-a264-4cb9-a708-2a9c5c1be3e2',
  '2025 Topps Pristine Baseball': '51ae90f6-edc2-4ac7-ba08-715d02a4397c',
  '2025-26 Topps 3 Basketball': '1843a761-ca8a-4aaf-a3b5-068854bcdb0a',
  '2025-26 Topps Chrome Basketball': '136223d4-32e7-4b20-940e-5e4c5b6b5ae9',
  '2025-26 Topps Chrome Basketball Midnight': '5f3f1977-b935-4c58-b637-94d44585a6a9',
  '2025-26 Topps Chrome Sapphire': '91b4c72b-d3e8-4540-9eec-b01a5c2bcc42',
  '2025-26 Topps Finest Basketball': 'dcb3b310-b2c6-4301-a31a-7b458034b530',
};

function resolveProductId(dirName) {
  return DIR_TO_PRODUCT_ID[dirName] ?? null;
}

function pickChecklistXlsx(dir) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xlsx'));
  if (files.length === 0) return null;
  // Prefer files with "Checklist" in the name; fall back to the only/first xlsx.
  const checklist = files.find(f => /checklist/i.test(f));
  return path.join(dir, checklist ?? files[0]);
}

async function parseChecklist(filePath) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  const fd = new FormData();
  fd.append('file', blob, path.basename(filePath));

  const res = await fetch(`${HOST}/api/admin/parse-checklist`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`parse-checklist failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function importSections(productId, sections) {
  const res = await fetch(`${HOST}/api/admin/import-checklist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify({ productId, sections }),
  });
  if (!res.ok) throw new Error(`import-checklist failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`[bulk-import] root=${ROOT} host=${HOST}`);

  const dirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dirName of dirs) {
    const productId = resolveProductId(dirName);
    if (!productId) {
      console.log(`[bulk-import] SKIP "${dirName}" — no matching product`);
      continue;
    }

    const xlsxPath = pickChecklistXlsx(path.join(ROOT, dirName));
    if (!xlsxPath) {
      console.log(`[bulk-import] SKIP "${dirName}" — no .xlsx file found`);
      continue;
    }

    console.log(`[bulk-import] "${dirName}" → ${productId}`);
    console.log(`              file: ${path.basename(xlsxPath)}`);

    try {
      const parseResult = await parseChecklist(xlsxPath);
      const sectionCount = parseResult?.sections?.length ?? 0;
      const cardCount = (parseResult?.sections ?? []).reduce(
        (acc, s) => acc + (s.cards?.length ?? 0),
        0,
      );
      if (!sectionCount) {
        console.log(`              parse returned 0 sections — skipping`);
        continue;
      }
      console.log(`              parsed: ${sectionCount} sections, ${cardCount} cards`);

      const importResult = await importSections(productId, parseResult.sections);
      console.log(
        `              imported: ${importResult.playersCreated ?? '?'} players, ` +
          `${importResult.playerProductsCreated ?? '?'} player_products, ` +
          `${importResult.variantsCreated ?? '?'} variants`,
      );
    } catch (err) {
      console.error(`              ERROR: ${err.message}`);
    }
  }

  console.log('[bulk-import] done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
