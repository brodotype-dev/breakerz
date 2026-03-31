/**
 * Manufacturer knowledge interface — the contract every skill module must implement.
 *
 * Each manufacturer (Bowman, Panini, Topps Finest, etc.) gets one module that
 * implements this interface. The matching pipeline calls these methods to clean
 * queries and inject domain context into the Claude matching prompt.
 */

export interface CleanVariantResult {
  /** The cleaned variant string to include in the CH search query. Empty = omit entirely. */
  cleanedVariant: string;
  /**
   * True when the entire variant_name was an insert set label (e.g. "Bowman Spotlights",
   * "Draft Lottery Ping Pong Ball Autographs") rather than a meaningful parallel descriptor.
   * Callers can use this to decide whether to omit the variant from the query.
   */
  isInsertSetName: boolean;
}

export interface QueryReformulation {
  /**
   * If non-null, use this as the full CH search query instead of the default construction.
   * Use this for structural cases like card-code player names where the normal
   * [player, year, set, number, variant] construction doesn't apply.
   */
  query: string | null;
  /** The player name to pass to cardMatch() for fallback retry. Overrides default. */
  effectivePlayerName?: string;
  /** The card number to pass to cardMatch() for fallback retry. Overrides default. */
  effectiveCardNumber?: string;
}

export interface ManufacturerKnowledge {
  /** Human-readable name — used in logs and error messages. */
  readonly name: string;

  /**
   * Returns true if this module handles the given product.
   * Called with the product name lowercased (e.g. "2025 bowman draft baseball").
   * The registry calls this on each module in order; first match wins.
   */
  matches(productNameLower: string): boolean;

  /**
   * Clean a raw variant_name string from the XLSX/CSV import.
   * Strips manufacturer-specific terms that CardHedger doesn't use,
   * insert set names stored as variants, and other XLSX noise.
   */
  cleanVariant(variantName: string): CleanVariantResult;

  /**
   * Optionally override the full CH search query for this variant.
   * Called after cleanVariant() — receives the already-cleaned variant.
   * Return { query: null } to use the default query construction.
   */
  reformulateQuery(params: {
    playerName: string;
    year: string;
    shortSetName: string;
    cardNumber?: string | null;
    cleanedVariant: string;
    isInsertSetName: boolean;
  }): QueryReformulation;

  /**
   * Manufacturer-specific context injected into the Claude Haiku matching prompt.
   * Teaches Claude terminology differences between XLSX source data and CH's catalog
   * (e.g. "Retrofractor in source = Base in CardHedger").
   *
   * Keep under ~400 characters — prompt clarity matters more than exhaustiveness.
   * Return an empty string if this module has no useful context to add.
   */
  claudeContext(): string;
}
