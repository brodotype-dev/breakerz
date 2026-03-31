import type { ManufacturerKnowledge } from './types';
import { BowmanKnowledge } from './bowman';
import { DefaultKnowledge } from './default';

/**
 * Registry of all manufacturer knowledge modules.
 *
 * Order matters — first match wins. Put more specific modules before broader ones.
 * (e.g. if a "Bowman Chrome" module ever splits from "Bowman", it goes before BowmanKnowledge.)
 *
 * To add a new manufacturer:
 *   1. Create lib/card-knowledge/panini.ts (copy default.ts as a starting point)
 *   2. Import it here and add an instance to the array
 *   3. Document its rules in docs/manufacturer-rules/
 */
const registry: ManufacturerKnowledge[] = [
  new BowmanKnowledge(),
  // new PaniniKnowledge(),   ← add here when Panini products are imported
  // new UpperDeckKnowledge(), ← etc.
];

const defaultKnowledge = new DefaultKnowledge();

/**
 * Returns the manufacturer knowledge module for a given product name.
 * Falls back to DefaultKnowledge (no-op) if no module matches.
 *
 * @example
 * const knowledge = getManufacturerKnowledge('2025 Bowman Draft Baseball');
 * // → BowmanKnowledge instance
 *
 * const knowledge = getManufacturerKnowledge('2025 Panini Prizm Basketball');
 * // → DefaultKnowledge instance (until PaniniKnowledge is added)
 */
export function getManufacturerKnowledge(productName: string): ManufacturerKnowledge {
  const lower = productName.toLowerCase();
  return registry.find(m => m.matches(lower)) ?? defaultKnowledge;
}

// Re-export the type so callers only need one import path
export type { ManufacturerKnowledge } from './types';
