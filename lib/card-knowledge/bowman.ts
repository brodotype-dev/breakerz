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

  // Card-code pattern: player names that are actually card numbers stored by the XLSX parser.
  // Covers two formats:
  //   - Alphanumeric-prefixed codes: "BDC-170", "CPA-KC", "TP-8", "B25-SS", "B25-NK",
  //     "BMA-JG", "BSA-JS", "FDA-GG", "QA-ADGS", etc.
  //     Prefix must START with a letter ([A-Z]) but can contain digits (e.g. "B25").
  //   - Pure numeric codes: "22", "67" (Base Teams inserts in Bowman's Best)
  private static readonly CARD_CODE_RE = /^([A-Z][A-Z0-9]*-[A-Z0-9]+|\d+)$/;

  // Autograph card code prefixes — per CardHedger: always append "Autograph" to the query.
  // Dash format (CPA-JH) required; "CPA JH" degrades search accuracy significantly.
  // BMA = Bowman Mega Box Auto, CPA = Chrome Prospect Auto, BPA = Bowman Prospect Auto,
  // FDA = Father-Day Auto, BSA/BRA/CRA = various Chrome/rookie autos,
  // QA/DA/TA = quad/dual/triple autos
  private static readonly AUTO_CODE_RE = /^(BMA|CPA|BPA|FDA|BSA|BRA|CRA|QA|DA|TA)-/i;

  // Insert set names that Bowman/Topps XLSX stores in the variant_name field.
  // These are not parallel/variant descriptors — they're subsection labels.
  // Bowman Draft patterns:
  //   "2025 Draft Lottery Ping Pong Ball", "Bowman Spotlights", "Bowman In Action Autographs",
  //   "Chrome Team Sets", "Base Set Team Sets"
  // Bowman's Best patterns:
  //   "Top Prospects", "Stars of the Game", "Base Teams", "Best Of 2025 [Autographs]"
  private static readonly INSERT_SET_NAMES = [
    /\d{4}\s+Draft\s+Lottery\s+Ping\s+Pong\s+Ball\b/gi,
    /\bBowman\s+Spotlights?\b/gi,
    /\bBowman\s+In\s+Action\s+Autographs?\b/gi,
    /\bChrome\s+Team\s+Sets?\b/gi,
    /\bBase\s+Set\s+Team\s+Sets?\b/gi,
    /\bTop\s+Prospects?\b/gi,
    /\bStars?\s+of\s+the\s+Game\b/gi,
    /\bBase\s+Teams?\b/gi,
    /\bBest\s+Of\s+\d{4}\b/gi,
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

    // Strip standalone "Autographs" / "Autograph" and "Superfractor" — what remains
    // after insert set name stripping. Both are used as section labels in Bowman XLSX
    // (e.g. "Best Of 2025 Autographs", "BMA Superfractor"), not CH variant descriptors.
    // CH uses specific parallel names (Base, Refractor, Gold Ink, etc.) instead.
    cleaned = cleaned.replace(/\bAutographs?\b/gi, '');
    cleaned = cleaned.replace(/\bSuperfractor\b/gi, '');

    return {
      cleanedVariant: cleaned.trim(),
      isInsertSetName,
    };
  }

  reformulateQuery(params: Parameters<ManufacturerKnowledge['reformulateQuery']>[0]): QueryReformulation {
    const { playerName, year, shortSetName, cardNumber } = params;

    // Card-code player name: the XLSX parser stored the card number as the player name.
    // CH indexes these by card number with the player name attached — query by code only.
    // e.g. "2025 Bowman Draft BDC-170" → CH returns "James Tibbs III · 2025 Bowman Draft Chrome"
    // For autograph prefixes (CPA/BMA/BPA/FDA etc.), append "Autograph" — confirmed by CH:
    // without it, base BCP cards outrank the autograph in search results.
    if (BowmanKnowledge.CARD_CODE_RE.test(playerName)) {
      const isAuto = BowmanKnowledge.AUTO_CODE_RE.test(playerName);
      return {
        query: [year, shortSetName, playerName, isAuto ? 'Autograph' : undefined].filter(Boolean).join(' '),
        effectivePlayerName: undefined,
        effectiveCardNumber: playerName,
      };
    }

    // Multi-player card: XLSX stores slash-delimited names (e.g. "Dylan Crews/James Wood").
    // CH can't match multi-player queries reliably — search by card code + set only.
    // The card code uniquely identifies the multi-player card in CH's catalog.
    if (playerName.includes('/') && cardNumber) {
      return {
        query: [year, shortSetName, cardNumber].filter(Boolean).join(' '),
        effectivePlayerName: undefined,
        effectiveCardNumber: cardNumber,
      };
    }

    // No reformulation needed for normal single-player cards — use default construction.
    return { query: null };
  }

  claudeContext(): string {
    // This string is injected into the Claude Haiku matching prompt.
    // It teaches Claude the terminology gaps between Bowman XLSX data and CH's catalog.
    // Keep it concise — Claude reads this before reasoning about the candidates.
    return `Bowman/Topps-specific matching rules:
- Year must match exactly. If the query says 2025, reject any candidate from 2022, 2023, or 2024 even if the player name and set name are similar.
- Card numbers uniquely identify a player in a given set (both letter-prefixed codes like BDC-91, B25-SS, BMA-JG, TP-8 AND short numbers like 38, 1, 69). If a candidate's number field matches a number in the query AND the player name and set match, that IS the correct card. Assign confidence 0.9 or higher even if the variant differs — the exact parallel is not always known.
- Accented characters in the query match unaccented names in CardHedger: "Jesús" = "Jesus", "Rodríguez" = "Rodriguez", "José" = "Jose", "Agustín" = "Agustin". Do not reject a match because of accent differences.
- "Retrofractor" in the query = "Base" or "Lazer Refractor" in CardHedger. "Black" in the query = "Base" in CardHedger. Do not reject a match because the candidate says "Base" when the query says "Retrofractor" or "Black".
- Print runs (/50, /99, /25) appear in source data but NOT in CardHedger variant names — ignore them when comparing.
- Insert set names (Top Prospects, Stars of the Game, Best Of 2025, Bowman Spotlights, Draft Lottery Ping Pong Ball) and section labels ("Autographs", "Teams") may appear in the query but are not variant descriptors — focus on player, set, and card number.
- Parallel names appear without "Variation" suffix in CardHedger.
- CPA/BMA/BPA/FDA/BSA/BRA autograph cards live in the PARENT set in CH's catalog (e.g. "2024 Bowman Chrome Prospects Baseball"), NOT in a separate "Autographs" set. The card's autograph status is determined by its number prefix.
- NOTE (2026+): Bowman Chrome Prospects will merge into the parent Bowman Chrome set. Match accordingly for 2026 products.`;
  }
}
