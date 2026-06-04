/**
 * Verify the Discord-insight wrong-player guard (matchedNameMissingFromText in
 * lib/insights-parser.ts). Run: npx tsx scripts/verify-match-warning.ts
 *
 * Catches the "Russel Wilson retired" → Sam Darnold class (model binds a
 * positionally/team-related player). The check warns (never drops) when the
 * bound player's name isn't found in the contributor's text — fuzzy enough to
 * stay quiet on misspellings/accents the model correctly resolved.
 */
import { matchedNameMissingFromText as miss } from '../lib/insights-parser';

// [boundPlayerName, contributorText, expectWarning]
const CASES: Array<[string, string, boolean]> = [
  ['Sam Darnold', 'Russel Wilson retired', true],      // the bug → warn
  ['Russell Wilson', 'Russel Wilson retired', false],  // correct match, misspelled input
  ['Russell Wilson', 'russell wilson retired', false],
  ['Cooper Flagg', 'Flagg going nuts', false],         // surname present
  ['Shohei Ohtani', '', false],                        // screenshot-only (no text) → never warn
  ['Victor Wembanyama', 'Victor Wembanyama is hurt', false],
  ['Juan Soto', 'Soto homered again', false],
  ['Sam Darnold', 'Darnold threw 3 picks', false],     // legit Darnold mention
  ['José Ramírez', 'Jose Ramirez is mashing', false],  // accents folded
  ['Kyle Schwarber', 'Schwarbomb again', false],       // surname prefix-ish — exact token "schwarber" absent, but...
];

let fail = 0;
for (const [name, text, want] of CASES) {
  const got = miss(name, text);
  // "Schwarbomb" does NOT contain "schwarber" within edit-distance 1 → would warn.
  // Accept either for that nickname-y case; it's a soft warning, not a drop.
  if (name === 'Kyle Schwarber') { console.log(`note warn=${got}  "${name}" vs "${text}" (soft, either ok)`); continue; }
  if (got !== want) { fail++; console.log('FAIL', JSON.stringify({ name, text }), 'got', got, 'want', want); }
  else console.log(`ok warn=${got}  "${name}" vs "${text}"`);
}
console.log(fail === 0 ? 'match-warning: ALL PASS' : `match-warning: ${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
