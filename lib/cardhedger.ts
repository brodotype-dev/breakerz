// CardHedger API client — server-side only, never expose the key to the browser

const BASE_URL = 'https://api.cardhedger.com';
const API_KEY = process.env.CARDHEDGER_API_KEY!;

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(body),
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CardHedger ${path} failed: ${res.status} — ${text}`);
  }

  return res.json();
}

// Search response card shape from the API
interface CardHedgerSearchCard {
  card_id: string;
  player_name: string;
  set_name: string;
  number: string;
  variant: string;
  category: string;
  rookie: boolean;
  year: string;
  prices: Array<{ grade: string; price: string }>; // prices come back as strings
}

interface SearchResponse {
  count: number;
  pages: number;
  cards: CardHedgerSearchCard[];
}

// Search for cards — returns card IDs + top grade prices in one call
export async function searchCards(query: string, sport?: string) {
  return post<SearchResponse>('/v1/cards/card-search', { search: query, sport });
}

// Look up a graded card by cert number (PSA, BGS, SGC, etc.)
// Returns full card identity + chronological price history for that specific cert
export async function pricesByCert(cert: string) {
  return post<{
    cert_info: {
      grader: string;
      cert: string;
      grade: string;
      description: string;
      cert_details_cached?: string;
    };
    card: {
      card_id: string;
      description: string;
      player: string;
      set: string;
      number: string;
      variant: string;
      image: string;
      category: string;
    };
    prices: Array<{ closing_date: string; Grade: string; card_id: string; price: string }>;
  }>('/v1/cards/prices-by-cert', { cert });
}

// Get all graded and raw prices for a card
export async function getAllPrices(cardId: string) {
  return post<{ prices: Array<{ grade: string; price: string }> }>(
    '/v1/cards/all-prices-by-card',
    { card_id: cardId }
  );
}

// Get recent comps for a card
// API requires count (number of results) and grade in addition to card_id and days
export async function getComps(cardId: string, days = 180, grade = 'Raw', count = 10) {
  return post<{ comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> }>(
    '/v1/cards/comps',
    { card_id: cardId, days, grade, count }
  );
}

// Get 90-day prices for a search — no card ID required
export async function get90DayPrices(search: string, grade?: string, sportParam?: string) {
  return post<{ prices: Array<{ grade: string; avg_price: number; min_price: number; max_price: number; sale_count: number }> }>(
    '/v1/cards/90day-prices-by-grade',
    { search, grade, sport: sportParam }
  );
}

// Get price history by day (for charts)
export async function getPricesByDay(cardId: string, days = 90) {
  return post<{ prices: Array<{ date: string; price: number; grade: string }> }>(
    '/v1/cards/prices-by-card',
    { card_id: cardId, days }
  );
}

// Batch price estimates — up to 100 card/grade combos per call
export async function batchPriceEstimate(
  items: Array<{ card_id: string; grade: string }>
): Promise<Array<{ card_id: string; price: number; price_low: number; price_high: number; confidence: number; success: boolean }>> {
  const result = await post<{
    results: Array<{
      card_id: string;
      price?: number;
      price_low?: number;
      price_high?: number;
      confidence?: number;
      error?: string;
    }>;
  }>('/v1/cards/batch-price-estimate', { items });

  return result.results.map(r => ({
    card_id: r.card_id,
    price: r.price ?? 0,
    price_low: r.price_low ?? 0,
    price_high: r.price_high ?? 0,
    confidence: r.confidence ?? 0,
    success: !r.error && (r.price ?? 0) > 0,
  }));
}

/**
 * Match a free-text query against the CardHedger card catalog using Claude.
 * Claude sees the top search results and reasons about which (if any) is the
 * correct match — handling abbreviations, synonym names, RC year validation, etc.
 *
 * Falls back to token-based scoring if the Claude call fails.
 *
 * @param query     - e.g. "Jacob Wilson Bowman Chrome 1 Refractor Auto"
 * @param sport     - optional sport filter: 'baseball' | 'basketball' | 'football'
 * @param playerName - used for fallback retry with minimal query (player + card number)
 * @param cardNumber - used for fallback retry
 */
export async function cardMatch(
  query: string,
  sport?: string,
  playerName?: string,
  cardNumber?: string,
): Promise<{ card_id: string | null; confidence: number; topResult?: { player_name: string; set_name: string; variant: string; year: string; number: string } }> {
  let result = await searchCards(query, sport);
  let cards = (result.cards ?? []).slice(0, 10);

  // Fallback: if no results, retry with player name + card number only
  if (cards.length === 0 && playerName && cardNumber) {
    const fallbackQuery = `${playerName} ${cardNumber}`;
    result = await searchCards(fallbackQuery, sport);
    cards = (result.cards ?? []).slice(0, 10);
  }

  if (cards.length === 0) return { card_id: null, confidence: 0 };

  const top = cards[0];
  const topResult = { player_name: top.player_name, set_name: top.set_name, variant: top.variant, year: top.year, number: top.number };

  // Try Claude semantic matching first.
  try {
    const match = await claudeCardMatch(query, cards);
    if (match) return { ...match, topResult };
  } catch (err) {
    console.warn('[cardMatch] Claude fallback to token matcher:', err instanceof Error ? err.message : err);
  }

  // Fallback: token-based scoring against the top result.
  return { ...tokenCardMatch(query, cards[0]), topResult };
}

/** Token-based scorer — original logic, used as fallback. */
function tokenCardMatch(
  query: string,
  card: CardHedgerSearchCard
): { card_id: string; confidence: number } {
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const candidate = `${card.player_name} ${card.set_name} ${card.year}`.toLowerCase();
  const matched = queryTokens.filter(t => candidate.includes(t)).length;
  const confidence = queryTokens.length > 0 ? matched / queryTokens.length : 0;
  return { card_id: card.card_id, confidence };
}

/** Claude semantic matcher — reasons about which result best matches the query. */
async function claudeCardMatch(
  query: string,
  cards: CardHedgerSearchCard[]
): Promise<{ card_id: string; confidence: number } | null> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const candidateList = cards
    .map((c, i) =>
      `${i + 1}. card_id="${c.card_id}" | player="${c.player_name}" | set="${c.set_name}" | year="${c.year}" | variant="${c.variant}" | number="${c.number}" | rookie=${c.rookie}`
    )
    .join('\n');

  const prompt = `You are matching a sports card query to a CardHedger catalog entry.

