// Sanity-check the Panini Master Checklist parser against a real XLSX.
//
// Usage:
//   npx tsx scripts/verify-panini-parser.mjs ~/Downloads/2025-Panini-Prizm-Football.xlsx
//
// With no arg, defaults to 2025 Panini Prizm Football in ~/Downloads/.
// Prints section count, total cards, sample sections, and the player with
// the most variants so you can confirm the per-(player, parallel) row
// expansion is firing correctly.

import fs from 'fs';
import path from 'path';
import os from 'os';

const arg = process.argv[2] || path.join(os.homedir(), 'Downloads/2025-Panini-Prizm-Football.xlsx');
const xlsxPath = path.resolve(arg);
if (!fs.existsSync(xlsxPath)) {
  console.error(`File not found: ${xlsxPath}`);
  process.exit(1);
}

const { parseChecklistXlsx } = await import('../lib/checklist-parser.ts');
const buf = fs.readFileSync(xlsxPath);
const result = parseChecklistXlsx(buf);

console.log(`File:           ${xlsxPath}`);
console.log(`detectedFormat: ${result.detectedFormat}`);
console.log(`sections:       ${result.sections.length}`);

let totalCards = 0;
for (const s of result.sections) totalCards += s.cards.length;
console.log(`total cards:    ${totalCards}`);

console.log('\nFirst 5 sections:');
for (const s of result.sections.slice(0, 5)) {
  console.log(`  "${s.sectionName}" — ${s.cards.length} cards`);
  if (s.cards[0]) {
    const c = s.cards[0];
    console.log(`    sample: player="${c.playerName}" team="${c.team}" #${c.cardNumber}${c.printRun ? ` /${c.printRun}` : ''}`);
  }
}

const counts = new Map();
const variantsByPlayer = new Map();
for (const s of result.sections) {
  for (const c of s.cards) {
    counts.set(c.playerName, (counts.get(c.playerName) ?? 0) + 1);
    const v = variantsByPlayer.get(c.playerName) ?? [];
    v.push(s.sectionName);
    variantsByPlayer.set(c.playerName, v);
  }
}
const starPlayer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
if (starPlayer) {
  const [name, count] = starPlayer;
  console.log(`\nMost-variants player: ${name} → ${count} variants`);
  console.log(`  first 5 parallels: ${variantsByPlayer.get(name).slice(0, 5).join(', ')}`);
}
