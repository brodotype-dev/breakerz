// CardHedger API client — server-side only, never expose the key to the browser

const BASE_URL = 'https://api.cardhedger.com';
const API_KEY = process.env.CARDHEDGER_API_KEY!;

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    next: { revalidate: 0 }, // always fresh — we handle caching in Supabase
  });

  if (!res.ok) {
    throw new Error(`CardHedger ${path} failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// Search for cards matching player + product criteria
export async function searchCards(query: string, sport?: string) {
  return post<{ cards: Array<{ card_id: string; player_name: string; set_name: string; year: string }> }>(
    '/v1/cards/card-search',
    { search: query, sport: sport }
  );
}

// Get all graded and raw prices for a specific card ID
export async function getAllPrices(cardId: string) {
  return post<{ prices: Array<{ grade: string; price: number; sold_count?: number }> }>(
    '/v1/cards/all-prices-by-card',
    { card_id: cardId }
  );
}

// Get recent comps (sold listings) for a card
export async function getComps(cardId: string, days = 90) {
  return post<{ comps: Array<{ sale_price: number; sale_date: string; grade: string; platform: string }> }>(
    '/v1/cards/comps',
    { card_id: cardId, days }
  );
}

// Get 90-day prices for a search — no card ID required
export async function get90DayPrices(search: string, grade?: string, sport?: string) {
  return post<{ prices: Array<{ grade: string; avg_price: number; min_price: number; max_price: number; sale_count: number }> }>(
    '/v1/cards/90day-prices-by-grade',
    { search, grade, sport }
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
 * Compute EV (low / mid / high) for a card from live pricing data.
 *
 * Strategy:
 * - Pull all-prices-by-card to get latest price per grade
 * - Raw price = baseline EV Low
 * - PSA 9 (or equivalent) = EV Mid proxy
 * - PSA 10 (or equivalent) = EV High proxy
 * - If grades are missing, fall back to comps median
 */
export async function computeLiveEV(cardId: string): Promise<{ evLow: number; evMid: number; evHigh: number }> {
  const [pricesResult, compsResult] = await Promise.allSettled([
    getAllPrices(cardId),
    getComps(cardId, 90),
  ]);

  const prices = pricesResult.status === 'fulfilled' ? pricesResult.value.prices : [];
  const comps = compsResult.status === 'fulfilled' ? compsResult.value.comps : [];

  // Build a grade → price map (case-insensitive)
  const priceMap: Record<string, number> = {};
  for (const p of prices) {
    priceMap[p.grade.toLowerCase()] = p.price;
  }

  // Helper: find price by partial grade label match
  const findGrade = (...candidates: string[]) => {
    for (const c of candidates) {
      const match = Object.entries(priceMap).find(([k]) => k.includes(c.toLowerCase()));
      if (match) return match[1];
    }
    return null;
  };

  const rawPrice = findGrade('raw', 'ungraded') ?? null;
  const midPrice = findGrade('psa 9', 'bgs 9', 'sgc 9', '9') ?? findGrade('psa 8', '8') ?? null;
  const highPrice = findGrade('psa 10', 'bgs 10', 'sgc 10', 'pristine') ?? null;

  // Fall back to comps median if prices aren't available
  const compPrices = comps.map(c => c.sale_price).filter(p => p > 0).sort((a, b) => a - b);
  const compMedian = compPrices.length > 0
    ? compPrices[Math.floor(compPrices.length / 2)]
    : null;

  const evMid = midPrice ?? compMedian ?? rawPrice ?? 0;
  const evLow = rawPrice ?? (evMid * 0.4);
  const evHigh = highPrice ?? (evMid * 2.5);

  return {
    evLow: Math.round(evLow),
    evMid: Math.round(evMid),
    evHigh: Math.round(evHigh),
  };
}
