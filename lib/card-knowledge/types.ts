/**
 * Manufacturer descriptor — data-only definition of how a manufacturer's checklist
 * data maps to CardHedger's catalog.
 *
 * Every rule that used to live as imperative TypeScript in BowmanKnowledge / PaniniKnowledge
 * now lives here as RegExp / string data. The generic matcher in ./match.ts consumes these
 * descriptors against the pre-loaded CatalogIndex.
 *
 * Why data, not classes:
 *   - Adding a manufacturer = one object literal, not a new file + registry edit.
 *   - Can be moved to DB (admin-editable) later with no API change.
 *   - Trivially diffable, reviewable, and testable.
 *
 * See docs/catalog-preload-architecture.md for the full pipeline.
 */

export interface ManufacturerDescriptor {
  /** Short id — 'bowman', 'panini', 'upper-deck', 'default'. */
  readonly id: string;

  /** Human-readable name for logs and match telemetry. */
  readonly name: string;

  /**
   * Product-name matcher. The registry calls these in order; first match wins.
   * Keep each descriptor's pattern narrow enough to avoid swallowing other lines.
   */
  readonly matches: RegExp;

  /**
   * Patterns stripped from variant_name before comparison against CH's variant.
   * Applied in order. Each pattern is .replace()'d to ''.
   * See bowman.ts for a working example.
   */
  readonly stripPatterns: RegExp[];

  /**
   * Patterns that, if they match the entire trimmed variant_name, mark this row as
   * an "insert set name" row — a section label the XLSX parser stored as the variant.
   * These rows skip variant matching (there's no meaningful CH variant for them).
   */
  readonly insertSetNames: RegExp[];

  /**
   * Variant synonyms: when our variant_name uses a manufacturer-specific term that
   * CH doesn't use, list the CH equivalents here. The matcher tries each in order.
   *
   * Example: { "Retrofractor": ["Base", "Lazer Refractor"], "Black": ["Base"] }
   * Keys are matched case-insensitively against the cleaned variant.
   */
  readonly variantSynonyms: Record<string, string[]>;

  /**
   * Regex matching card-code-as-player rows (XLSX parser artifact).
   * If a variant's player_name matches this, we treat player_name as a card number
   * and look it up directly in CatalogIndex.byNumber.
   *
   * Bowman: /^([A-Z][A-Z0-9]*-[A-Z0-9]+|\d+)$/
   */
  readonly cardCodePattern?: RegExp;

  /**
   * Autograph prefix detector for card-code queries. When a card code matches this,
   * CH search queries for this code should include "Autograph" to rank the auto above
   * the base card. Only used in the Tier 5 Claude-fallback path — local catalog lookup
   * already knows the variant.
   */
  readonly autoPrefixes?: RegExp;

  /**
   * Multi-player card detector (e.g. "Dylan Crews/James Wood" for dual-auto cards).
   * Rows matching this are matched by card_number alone — CH can't reliably match
   * slash-delimited player names.
   */
  readonly multiPlayerIndicator?: RegExp;

  /**
   * Manufacturer-specific context injected into the Claude Haiku prompt when the
   * local tiers miss and we need a semantic fallback. Keep under ~400 chars.
   * Only invoked for genuinely ambiguous variants — not the hot path.
   */
  readonly claudeRules?: string;
}
