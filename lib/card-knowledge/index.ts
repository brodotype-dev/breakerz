import type { ManufacturerDescriptor } from './types';
import { bowmanDescriptor } from './bowman';
import { paniniDescriptor } from './panini';
import { toppsFinestDescriptor } from './topps-finest';
import { defaultDescriptor } from './default';

/**
 * Registry of manufacturer descriptors, checked in order.
 *
 * To add a new manufacturer:
 *   1. Create lib/card-knowledge/<vendor>.ts with an exported descriptor const
 *   2. Import and add to the `registry` array below (order = priority)
 *   3. Document the rules in docs/manufacturer-rules/<vendor>.md
 *
 * Order matters: more specific patterns (e.g. "topps finest") must come before
 * broader ones ("topps|bowman"). First match wins.
 *
 * See docs/catalog-preload-architecture.md for the matching pipeline these feed.
 */
const registry: ManufacturerDescriptor[] = [
  toppsFinestDescriptor, // must win over bowmanDescriptor for Topps Finest products
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

export { bowmanDescriptor, paniniDescriptor, toppsFinestDescriptor, defaultDescriptor };
export type { ManufacturerDescriptor } from './types';
export * from './match';
