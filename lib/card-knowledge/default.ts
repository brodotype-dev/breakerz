import type { ManufacturerKnowledge, CleanVariantResult, QueryReformulation } from './types';

/**
 * Default (no-op) manufacturer knowledge — used when no module matches the product.
 *
 * All methods are identity transforms or empty returns. The pipeline calls these
 * safely without null checks — the Null Object pattern.
 *
 * Also serves as a reference implementation: to build a new manufacturer module,
 * copy this file and override only the methods that need manufacturer-specific logic.
 */
export class DefaultKnowledge implements ManufacturerKnowledge {
  readonly name = 'Default';

  matches(_productNameLower: string): boolean {
    // The default never self-selects — the registry falls back to it explicitly.
    return false;
  }

  cleanVariant(variantName: string): CleanVariantResult {
    return {
      cleanedVariant: variantName.trim(),
      isInsertSetName: false,
    };
  }

  reformulateQuery(_params: Parameters<ManufacturerKnowledge['reformulateQuery']>[0]): QueryReformulation {
    // No reformulation — use the default query construction in the route.
    return { query: null };
  }

  claudeContext(): string {
    // No manufacturer-specific context to inject.
    return '';
  }
}
