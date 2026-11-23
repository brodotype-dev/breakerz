// Break feed ingest — what the market is actually breaking.
//
// Two sources, two fidelities (verified by hand 2026-11-22):
//
//   steel_city     Alexandria provider `steelcitycollectibles-com /
//                  products/list_group_breaks`. Shop storefronts pre-list
//                  each break as a product, so every row carries a spot
//                  price, spots left, break date, breaker and sport. 66 live
//                  listings across 3 pages at time of writing.
//
//   fanatics_live  A Firecrawl markdown scrape of one shop page. Live
//                  platforms do not publish a break list before a show
//                  starts — a named, product-specific show two days out
//                  still reads "This shop is empty (for now)" and pre-claims
//                  happen by text message. So: title + time + breaker, no
//                  price, ever. Titles still tell us which products are
//                  getting attention, which is what the coverage signal needs.
//
// Alexandria runs on the FIRECRAWL_API_KEY we already have — it is a
// POST /v2/scrape with an `alexandria` body instead of a `url`. No new
// vendor, no new key. See docs.firecrawl.dev/features/alexandria.

import { supabaseAdmin } from '@/lib/supabase';
import { matchBreakTitle, type MatchableProduct } from '@/lib/break-feed-match';

export type BreakFeedKind = 'steel_city' | 'fanatics_live';

export interface FeedRow {
  kind: BreakFeedKind;
  sourceRef: string;
  title: string;
  url: string | null;
  /** Provider sport tag, our classification, or 'non_sports'. Null = unknown. */
  sport: string | null;
  breakDateLabel: string | null;
  price: number | null;
  spotsAvailable: number | null;
  breaker: string | null;
  configuration: string | null;
  raw: unknown;
}

export interface BreakFeedSummary {
  sourcesProcessed: number;
  rowsSeen: number;
  rowsUpserted: number;
  matched: number;
  unmatchedSports: number;
  nonSportsSkipped: number;
  disappeared: number;
  errors: Array<{ source: string; message: string }>;
}

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';

function apiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not configured');
  return key;
}

// ---------------------------------------------------------------------------
// Steel City (Alexandria)
// ---------------------------------------------------------------------------

interface SteelCityProduct {
  id?: number | string;
  title?: string;
  url?: string;
  sport?: string | null;
  break_date?: string | null;
  price?: number | null;
  available?: number | null;
  breaker?: { name?: string | null } | null;
  configuration?: string | null;
  is_group_break?: boolean;
}

/**
 * The Alexandria envelope nests the provider payload a couple of levels down
 * and the exact depth has moved between versions, so dig for the first object
 * that looks like a provider result rather than hardcoding a path.
 */
function unwrapAlexandria(body: unknown): Record<string, unknown> | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [body];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.products) && typeof obj.total_pages !== 'undefined') {
      return obj;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') queue.push(value);
    }
    if (Array.isArray(node)) queue.push(...node);
  }
  return null;
}

/**
 * Alexandria reports upstream provider failures as an `error` object nested
 * INSIDE an HTTP 200 envelope — observed live on 2026-11-22, a
 * `provider_error` / status 502 that cleared on the next attempt. Reading
 * only the HTTP status would hand us zero products and look like a healthy
 * empty board, which the disappeared-sweep below would then take as "every
 * break came off the market". So the in-body error is checked explicitly and
 * a transient one is retried.
 */
function alexandriaError(body: unknown): string | null {
  const calls = (body as { data?: { alexandria?: unknown[] } })?.data?.alexandria;
  if (!Array.isArray(calls)) return null;
  for (const call of calls) {
    const err = (call as { error?: { code?: string; message?: string; status?: number } })?.error;
    if (err) {
      return `${err.code ?? 'provider_error'} (status ${err.status ?? '?'}): ${err.message ?? ''}`.trim();
    }
  }
  return null;
}

