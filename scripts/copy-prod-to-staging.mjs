/**
 * Copies product data from production to staging.
 * Tables: sports, products, players, player_products, player_product_variants
 *
 * Usage:
 *   PROD_SERVICE_ROLE_KEY=<key> STAGING_SERVICE_ROLE_KEY=<key> node scripts/copy-prod-to-staging.mjs
 */

import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://zucuzhtiitibsvryenpi.supabase.co';
const STAGING_URL = 'https://isqxqsznbozlipjvttha.supabase.co';

const PROD_KEY = process.env.PROD_SERVICE_ROLE_KEY;
if (!PROD_KEY) {
  console.error('Missing PROD_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const STAGING_KEY = process.env.STAGING_SERVICE_ROLE_KEY;
if (!STAGING_KEY) {
  console.error('Missing STAGING_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY);
const staging = createClient(STAGING_URL, STAGING_KEY);

// Tables in dependency order. ignoreDuplicates skips rows that already exist.
// columnsExclude: columns that exist in staging but not prod (generated/default cols).
const TABLES = [
  { name: 'sports',                   ignoreDuplicates: false },
  { name: 'products',                 ignoreDuplicates: false },
  { name: 'players',                  ignoreDuplicates: false },
  { name: 'player_products',          ignoreDuplicates: false, columnsExclude: ['total_sets'] },
  { name: 'player_product_variants',  ignoreDuplicates: false },
];

async function copyTable(table) {
  const { name, ignoreDuplicates, columnsExclude = [] } = table;
  console.log(`\nCopying ${name}...`);

  // Paginate to get all rows (Supabase default limit is 1000)
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await prod.from(name).select('*').range(from, from + PAGE - 1);
    if (error) { console.error(`  ✗ fetch failed:`, error.message); return; }
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const data = all;
  if (!data.length) { console.log(`  — no rows`); return; }

  console.log(`  fetched ${data.length} rows`);

  // Strip columns that don't exist in staging
  const rows = columnsExclude.length
    ? data.map(row => {
        const r = { ...row };
        columnsExclude.forEach(col => delete r[col]);
        return r;
      })
    : data;

  // Upsert in batches of 500
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error: upsertError } = await staging
      .from(name)
      .upsert(batch, { onConflict: table.onConflict ?? 'id', ignoreDuplicates });
    if (upsertError) {
      console.error(`  ✗ upsert batch ${i}–${i + batch.length} failed:`, upsertError.message);
    } else {
      console.log(`  ✓ upserted rows ${i + 1}–${i + batch.length}`);
    }
  }
}

// Wipe staging in reverse dependency order so foreign keys don't block deletes
const REVERSE = [...TABLES].reverse();
console.log('Clearing staging tables...');
for (const { name } of REVERSE) {
  const { error } = await staging.from(name).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) console.error(`  ✗ clear ${name} failed:`, error.message);
  else console.log(`  ✓ cleared ${name}`);
}

for (const table of TABLES) {
  await copyTable(table);
}

console.log('\nDone.');
