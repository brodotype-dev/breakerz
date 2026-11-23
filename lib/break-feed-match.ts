// Break-title → product matching for the admin break feed.
//
// Source titles are breaker-written marketing copy, not catalog names:
//
//   "2026 Topps Chrome Football Jumbo Hobby 4-Box (HALF CASE) PYT Group Break #3 - Steve"
//   "2025-26 Topps Cosmic Chrome Basketball Hobby Box Random Division Group Break #44"
//   "GILDED BASEBALL RELEASE DAY w/ EAST WEST!"
//
// We want to know which of OUR active products a title refers to, and — just
// as important — when it refers to a product we do not carry. An unmatched
// row is the signal: it means the market is breaking something we cannot
// price. So a false positive is worse than a miss here. A miss shows up as a
// coverage gap to review; a false positive silently tells us we have coverage
// we don't have.
//
// The rule is deliberately strict and deliberately NOT an LLM call:
//
//   1. Every core token of the product name must appear in the title.
//   2. No "intruder" token may sit inside the span those tokens occupy.
//
// Rule 2 is what stops "2026 Topps Chrome Baseball" from claiming
// "2026 Topps COSMIC Chrome Baseball" — a one-word difference that is a
// completely different product at a completely different price point. The
// intruder check generalises, so it also rejects Stadium Club, Five Star,
// Museum, Inception, Gilded and every other line we have never onboarded,
// without us maintaining a vocabulary of them.
//
// Known naming divergences between our catalog and retail copy live in
// TITLE_ALIASES, as explicit, greppable exceptions.

export interface MatchableProduct {
  id: string;
  name: string;
  slug: string;
}

export type MatchConfidence = 'exact' | 'alias' | 'none';

export interface BreakMatch {
  productId: string | null;
  productName: string | null;
  confidence: MatchConfidence;
  /** Human-readable why, rendered in the admin table for unmatched rows. */
  reason: string;
}

/**
 * Tokens that may sit inside a matched span without disqualifying it.
 * Keep this list tiny — every addition is a chance for a false positive.
 */
const SPAN_FILLER = new Set(['edition', 'the', 'and', 'card', 'cards', 'collection']);

/**
 * Words dropped from a product name before matching. These carry no
 * discriminating power: every product is "cards" from some "box".
 */
const NAME_NOISE = new Set(['edition', 'the', 'and', 'cards', 'card']);

/**
 * Explicit aliases for products whose retail name differs from ours.
 * Keyed by product slug; each entry is a set of core tokens to try in
 * addition to the ones derived from `products.name`.
 *
 * `2026 Bowman Sapphire Baseball` is our name for what Topps and every
 * retailer calls "Bowman Chrome Baseball Sapphire Edition" — the extra
 * "chrome" would otherwise trip the intruder check.
 */
const TITLE_ALIASES: Record<string, string[][]> = {
  '2026-bowman-sapphire-baseball': [['bowman', 'chrome', 'baseball', 'sapphire']],
  '2026-bowman-basketball-sapphire': [['bowman', 'chrome', 'basketball', 'sapphire']],
  'o-pee-chee-platinum-hockey': [
    ['o', 'pee', 'chee', 'platinum', 'hockey'],
    ['opc', 'platinum', 'hockey'],
  ],
};

/** Lowercase, strip trademark marks, collapse punctuation to spaces. */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[®™©]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A season token is a 4-digit year, optionally with a 2-digit continuation
 * ("2025 26" after normalization). Returns the canonical form "2025-26" or
 * "2026" so a product's season can be compared to a title's.
 */
export function extractSeasons(normalized: string): string[] {
  const out: string[] = [];
  const re = /\b(20\d{2})(?:\s+(\d{2}))\b|\b(20\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    if (m[1] && m[2]) {
      // "2025 26" — only a season if the second half follows the first.
      const start = Number(m[1]);
      const end = Number(m[2]);
      if ((start + 1) % 100 === end) {
        out.push(`${m[1]}-${m[2]}`);
        continue;
      }
      out.push(m[1]);
      continue;
    }
    if (m[3]) out.push(m[3]);
  }
  return [...new Set(out)];
}

function isSeasonToken(token: string, next: string | undefined): boolean {
  if (/^20\d{2}$/.test(token)) return true;
  // the trailing half of "2025 26"
  if (/^\d{2}$/.test(token)) return true;
  void next;
  return false;
}

/**
 * The discriminating words of a product name: everything that is not a
 * season and not noise. "2025-26 Topps Cosmic Chrome® Basketball" →
 * [topps, cosmic, chrome, basketball].
 */
export function coreTokens(productName: string): string[] {
  const tokens = normalizeTitle(productName).split(' ').filter(Boolean);
  return tokens.filter((t, i) => !isSeasonToken(t, tokens[i + 1]) && !NAME_NOISE.has(t));
}

