import type { ManufacturerDescriptor } from './types';

/**
 * Default descriptor — used when no manufacturer-specific descriptor matches.
 * Identity-transform on variant cleaning; no synonyms; no card-code handling.
 * The matcher still runs the full tier ladder against this descriptor.
 */
export const defaultDescriptor: ManufacturerDescriptor = {
  id: 'default',
  name: 'Default',
  matches: /.*/, // never self-selects via the registry — explicit fallback only
  stripPatterns: [
    // Print runs are universal — strip them regardless of manufacturer.
    /\s*\/\d+\s*/g,
  ],
  insertSetNames: [],
  variantSynonyms: {},
};
