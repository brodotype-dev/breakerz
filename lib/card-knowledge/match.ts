import type { ManufacturerDescriptor } from './types';
import type { CatalogCard, CatalogIndex } from '../cardhedger-catalog';
import { pickCanonicalVariant } from '../cardhedger-catalog';

/**
 * Tiered local matcher — the core of catalog-preload matching.
 *
 * Given a descriptor, a pre-loaded CatalogIndex, and a single variant row,
 * returns a match + confidence + tier name for telemetry. Falls through to
 * null when no tier can resolve — the caller can then invoke the Claude
 * fallback with in-set candidates.
 *
 * See docs/catalog-preload-architecture.md for the tier semantics.
 */

export type MatchTier =
  | 'exact-variant'   // Tier 1 — (number, variant) hit in catalog
  | 'synonym'         // Tier 2 — (number, synonym(variant)) hit
  | 'number-only'     // Tier 3 — number match, best-variant fallback (Base > Refractor > first)
  | 'card-code'       // Tier 4 — player_name IS the card code, exact number hit
  | 'claude'          // Tier 5 — populated by the caller on Claude fallback
  | 'no-match';       // Tier 6 — nothing worked

export interface VariantInput {
  playerName: string;
  variantName: string;
  cardNumber?: string | null;
}

export interface LocalMatch {
  cardId: string;
  confidence: number;
  tier: MatchTier;
  topResult: {
    player_name: string;
    set_name: string;
    variant: string;
    year: string;
    number: string;
  };
}

// ── Variant normalization ─────────────────────────────────────────────────────

function cleanVariant(descriptor: ManufacturerDescriptor, raw: string): {
  cleaned: string;
  isInsertSetName: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { cleaned: '', isInsertSetName: false };

  // Check insert-set-name match before stripping — we need the original to decide.
  const isInsertSetName = descriptor.insertSetNames.some(re => {
    re.lastIndex = 0;
    return re.test(trimmed);
  });

  let cleaned = trimmed;
  for (const pattern of descriptor.stripPatterns) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '');
  }
  // Also strip any insert-set-name fragments if they appear mid-string.
  for (const pattern of descriptor.insertSetNames) {
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '');
  }

  return { cleaned: cleaned.trim(), isInsertSetName };
}

// ── Tier runners ──────────────────────────────────────────────────────────────

function variantMatches(chVariant: string, wanted: string): boolean {
  return chVariant.trim().toLowerCase() === wanted.trim().toLowerCase();
}

function toTopResult(card: CatalogCard, setName: string) {
  return {
    player_name: card.player_name,
    set_name: setName,
    variant: card.variant,
    year: card.year,
    number: card.number,
  };
}

function tierExactVariant(
  index: CatalogIndex,
  number: string,
  cleaned: string,
): LocalMatch | null {
  if (!cleaned) return null;
  const hit = index.byNumberVariant.get(`${number}::${cleaned.toLowerCase()}`);
  if (!hit) return null;
  return {
    cardId: hit.card_id,
    confidence: 0.98,
    tier: 'exact-variant',
    topResult: toTopResult(hit, index.setName),
  };
}

function tierSynonym(
  descriptor: ManufacturerDescriptor,
  index: CatalogIndex,
  number: string,
  cleaned: string,
): LocalMatch | null {
  if (!cleaned) return null;
  const synonyms = findSynonyms(descriptor, cleaned);
  for (const candidate of synonyms) {
    const hit = index.byNumberVariant.get(`${number}::${candidate.toLowerCase()}`);
    if (hit) {
      return {
        cardId: hit.card_id,
        confidence: 0.92,
        tier: 'synonym',
        topResult: toTopResult(hit, index.setName),
      };
    }
  }
  return null;
}

function findSynonyms(descriptor: ManufacturerDescriptor, cleaned: string): string[] {
  const key = Object.keys(descriptor.variantSynonyms).find(
    k => k.toLowerCase() === cleaned.toLowerCase(),
  );
  return key ? descriptor.variantSynonyms[key] : [];
}