Query: "${query}"

Candidates:
${candidateList}

Which candidate (if any) is the correct match for this query?
Consider: player name variations, set name abbreviations, rookie card year alignment, variant synonyms (Auto = Autograph, RC = Rookie Card, etc.).

Respond with JSON only — no explanation:
- If a match exists: {"card_id": "<id>", "confidence": <0.7 to 1.0>}
- If no candidate is a good match: {"card_id": null, "confidence": 0}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  }, { timeout: 10_000 });

  const text = (message.content[0] as { type: string; text: string }).text.trim();
  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(json) as { card_id: string | null; confidence: number };

  if (!parsed.card_id) return null;
  return { card_id: parsed.card_id, confidence: parsed.confidence };
}

/**
 * Compute EV from a prices array (grade/price pairs).
 * Prices come back as strings from the API — parse them.
 *
 * EV Low  = Raw price
 * EV Mid  = PSA 9 (or best mid-grade available)
 * EV High = PSA 10
 */
function evFromPrices(prices: Array<{ grade: string; price: string | number }>): { evLow: number; evMid: number; evHigh: number } {
  const priceMap: Record<string, number> = {};
  for (const p of prices) {
    priceMap[p.grade.toLowerCase()] = parseFloat(String(p.price)) || 0;
  }

  const find = (...candidates: string[]) => {
    for (const c of candidates) {
      const match = Object.entries(priceMap).find(([k]) => k.includes(c.toLowerCase()));
      if (match && match[1] > 0) return match[1];
    }
    return null;
  };

  const rawPrice  = find('raw', 'ungraded');
  const midPrice  = find('psa 9', 'bgs 9', 'sgc 9') ?? find('psa 8', '8');
  const highPrice = find('psa 10', 'bgs 10', 'sgc 10', 'pristine');

  const evMid  = midPrice  ?? rawPrice  ?? 0;
  const evLow  = rawPrice  ?? Math.round(evMid * 0.35);
  const evHigh = highPrice ?? Math.round(evMid * 2.5);

  return {
    evLow:  Math.round(evLow),
    evMid:  Math.round(evMid),
    evHigh: Math.round(evHigh),
  };
}

/**
 * Search for a player card and compute EV in a single API call.
 * Returns the card_id alongside EV so the caller can persist it.
 */
export async function searchAndComputeEV(
  query: string
): Promise<{ cardId: string; evLow: number; evMid: number; evHigh: number } | null> {
  const result = await searchCards(query);
  const card = result.cards?.[0];
  if (!card) return null;

  const ev = evFromPrices(card.prices ?? []);
  return { cardId: card.card_id, ...ev };
}

/**
 * Compute EV for a known card ID using the full all-prices-by-card endpoint.
 * Also falls back to comps median if grade prices are sparse.
 * Use this for refreshes when we already have the card ID stored.
 */
export async function computeLiveEV(cardId: string): Promise<{ evLow: number; evMid: number; evHigh: number }> {
  const [pricesResult, compsResult] = await Promise.allSettled([
    getAllPrices(cardId),
    getComps(cardId, 90),
  ]);

  const prices = pricesResult.status === 'fulfilled' ? pricesResult.value.prices : [];
  const comps = compsResult.status === 'fulfilled' ? compsResult.value.comps : [];

  const priceMap: Record<string, number> = {};
  for (const p of prices) {
    priceMap[p.grade.toLowerCase()] = parseFloat(String(p.price)) || 0;
  }

  const findGrade = (...candidates: string[]) => {
    for (const c of candidates) {
      const match = Object.entries(priceMap).find(([k]) => k.includes(c.toLowerCase()));
      if (match && match[1] > 0) return match[1];
    }
    return null;
  };

  const rawPrice = findGrade('raw', 'ungraded') ?? null;
  const midPrice = findGrade('psa 9', 'bgs 9', 'sgc 9') ?? findGrade('psa 8', '8') ?? null;
  const highPrice = findGrade('psa 10', 'bgs 10', 'sgc 10', 'pristine') ?? null;

  const compPrices = comps.map(c => c.sale_price).filter(p => p > 0).sort((a, b) => a - b);
  const compMedian = compPrices.length > 0
    ? compPrices[Math.floor(compPrices.length / 2)]
    : null;

  const evMid  = midPrice  ?? compMedian ?? rawPrice ?? 0;
  const evLow  = rawPrice  ?? Math.round(evMid * 0.35);
  const evHigh = highPrice ?? Math.round(evMid * 2.5);

  return {
    evLow:  Math.round(evLow),
    evMid:  Math.round(evMid),
    evHigh: Math.round(evHigh),
  };
}
