import type { ManufacturerDescriptor } from './types';

/**
 * Bowman / Topps descriptor — covers every Bowman or Topps product.
 *
 * Source of truth for the underlying rules: docs/manufacturer-rules/bowman.md
 * Historical context: ported from the imperative BowmanKnowledge class on 2026-04-21.
 */
export const bowmanDescriptor: ManufacturerDescriptor = {
  id: 'bowman',
  name: 'Bowman/Topps',

  matches: /bowman|topps/i,

  stripPatterns: [
    // "Base - Gold Refractor Variation" → "Gold Refractor"
    /^Base\s*[-–]\s*/i,
    /\s+Variation\s*$/i,
    // Print runs in variant: "/50", "/99", "/25" — not present in CH variant names.
    /\s*\/\d+\s*/g,
    // "Retrofractor" — Bowman-specific term; CH calls these Base or Lazer Refractor.
    // Stripped so the generic matcher can later apply variantSynonyms.
    /\bRetrofractor\b/gi,
    // Section labels that survive insert-set-name stripping.
    /\bAutographs?\b/gi,
    /\bSuperfractor\b/gi,
  ],

  insertSetNames: [
    // Bowman Draft section labels
    /\d{4}\s+Draft\s+Lottery\s+Ping\s+Pong\s+Ball\b/gi,
    /\bBowman\s+Spotlights?\b/gi,
    /\bBowman\s+In\s+Action\s+Autographs?\b/gi,
    /\bChrome\s+Team\s+Sets?\b/gi,
    /\bBase\s+Set\s+Team\s+Sets?\b/gi,
    // Bowman's Best section labels
    /\bTop\s+Prospects?\b/gi,
    /\bStars?\s+of\s+the\s+Game\b/gi,
    /\bBase\s+Teams?\b/gi,
    /\bBest\s+Of\s+\d{4}\b/gi,
  ],

  // Applied AFTER stripPatterns. Keys are our cleaned variant; values are the
  // CH variants the matcher should try in order.
  variantSynonyms: {
    // "Retrofractor" already stripped — but if anything slipped through cleaning,
    // fall back to Base/Lazer Refractor.
    Retrofractor: ['Base', 'Lazer Refractor'],
    // Bowman XLSX sometimes calls a parallel "Black" when CH calls it Base.
    Black: ['Base'],
  },

  // Prefix must start with a letter but may contain digits (e.g. "B25").
  // Also matches pure numeric codes used in "Base Teams" inserts.
  cardCodePattern: /^([A-Z][A-Z0-9]*-[A-Z0-9]+|\d+)$/,

  // BMA, CPA, BPA, FDA, BSA, BRA, CRA, CA, QA, DA, TA — per River @ CardHedger,
  // these need "Autograph" appended to the CH search query to outrank base BCP.
  autoPrefixes: /^(BMA|CPA|BPA|FDA|BSA|BRA|CRA|CA|QA|DA|TA)-/i,

  multiPlayerIndicator: /\//,

  claudeRules: `Bowman/Topps matching rules:
- Year must match exactly. Reject cross-year candidates even if player + set look similar.
- Card numbers uniquely identify a player in a given set (letter-prefixed BDC-91 / B25-SS / BMA-JG / TP-8, or short numbers 38 / 69). If a candidate's number matches the query's number AND player + set match, that IS the correct card — confidence 0.9+.
- Accents collapse: Jesús = Jesus, Rodríguez = Rodriguez. Don't reject on accent diffs.
- "Retrofractor" in query = "Base" or "Lazer Refractor" in CH. "Black" = "Base".
- Print runs (/50, /99) appear in source but NOT CH — ignore when comparing.
- Insert set names (Top Prospects, Stars of the Game, Best Of 2025, Bowman Spotlights, Draft Lottery Ping Pong Ball) and labels ("Autographs", "Teams") are section headers, not variants.
- Parallels in CH don't have "Variation" suffix.
- CPA/BMA/BPA/FDA/BSA/BRA autographs live in the PARENT set in CH (not a separate "Autographs" set); autograph status is inferred from number prefix.
- 2026+: Bowman Chrome Prospects merges into the parent Bowman Chrome set. Match accordingly.`,
};
