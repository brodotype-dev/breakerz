/**
 * map-cards.mjs
 *
 * Interactive script to search CardHedger and map card IDs to players.
 * Run: node scripts/map-cards.mjs
 *
 * For each player missing a cardhedger_card_id, it searches CardHedger,
 * shows you the top results, and lets you pick the right one.
 */

import { createClient } from '@supabase/supabase-js';
import readline from 'readline';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (no dotenv dependency needed)
const envPath = resolve(process.cwd(), '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const [key, ...rest] = l.split('=');
      return [key.trim(), rest.join('=').trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const CARDHEDGER_KEY = env.CARDHEDGER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !CARDHEDGER_KEY) {
  console.error('Missing env vars. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function searchCardHedger(query) {
  const res = await fetch('https://api.cardhedger.com/v1/cards/card-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CARDHEDGER_KEY}`,
    },
    body: JSON.stringify({ search: query }),
  });
  if (!res.ok) throw new Error(`CardHedger error: ${res.status}`);
  return res.json();
}

async function main() {
  console.log('\n── Card Breakerz: CardHedger Card Mapper ──\n');

  // Load all player_products with no card ID, joined with player + product info
  const { data: rows, error } = await supabase
    .from('player_products')
    .select('id, cardhedger_card_id, player:players(name, team), product:products(name, year, slug)')
    .is('cardhedger_card_id', null)
    .eq('insert_only', false)
    .order('id');

  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  if (!rows.length) { console.log('All players already have card IDs mapped. ✓'); rl.close(); return; }

  console.log(`Found ${rows.length} players needing card IDs.\n`);
  console.log('Commands: enter a number to select, [s] to skip, [q] to quit, or type a custom search.\n');

  for (const row of rows) {
    const { name, team } = row.player;
    const { name: productName, year } = row.product;

    console.log(`\n─────────────────────────────────`);
    console.log(`Player : ${name} (${team})`);
    console.log(`Product: ${productName} ${year}`);

    let results = [];
    let query = `${name} ${year} Topps Finest`;

    // Search loop — allows custom query retry
    while (true) {
      process.stdout.write(`Searching: "${query}"... `);
      try {
        const data = await searchCardHedger(query);
        results = data.cards ?? [];
        console.log(`${results.length} results\n`);
      } catch (e) {
        console.log(`Error: ${e.message}`);
        results = [];
      }

      if (results.length === 0) {
        console.log('  No results found.');
      } else {
        const top = results.slice(0, 8);
        top.forEach((c, i) => {
          console.log(`  [${i + 1}] ${c.card_id.padEnd(12)} ${c.year ?? ''} ${c.set_name ?? ''} — ${c.player_name ?? ''}`);
        });
      }

      const input = (await ask('\nPick [1-8], [s]kip, [q]uit, or type new search: ')).trim();

      if (input.toLowerCase() === 'q') {
        console.log('\nDone.\n');
        rl.close();
        return;
      }

      if (input.toLowerCase() === 's') {
        console.log('  Skipped.');
        break;
      }

      const num = parseInt(input);
      if (!isNaN(num) && num >= 1 && num <= results.length) {
        const selected = results[num - 1];
        const { error: updateError } = await supabase
          .from('player_products')
          .update({ cardhedger_card_id: selected.card_id })
          .eq('id', row.id);

        if (updateError) {
          console.log(`  ✗ Failed to save: ${updateError.message}`);
        } else {
          console.log(`  ✓ Mapped ${name} → ${selected.card_id}`);
        }
        break;
      }

      // Treat input as a custom search query
      query = input;
    }
  }

  console.log('\n── All done ──\n');
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