interface SpanCheck {
  ok: boolean;
  intruder?: string;
  missing?: string;
}

/**
 * Does `core` appear in `titleTokens` with nothing foreign wedged inside the
 * span it occupies? Order-insensitive (retail copy reorders freely —
 * "Baseball Sapphire Edition" vs "Sapphire Baseball"), but gap-sensitive.
 */
function checkSpan(titleTokens: string[], core: string[]): SpanCheck {
  const positions: number[] = [];
  const coreSet = new Set(core);

  for (const token of core) {
    const at = titleTokens.indexOf(token);
    if (at === -1) return { ok: false, missing: token };
    positions.push(at);
  }

  const lo = Math.min(...positions);
  const hi = Math.max(...positions);

  for (let i = lo; i <= hi; i++) {
    const token = titleTokens[i];
    if (coreSet.has(token)) continue;
    if (SPAN_FILLER.has(token)) continue;
    if (isSeasonToken(token, titleTokens[i + 1])) continue;
    return { ok: false, intruder: token };
  }

  return { ok: true };
}

/**
 * Match one break/show title against our active products.
 *
 * Season is checked when BOTH sides state one: a title that names no year
 * ("GILDED BASEBALL RELEASE DAY") can still match on tokens alone, because
 * breakers routinely drop the year on a current release. A title that names
 * a DIFFERENT year than the product is rejected — that is the 2025-vs-2026
 * Chrome Football case, and treating it as a match would hide exactly the
 * staleness we built this to see.
 */
export function matchBreakTitle(title: string, products: MatchableProduct[]): BreakMatch {
  const normalized = normalizeTitle(title);
  const titleTokens = normalized.split(' ').filter(Boolean);
  const titleSeasons = new Set(extractSeasons(normalized));

  const rejections: string[] = [];

  for (const product of products) {
    const productSeasons = extractSeasons(normalizeTitle(product.name));
    const seasonOk =
      titleSeasons.size === 0 ||
      productSeasons.length === 0 ||
      productSeasons.some(s => titleSeasons.has(s));

    const candidates: Array<{ core: string[]; confidence: MatchConfidence }> = [
      { core: coreTokens(product.name), confidence: 'exact' },
      ...(TITLE_ALIASES[product.slug] ?? []).map(core => ({
        core,
        confidence: 'alias' as MatchConfidence,
      })),
    ];

    for (const { core, confidence } of candidates) {
      if (core.length === 0) continue;
      const span = checkSpan(titleTokens, core);
      if (!span.ok) continue;

      if (!seasonOk) {
        rejections.push(
          `${product.name}: tokens match but season differs (title ${[...titleSeasons].join('/')})`
        );
        continue;
      }

      return {
        productId: product.id,
        productName: product.name,
        confidence,
        reason: confidence === 'alias' ? 'matched via alias' : 'matched on product name',
      };
    }
  }

  return {
    productId: null,
    productName: null,
    confidence: 'none',
    reason: rejections.length > 0 ? rejections[0] : 'no product in our catalog matches this title',
  };
}

/**
 * Words that mark the end of the product name and the start of break
 * configuration copy. "2026 Topps Chrome Football Jumbo Hobby Box Random
 * Division Group Break #5 - Steve" is one product described six ways; for
 * ranking a coverage gap we only want the product.
 */
const CONFIG_BOUNDARY = new Set([
  'hobby', 'jumbo', 'box', 'boxes', 'case', 'half', 'pyt', 'random', 'mixer',
  'group', 'break', 'blaster', 'cello', 'tin', 'pack', 'fotl', 'retail',
  'mega', 'live', 'presale', 'w', 'with', 'release', 'day', 'two', 'one',
]);

/**
 * Collapse a break title to the product it is selling, for grouping the
 * coverage gap. Returns a display-cased phrase, or null if the title has no
 * product-shaped prefix (plenty of live-show titles are pure hype:
 * "$20K CASE HIT CHASE W/ SEAN").
 */
export function productPhrase(title: string): string | null {
  const tokens = normalizeTitle(title).split(' ').filter(Boolean);
  const kept: string[] = [];

  for (let i = 0; i < tokens.length && kept.length < 6; i++) {
    const token = tokens[i];
    if (CONFIG_BOUNDARY.has(token)) break;
    // A standalone number that is not a year is a break number, not a product.
    if (/^\d+$/.test(token) && !/^20\d{2}$/.test(token) && !isSeasonToken(token, undefined)) break;
    kept.push(token);
  }

  // A bare season, or nothing, is not a product name.
  const meaningful = kept.filter(t => !isSeasonToken(t, undefined));
  if (meaningful.length === 0) return null;

  return kept
    .map(t => (/^\d/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(' ');
}
