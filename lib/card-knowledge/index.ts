import type { ManufacturerDescriptor } from './types';
import { bowmanDescriptor } from './bowman';
import { paniniDescriptor } from './panini';
import { defaultDescriptor } from './default';

/**
 * Registry of manufacturer descriptors, checked in order.
 *
 * To add a new manufacturer:
 *   1. Create lib/card-knowledge/<vendor>.ts with an exported descriptor const
 *   2. Import and add to the `registry` array below (order = priority)
 *   3. Document the rules in docs/manufacturer-rules/<vendor>.md
 *
 * See docs/catalog-preload-architecture.md for the matching pipeline these feed.
 */
const registry: ManufacturerDescriptor[] = [
  bowmanDescriptor,
  paniniDescriptor,
  // upperDeckDescriptor, // add here as products come online
];

/**
 * Returns the descriptor for the given product name. Falls back to a no-op
 * default descriptor if no specific match is found.
 */
export function getManufacturerDescriptor(productName: string): ManufacturerDescriptor {
  for (const d of registry) {
    if (d.matches.test(productName)) return d;
  }
  return defaultDescriptor;
}

export { bowmanDescriptor, paniniDescriptor, defaultDescriptor };
export type { ManufacturerDescriptor } from './types';
export * from './match';
