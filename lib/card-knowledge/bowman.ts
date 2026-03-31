import type { ManufacturerKnowledge, CleanVariantResult, QueryReformulation } from './types';

/**
 * Manufacturer knowledge for Bowman and Topps baseball products.
 *
 * Covers: Bowman Draft, Bowman Draft Chrome, Bowman Chrome, Topps Chrome,
 * and any other product whose name contains "bowman" or "topps".
 *
 * Source of truth: docs/manufacturer-rules/bowman.md
 */
export class BowmanKnowledge implements ManufacturerKnowledge {
  readonly name = 'Bowman';

  // Card-code pattern: player names like "BDC-170", "CPA-KC", "AA-FA" are Team Sets
  // inserts where the XLSX parser stored the card number as the player name.
  // All known Bowman card code formats match this: letters, dash, letters+digits, no spaces.
  private static readonly CARD_CODE_RE = /^[A-Z]+-[A-Z0-9]+$/;

  // Insert set names that Bowman XLSX stores in the variant_name field.
  // These are not parallel/variant descriptors — they're subsection labels.
  private static readonly INSERT_SET_NAMES = [
    /\d{4}\s+Draft\s+Lottery\s+Ping\s+Pong\s+Ball\b/gi,
    /\bBowman\s+Spotlights?\b/gi,
    /\bBowman\s+In\s+Action\s+Autographs?\b/gi,
    /\bChrome\s+Team\s+Sets?\b/gi,
    /\bBase\s+Set\s+Team\s+Sets?\b/gi,
  ];

  matches(productNameLower: string): boolean {
    return productNameLower.includes('bowman') || productNameLower.includes('topps');
  }

  cleanVariant(variantName: string): CleanVariantResult {
    let cleaned = variantName;

    // Check first if the whole variant is an insert set name.
    // We test before stripping so we can set the flag accurately.
    const isInsertSetName = BowmanKnowledge.INSERT_SET_NAMES.some(re => {
      re.lastIndex = 0; // reset stateful global regexes before each test
      return re.test(variantName.trim());
    });

    // Strip "Base - " prefix — Bowman wraps parallels as "Base - Gold Refractor Variation"
    cleaned = cleaned.replace(/^Base\s*[-–]\s*/i, '');

    // Strip trailing " Variation" — CH doesn't use this suffix
    cleaned = cleaned.replace(/\s+Variation\s*$/i, '');

    // Strip "Retrofractor" — Bowman-specific term; CH calls these "Base" or "Lazer Refractor"
    cleaned = cleaned.replace(/\bRetrofractor\b/gi, '');

    // Strip print runs — "/50", "/99", "/25" etc appear in XLSX but not in CH variant names
    cleaned = cleaned.replace(/\s*\/\d+\s*/g, '');

    // Strip all known insert set name patterns
    for (const re of BowmanKnowledge.INSERT_SET_NAMES) {
      re.lastIndex = 0;
      cleaned = cleaned.replace(re, '');
    }

    return {
      cleanedVariant: cleaned.trim(),
      isInsertSetName,
    };
  }

  reformulateQuery(params: Parameters<ManufacturerKnowledge['reformulateQuery']>[0]): QueryReformulation {
    const { playerName, year, shortSetName } = params;

    // Card-code player name: the XLSX parser stored the card number as the player name.
    // CH indexes these by card number with the player name attached — query by code only.
    // e.g. "2025 Bowman Draft BDC-170" → CH returns "James Tibbs III · 2025 Bowman Draft Chrome"
    if (BowmanKnowledge.CARD_CODE_RE.test(playerName)) {
      return {
        query: [year, shortSetName, playerName].filter(Boolean).join(' '),
        // Pass the code as cardNumber for the fallback retry inside cardMatch().
        // Pass undefined as playerName so the fallback doesn't use the code as a name.
        effectivePlayerName: undefined,
        effectiveCardNumber: playerName,
      };
    }

    // No reformulation needed for normal cards — use default construction.
    return { query: null };
  }

  claudeContext(): string {
    // This string is injected into the Claude Haiku matching prompt.
    // It teaches Claude the terminology gaps between Bowman XLSX data and CH's catalog.
    // Keep it concise — Claude reads this before reasoning about the candidates.
    return `Bowman-specific matching rules:
- Card codes (BDC-91, CPA-KK, AA-FA, etc.) uniquely identify one player per set. If CardHedger returns a result for a card code query, that IS the correct player — match with high confidence.
- "Retrofractor" in the query = "Base" or "Lazer Refractor" in CardHedger. Do not reject a match because the candidate says "Base" when the query says "Retrofractor".
- Print runs (/50, /99, /25) appear in source data but NOT in CardHedger variant names — ignore them when comparing.
- Insert set names (Bowman Spotlights, Draft Lottery Ping Pong Ball) may appear in the query but are not variant descriptors — focus on player, set, and card number.
- Parallel names appear without "Variation" suffix in CardHedger.`;
  }
}
