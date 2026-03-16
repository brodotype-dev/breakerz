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
  player: string;
  set: string;
  number: string;
  variant: string;
  category: string;
  rookie: boolean;
  prices: Array<{ grade: string; price: string }>; // prices come back as strings
}

interface SearchResponse {
  count: number;
  pages: number;
  cards: CardHedgerSearchCard[];
}

// Search for cards — returns card IDs + top grade prices in one call
export async function searchCards(query: string) {
  return post<SearchResponse>('/v1/cards/card-search', { search: query });
}

// Get all graded and raw prices for a card
export async function getAllPrices(cardId: string) {
  return post<{ prices: Array<{ grade: string; price: string }> }>(
    '/v1/cards/all-prices-by-card',
    { card_id: cardId }
  );
}

// Get recent comps for a card
export async function getComps(cardId: string, days = 90) {
  return post<{ comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> }>(
    '/v1/cards/comps',
    { card_id: cardId, days }
  );
}

// Get price history by day (for charts)
export async function getPricesByDay(cardId: string, days = 90) {
  return post<{ prices: Array<{ date: string; price: number; grade: string }> }>(
    '/v1/cards/prices-by-card',
    { card_id: cardId, days }
  );
}

/**
 * Compute EV from a prices array (grade/price pairs).
 * Prices come back as strings from the API — parse them.
 *
 * EV Low  = Raw price
 * EV Mid  = PSA 9 (or best mid-grade available)
 * EV High = PSA 10
 */
function evFromPrices(prices: Array<{ grade: string; price: string }>): { evLow: number; evMid: number; evHigh: number } {
  const priceMap: Record<string, number> = {};
  for (const p of prices) {
    priceMap[p.grade.toLowerCase()] = parseFloat(p.price) || 0;
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
 * Use this for refreshes when we already have the card ID stored.
 */
export async function computeLiveEV(cardId: string): Promise<{ evLow: number; evMid: number; evHigh: number }> {
  const result = await getAllPrices(cardId);
  return evFromPrices(result.prices ?? []);
}