async function alexandriaPage(
  page: number,
  attempt = 1
): Promise<{ products: SteelCityProduct[]; totalPages: number }> {
  const MAX_ATTEMPTS = 3;

  const retryOrThrow = async (reason: string) => {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(`Alexandria page ${page} failed after ${attempt} attempts — ${reason}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    return alexandriaPage(page, attempt + 1);
  };

  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      alexandria: {
        provider: 'steelcitycollectibles-com',
        capability: 'products/list_group_breaks',
        options: { page },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return retryOrThrow(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json();

  const providerError = alexandriaError(body);
  if (providerError) return retryOrThrow(providerError);

  const payload = unwrapAlexandria(body);
  if (!payload) {
    return retryOrThrow('no recognizable group-break payload in a 200 response');
  }

  return {
    products: (payload.products as SteelCityProduct[]) ?? [],
    totalPages: Number(payload.total_pages ?? 1) || 1,
  };
}

/** Pull every page of the Steel City break room. */
export async function fetchSteelCityBreaks(maxPages = 5): Promise<FeedRow[]> {
  const rows: FeedRow[] = [];

  const first = await alexandriaPage(1);
  const pages = Math.min(first.totalPages, maxPages);
  const all = [...first.products];

  for (let page = 2; page <= pages; page++) {
    const next = await alexandriaPage(page);
    all.push(...next.products);
  }

  for (const p of all) {
    if (!p.title || p.id === undefined || p.id === null) continue;
    rows.push({
      kind: 'steel_city',
      sourceRef: String(p.id),
      title: p.title,
      url: p.url ?? null,
      // The provider tags sports rows and leaves Pokemon / Marvel / Star Wars
      // / Disney / One Piece with a null sport. That is a cleaner non-sports
      // filter than anything we would write from the title.
      sport: p.sport ?? 'non_sports',
      breakDateLabel: p.break_date ?? null,
      price: typeof p.price === 'number' ? p.price : null,
      spotsAvailable: typeof p.available === 'number' ? p.available : null,
      breaker: p.breaker?.name ?? null,
      configuration: configurationFromTitle(p.title) ?? p.configuration ?? null,
      raw: p,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Fanatics Live (Firecrawl markdown)
// ---------------------------------------------------------------------------

const SHOW_LINK_RE =
  /\[([^\]]+)\]\(https:\/\/www\.fanatics\.live\/shows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/**
 * Each show appears twice in the shop markdown: first as its schedule chip
 * ("Mon 8:00 AM", or a bare viewer count when the show is live now), then as
 * its title. Collect by show id and take the first as the label, the second
 * as the title.
 */
export function parseFanaticsShops(markdown: string): Array<{
  showId: string;
  label: string;
  title: string;
}> {
  const byId = new Map<string, string[]>();
  let m: RegExpExecArray | null;

  SHOW_LINK_RE.lastIndex = 0;
  while ((m = SHOW_LINK_RE.exec(markdown)) !== null) {
    const text = m[1].trim();
    const id = m[2];
    if (!text || text.startsWith('!')) continue;
    const list = byId.get(id) ?? [];
    if (list.length < 2) list.push(text);
    byId.set(id, list);
  }

  const out: Array<{ showId: string; label: string; title: string }> = [];
  for (const [showId, parts] of byId) {
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      out.push({ showId, label: 'live now', title: parts[0] });
      continue;
    }
    const [label, title] = parts;
    out.push({
      showId,
      label: /^\d+$/.test(label) ? 'live now' : label,
      title,
    });
  }
  return out;
}

export async function fetchFanaticsLiveShows(shopSlug: string): Promise<FeedRow[]> {
  const res = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: `https://www.fanatics.live/shops/${shopSlug}`,
      formats: ['markdown'],
      onlyMainContent: false,
      waitFor: 4000,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firecrawl HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = (await res.json()) as { data?: { markdown?: string } };
  const markdown = body.data?.markdown;
  if (!markdown) throw new Error('Firecrawl returned no markdown for the shop page');

  return parseFanaticsShops(markdown).map(show => ({
    kind: 'fanatics_live' as const,
    sourceRef: show.showId,
    title: show.title,
    url: `https://www.fanatics.live/shows/${show.showId}`,
    sport: sportFromTitle(show.title),
    breakDateLabel: show.label,
    // There is no price to read. The platform publishes no inventory before
    // a show starts; this is a property of the platform, not a gap in scraping.
    price: null,
    spotsAvailable: null,
    breaker: shopSlug,
    configuration: configurationFromTitle(show.title),
    raw: show,
  }));
}

// ---------------------------------------------------------------------------
// Title classification
// ---------------------------------------------------------------------------

const NON_SPORTS_HINTS = [
  'pokemon', 'marvel', 'star wars', 'starwars', 'disney', 'lorcana', 'one piece',
  'garbage pail', 'gpk', 'hunger games', 'game of thrones', 'house of the dragon',
  'james bond', 'mars attacks', 'cardsmiths', 'k-pop', 'kpop', 'avengers',
  'rittenhouse', 'repack',
];

const SPORT_HINTS: Array<[RegExp, string]> = [
  [/\b(nfl|football)\b/i, 'football'],
  [/\b(nba|basketball|hoops)\b/i, 'basketball'],
  [/\b(mlb|baseball)\b/i, 'baseball'],
  [/\b(nhl|hockey)\b/i, 'hockey'],
  [/\b(ufc|mma)\b/i, 'mma'],
  [/\b(soccer|fifa)\b/i, 'soccer'],
];

/** Null means "we could not tell" — deliberately not the same as non_sports. */
export function sportFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const hint of NON_SPORTS_HINTS) {
    if (lower.includes(hint)) return 'non_sports';
  }
  for (const [re, sport] of SPORT_HINTS) {
    if (re.test(title)) return sport;
  }
  return null;
}