function tierNumberOnly(index: CatalogIndex, number: string): LocalMatch | null {
  const bucket = index.byNumber.get(number);
  if (!bucket || bucket.length === 0) return null;
  const picked = pickCanonicalVariant(bucket);
  if (!picked) return null;
  return {
    cardId: picked.card_id,
    confidence: 0.85,
    tier: 'number-only',
    topResult: toTopResult(picked, index.setName),
  };
}

function tierCardCode(
  descriptor: ManufacturerDescriptor,
  index: CatalogIndex,
  playerName: string,
  cleaned: string,
): LocalMatch | null {
  if (!descriptor.cardCodePattern || !descriptor.cardCodePattern.test(playerName)) return null;
  const bucket = index.byNumber.get(playerName);
  if (!bucket || bucket.length === 0) return null;

  // If we can resolve to a specific variant via the cleaned string, prefer that.
  // Otherwise fall back to the canonical pick (Base > Refractor > first).
  const exact = cleaned
    ? bucket.find(c => variantMatches(c.variant, cleaned))
    : undefined;
  const synonymMatch = !exact && cleaned
    ? findSynonyms(descriptor, cleaned)
        .flatMap(syn => bucket.filter(c => variantMatches(c.variant, syn)))[0]
    : undefined;
  const picked = exact ?? synonymMatch ?? pickCanonicalVariant(bucket);
  if (!picked) return null;

  return {
    cardId: picked.card_id,
    confidence: 0.86,
    tier: 'card-code',
    topResult: toTopResult(picked, index.setName),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TryMatchResult {
  match: LocalMatch | null;
  cleaned: string;
  isInsertSetName: boolean;
  isMultiPlayer: boolean;
}

/**
 * Run the local tier ladder against a single variant.
 *
 * Does NOT run the Claude fallback — the caller is responsible for calling
 * claudeMatchWithCatalog() when this returns a null match and the row isn't
 * an insert-set-name.
 */
export function tryLocalMatch(
  descriptor: ManufacturerDescriptor,
  index: CatalogIndex,
  input: VariantInput,
): TryMatchResult {
  const { cleaned, isInsertSetName } = cleanVariant(descriptor, input.variantName ?? '');
  const isMultiPlayer = descriptor.multiPlayerIndicator
    ? descriptor.multiPlayerIndicator.test(input.playerName)
    : false;

  // Card-code-as-player is a distinct row shape — handled first because
  // playerName isn't a real name in these rows.
  const codeMatch = tierCardCode(descriptor, index, input.playerName, cleaned);
  if (codeMatch) return { match: codeMatch, cleaned, isInsertSetName, isMultiPlayer };

  // Normal rows — need a card number to look up in the catalog.
  const number = input.cardNumber ?? '';
  if (!number) {
    return { match: null, cleaned, isInsertSetName, isMultiPlayer };
  }

  const exact = tierExactVariant(index, number, cleaned);
  if (exact) return { match: exact, cleaned, isInsertSetName, isMultiPlayer };

  const synonym = tierSynonym(descriptor, index, number, cleaned);
  if (synonym) return { match: synonym, cleaned, isInsertSetName, isMultiPlayer };

  const numberOnly = tierNumberOnly(index, number);
  if (numberOnly) return { match: numberOnly, cleaned, isInsertSetName, isMultiPlayer };

  return { match: null, cleaned, isInsertSetName, isMultiPlayer };
}

/**
 * Returns the candidates we'd feed to Claude as the fallback.
 * Only includes in-set rows that share the variant's card number — no fuzzy fallback.
 * When there's no card number, returns the top N candidates by player-name match.
 */
export function candidatesForClaude(
  index: CatalogIndex,
  input: VariantInput,
  maxCandidates = 10,
): CatalogCard[] {
  const number = input.cardNumber ?? '';
  if (number && index.byNumber.has(number)) {
    return index.byNumber.get(number)!.slice(0, maxCandidates);
  }

  // No number match — narrow by first-name prefix (accent-folded) on player_name.
  const qFirst = input.playerName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)[0];
  if (!qFirst || qFirst.length < 2) return index.cards.slice(0, maxCandidates);

  const filtered = index.cards.filter(c => {
    const cFirst = c.player_name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)[0];
    return cFirst === qFirst;
  });
  return (filtered.length > 0 ? filtered : index.cards).slice(0, maxCandidates);
}
