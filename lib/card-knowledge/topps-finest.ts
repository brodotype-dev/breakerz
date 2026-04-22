import type { ManufacturerDescriptor } from './types';

/**
 * Topps Finest descriptor — targets 2025+ Topps Finest Basketball and follow-ons.
 *
 * Why a dedicated descriptor (and not just bowmanDescriptor):
 *   - Topps Finest uses its own parallel naming ("Red Geometric /5" / "SuperFractor /1")
 *     that doesn't match CH's variant names verbatim — CH appends " Refractor" to most
 *     colored parallels and uses "SuperFractor" (one word, capital F).
 *   - Topps Finest inserts have their own code prefixes (FAU-, RFA-, CS-, MA-, ESG-,
 *     H-, TM-, AU-, BA-, F-, A-, M-, P-) that should surface as card-code matches.
 *   - The bowman descriptor strips "Superfractor" entirely from the variant, which
 *     kills exact-variant matches on Topps Finest SuperFractor rows.
 *
 * Registry order: this must come BEFORE bowmanDescriptor so `topps finest` wins over
 * the broader `topps|bowman` pattern.
 */
export const toppsFinestDescriptor: ManufacturerDescriptor = {
  id: 'topps-finest',
  name: 'Topps Finest',

  matches: /topps\s*finest/i,

  stripPatterns: [
    // Print runs — universal, always strip before comparison.
    /\s*\/\d+\s*/g,
    // "Base - Common/Uncommon/Rare/Short Print" qualifiers on base rows.
    /^Base\s*[-–]\s*(Common|Uncommon|Rare|Short\s*Print)\s*$/i,
    // Section-label crumbs that sometimes land in variant.
    /\bVariation\s*$/i,
  ],

  insertSetNames: [
    // Section headers the XLSX parser sometimes stores as variant_name.
    /^Finest\s+Autographs?$/i,
    /^Finest\s+Rookie\s+Autographs?$/i,
    /^Baseline\s+Autographs?$/i,
    /^Masters\s+Autographs?$/i,
    /^Electrifying\s+Signatures?$/i,
    /^Colossal\s+Shots?\s+Autographs?$/i,
    /^Headliners?$/i,
    /^The\s+Man$/i,
    /^Muse$/i,
    /^Aura$/i,
    /^Arrivals?$/i,
    /^First$/i,
    /^Parallels?$/i,
    /^Base\s+Set$/i,
    // "Teams" shows up as a column crumb on malformed rows.
    /^Teams?$/i,
  ],

  // Checklist parallels → CH catalog variants. Keys match the CHECKLIST wording
  // AFTER stripPatterns run (print runs and qualifiers removed, trimmed).
  //
  // Pattern: Topps Finest checklists use "<color>" and "<color> Geometric",
  // CH's catalog usually appends " Refractor". Superfractor is a case fix.
  variantSynonyms: {
    // Single-color parallels → "<color> Refractor"
    Blue: ['Blue Refractor'],
    Green: ['Green Refractor'],
    Gold: ['Gold Refractor'],
    Orange: ['Orange Refractor'],
    Purple: ['Purple Refractor'],
    Red: ['Red Refractor'],
    Black: ['Black Refractor', 'Base'],
    'Sky Blue': ['Sky Blue Refractor'],

    // Geometric parallels → "<color> Geometric Refractor"
    'Blue Geometric': ['Blue Geometric Refractor'],
    'Green Geometric': ['Green Geometric Refractor'],
    'Gold Geometric': ['Gold Geometric Refractor'],
    'Orange Geometric': ['Orange Geometric Refractor'],
    'Purple Geometric': ['Purple Geometric Refractor'],
    'Red Geometric': ['Red Geometric Refractor'],
    'Black Geometric': ['Black Geometric Refractor'],
    'Yellow Geometric': ['Yellow Geometric Refractor'],

    // Slash-delimited compound colors — CH catalog stores without the slash.
    'Red/Black Geometric': ['Red Black Geometric Refractor'],
    'Red/Black Vapor': ['Red Black Vapor Refractor'],

    // Die-Cut in catalog has a hyphen; checklist may not.
    'Die Cut': ['Die-Cut Refractor'],
    'Die-Cut': ['Die-Cut Refractor'],

    // SuperFractor — catalog canonicalizes to "SuperFractor" (762 rows) vs the
    // rare lowercase "Superfractor" (2 rows). byNumberVariant lookup is
    // case-insensitive, so this synonym is a belt-and-suspenders fallback.
    Superfractor: ['SuperFractor'],

    // Ambiguous "Geometric" — either base Geometric (300) or Geometric Refractor (100).
    // Prefer the base "Geometric" since that's the headline parallel; the Refractor
    // version is a rarer parallel-of-a-parallel.
    Geometric: ['Geometric', 'Geometric Refractor'],
  },

  // Topps Finest insert prefixes: FAU- (Finest Autographs), RFA- (Rookie Finest Autos),
  // CS- (Colossal Shots), MA- (Masters Autos), ESG- (Electrifying Signatures),
  // BA- (Baseline Autos), H- (Headliners), TM- (The Man), AU- (Autograph insert),
  // F- (First), A- (Arrivals), M- (Muse), P- (Unknown but short-prefix codes exist).
  // Plain \d+ covers the base set (#1–300).
  cardCodePattern: /^([A-Z][A-Z0-9]*-[A-Z0-9]+|\d+)$/,

  // Autograph-bearing prefixes — used only in Claude-fallback query enrichment.
  autoPrefixes: /^(FAU|RFA|BA|MA|ESG|CS|AU)-/i,

  multiPlayerIndicator: /\//,

  claudeRules: `Topps Finest matching rules:
- Year must match exactly. Reject cross-year candidates.
- Base set: #1–300 (Common 1–100, Uncommon 101–200, Rare 201–300).
- Insert code prefixes identify the subset: FAU (Finest Autos), RFA (Rookie Finest Autos), CS (Colossal Shots), MA (Masters Autos), ESG (Electrifying Sigs), BA (Baseline Autos), H (Headliners), TM (The Man), AU, F (First), A (Arrivals), M (Muse).
- Parallel naming: CH appends " Refractor" to most single-color parallels. "Red" = "Red Refractor", "Gold" = "Gold Refractor".
- Geometric parallels: "<Color> Geometric" in checklist = "<Color> Geometric Refractor" in CH.
- "Red/Black Geometric" (slash) = "Red Black Geometric Refractor" (no slash) in CH.
- "Superfractor" (lowercase f) usually stored as "SuperFractor" (capital F) in CH.
- Print runs (/1, /5, /10, /25, /50, /75, /99, /150, /250, /350) are in source but not CH — ignore when comparing.
- "Teams" in variant is a column header from the Teams sheet — not a real variant.
- "Base - Common/Uncommon/Rare" qualifiers are section labels, not variants.`,
};