export function configurationFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  if (/\bpyt\b|pick your team/.test(lower)) return 'pyt';
  if (/\bmixer\b/.test(lower)) return 'mixer';
  if (/random (division|team|pack|card|serial|\d)/.test(lower)) return 'random';
  return null;
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * Pull every active source, match each title against our active products, and
 * upsert. Non-sports rows are stored too — they are cheap and they keep the
 * "share of the market we deliberately ignore" number honest — but they are
 * counted separately and the admin surface filters them out by default.
 */
export async function refreshBreakFeed(): Promise<BreakFeedSummary> {
  const summary: BreakFeedSummary = {
    sourcesProcessed: 0,
    rowsSeen: 0,
    rowsUpserted: 0,
    matched: 0,
    unmatchedSports: 0,
    nonSportsSkipped: 0,
    disappeared: 0,
    errors: [],
  };

  const { data: sources, error: sourcesError } = await supabaseAdmin
    .from('break_feed_sources')
    .select('id, kind, identifier, label')
    .eq('is_active', true);
  if (sourcesError) throw sourcesError;
  if (!sources || sources.length === 0) return summary;

  const { data: productRows, error: productsError } = await supabaseAdmin
    .from('products')
    .select('id, name, slug')
    .eq('is_active', true);
  if (productsError) throw productsError;
  const products: MatchableProduct[] = productRows ?? [];

  const seenRefs: Array<{ kind: string; ref: string }> = [];
  const now = new Date().toISOString();

  for (const source of sources) {
    try {
      const rows =
        source.kind === 'steel_city'
          ? await fetchSteelCityBreaks()
          : await fetchFanaticsLiveShows(source.identifier);

      summary.sourcesProcessed++;
      summary.rowsSeen += rows.length;

      const records = rows.map(row => {
        const match = matchBreakTitle(row.title, products);
        if (match.productId) summary.matched++;
        else if (row.sport === 'non_sports') summary.nonSportsSkipped++;
        else summary.unmatchedSports++;

        seenRefs.push({ kind: row.kind, ref: row.sourceRef });

        return {
          source_id: source.id,
          kind: row.kind,
          source_ref: row.sourceRef,
          title: row.title,
          url: row.url,
          sport: row.sport,
          break_date_label: row.breakDateLabel,
          price: row.price,
          spots_available: row.spotsAvailable,
          breaker: row.breaker,
          configuration: row.configuration,
          matched_product_id: match.productId,
          match_confidence: match.confidence,
          match_reason: match.reason,
          last_seen_at: now,
          disappeared_at: null,
          raw: row.raw as Record<string, unknown>,
        };
      });

      // 200-row chunks (CLAUDE.md gotcha #11 — Kong's ~8KB URL cap bites
      // filters, but large bodies are worth chunking regardless).
      for (let i = 0; i < records.length; i += 200) {
        const slice = records.slice(i, i + 200);
        const { error } = await supabaseAdmin
          .from('upcoming_breaks')
          .upsert(slice, { onConflict: 'kind,source_ref' });
        if (error) throw error;
        summary.rowsUpserted += slice.length;
      }

      await supabaseAdmin
        .from('break_feed_sources')
        .update({ last_scraped_at: now, last_error: null })
        .eq('id', source.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ source: source.label ?? source.identifier, message });
      await supabaseAdmin
        .from('break_feed_sources')
        .update({ last_scraped_at: now, last_error: message.slice(0, 500) })
        .eq('id', source.id);
    }
  }

  // Anything we previously saw from a source that refreshed cleanly, and did
  // not see this time, has come off the board. Mark it rather than delete it:
  // a break that sold out is still evidence of what the market wanted.
  if (summary.errors.length === 0 && seenRefs.length > 0) {
    const seenByKind = new Map<string, Set<string>>();
    for (const { kind, ref } of seenRefs) {
      const set = seenByKind.get(kind) ?? new Set<string>();
      set.add(ref);
      seenByKind.set(kind, set);
    }

    for (const [kind, refs] of seenByKind) {
      const { data: stale, error } = await supabaseAdmin
        .from('upcoming_breaks')
        .select('id, source_ref')
        .eq('kind', kind)
        .is('disappeared_at', null);
      if (error) continue;

      const goneIds = (stale ?? [])
        .filter(row => !refs.has(row.source_ref))
        .map(row => row.id);

      for (let i = 0; i < goneIds.length; i += 200) {
        const slice = goneIds.slice(i, i + 200);
        const { error: updateError } = await supabaseAdmin
          .from('upcoming_breaks')
          .update({ disappeared_at: now })
          .in('id', slice);
        if (!updateError) summary.disappeared += slice.length;
      }
    }
  }

  return summary;
}
