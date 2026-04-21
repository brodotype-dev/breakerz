import type { ManufacturerDescriptor } from './types';

/**
 * Panini descriptor — covers Panini, Donruss, Prizm, Select, Mosaic, Optic, etc.
 *
 * Starter rules based on common Panini patterns. Refine once we have real Panini
 * XLSX files imported and can see which variant strings actually appear.
 */
export const paniniDescriptor: ManufacturerDescriptor = {
  id: 'panini',
  name: 'Panini',

  matches: /panini|donruss|prizm|select|mosaic|optic/i,

  stripPatterns: [
    // Print runs — same pattern as Bowman
    /\s*\/\d+\s*/g,
    // "Auto" and "Autograph" as trailing section labels
    /\s+Autographs?\s*$/i,
    /\s+Auto\s*$/i,
  ],

  insertSetNames: [
    // Panini checklists commonly use these as section labels rather than variants.
    // Expand as we see real Panini imports.
    /\bBase\s+Set\b/gi,
    /\bRookie\s+Card\s+Autographs?\b/gi,
  ],

  variantSynonyms: {
    // Panini uses "Silver" for what some hobby refers to as "Prizm Silver" / Base.
    // Conservative default — will revise as real data arrives.
  },

  // Panini doesn't reliably use XLSX card-code-as-player like Bowman does,
  // but when we see it the pattern is similar.
  cardCodePattern: /^([A-Z]+-[A-Z0-9]+)$/,

  autoPrefixes: /^(RPA|RA|PA|AU)-/i,

  multiPlayerIndicator: /\//,

  claudeRules: `Panini/Donruss matching rules:
- Prizm parallels: "Silver", "Blue Ice", "Red Wave", "Gold Prizm" — all real CH variants.
- Donruss Optic parallels: "Holo", "Pulsar", "Checkerboard" — all real CH variants.
- Print runs (/25, /75, /99) appear in source but not in CH variant names — ignore.
- Rookie status is year-specific; 1st Bowman Chrome is different from a Panini rookie.
- Year must match exactly.`,
};
