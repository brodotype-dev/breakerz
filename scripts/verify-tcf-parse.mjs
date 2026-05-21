import { readFileSync } from 'fs';
import { parseChecklistXlsx } from '../lib/checklist-parser.ts';

const buf = readFileSync('/Users/brody/Downloads/2025-Topps-Chrome-Football-Checklist.xlsx');
const out = parseChecklistXlsx(buf);
console.log(`detectedFormat=${out.detectedFormat}, sections=${out.sections.length}`);
for (const s of out.sections) {
  const sampleCard = s.cards[0];
  const parallelsStr = sampleCard?.parallels?.length ? ` [parallels: ${sampleCard.parallels.join(', ')}]` : '';
  console.log(`  "${s.sectionName}" — ${s.cards.length} cards${parallelsStr}`);
}
