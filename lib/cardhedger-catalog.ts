// CardHedger catalog pre-load + local lookup.
// See docs/catalog-preload-architecture.md for the pipeline this serves.
//
// Responsibilities:
//   - Resolve canonical CH set names (admin UI picker)
//   - Fetch a full set catalog via paginated /card-search and persist to ch_set_cache
//   - Expose a CatalogIndex for O(1) (number, variant) lookup during matching

import { searchSets, getCardsBySet } from './cardhedger';
import { supabaseAdmin } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CanonicalSetCandidate {
  set_name: string;
  year: string;
  category: string;
  thirty_day_sales?: number;
  image?: string;
}

export interface CatalogCard {
  card_id: string;
  number: string;
  player_name: string;
  variant: string;
  year: string;
  category: string;
  rookie: boolean;
}

export interface CatalogIndex {
  setName: string;
  cards: CatalogCard[];
  // Fast lookups — precomputed once per matching run.
  byNumber: Map<string, CatalogCard[]>;                     // "BCP-153" → [Base, Refractor, Gold, ...]
  byNumberVariant: Map<string, CatalogCard>;                // "BCP-153::base" → card row
}

export interface RefreshResult {
  setName: string;
  cardsFetched: number;
  pagesFetched: number;
  durationMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
// CH hasn't pushed back on 10-wide concurrency in the ad-hoc path.
// Keep conservative; this runs on cron too and we don't want to spike their API.
const PAGE_CONCURRENCY = 8;

// ── Canonical set resolution ──────────────────────────────────────────────────

/**
 * Look up canonical CH set names matching a free-text query.
 * Use this before refreshSetCatalog — CH's set names don't match hobby naming.
 *
 * Example: findCanonicalSet("2024 Bowman Chrome Prospect", "Baseball")
 *   → [{ set_name: "2024 Bowman Chrome Prospects Baseball", year: "2024", ... }]
 */
export async function findCanonicalSet(
  query: string,
  category?: string,
): Promise<CanonicalSetCandidate[]> {
  const result = await searchSets(query, category);
  return result.sets ?? [];
}

// ── Catalog refresh ───────────────────────────────────────────────────────────

async function runConcurrent<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Fetch the full catalog for a canonical CH set name and upsert into ch_set_cache.
 * Safe to call repeatedly — replaces all rows for the given set_name.
 *
 * Writes a ch_set_refresh_log row for observability.
 *
 * @param setName  canonical CH set name — must match CH's catalog exactly or the
 *                 /card-search set filter silently returns the full 2.9M-card corpus
 * @param opts.productId  optional — attach the refresh to a specific product for log filtering
 * @param opts.maxPages   optional hard cap on pages fetched. No cap by default —
 *                        we trust CH's reported page count, sanity-bound by
 *                        CORPUS_FALLTHROUGH_THRESHOLD below.
 */
// If CH reports more than this many pages for a single set, the set filter
// almost certainly fell through to the full ~2.9M-card corpus (~29,000 pages).
// Real single sets max out around 250–400 pages (Topps Chrome Basketball is
// ~280). Anything between this threshold and the corpus size is a bug we want
// to refuse, not silently truncate.
const CORPUS_FALLTHROUGH_THRESHOLD = 1000;

export async function refreshSetCatalog(
  setName: string,
  opts: { productId?: string; maxPages?: number } = {},
): Promise<RefreshResult> {
  const { productId, maxPages } = opts;
  const started = Date.now();

  // Open a refresh-log row immediately so we can trace failures mid-pull.
  const { data: logRow } = await supabaseAdmin
    .from('ch_set_refresh_log')
    .insert({ ch_set_name: setName, product_id: productId ?? null })
    .select('id')
    .single();

  try {
    // First page tells us how many pages we need.
    const firstPage = await getCardsBySet(setName, 1, PAGE_SIZE);
    const reportedPages = firstPage.pages ?? 1;

    // Refuse a corpus fall-through up front, before fetching anything else.
    if (reportedPages > CORPUS_FALLTHROUGH_THRESHOLD) {
      throw new Error(
        `Set "${setName}" returned ${reportedPages} pages — likely a set-name ` +
          `mismatch falling through to the full CH corpus. Verify via ` +
          `findCanonicalSet() and update products.ch_set_name.`,
      );
    }

    const totalPages = maxPages != null ? Math.min(reportedPages, maxPages) : reportedPages;
    const allCards = [...(firstPage.cards ?? [])];

    // Fetch remaining pages concurrently.
    if (totalPages > 1) {
      const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const pages = await runConcurrent(
        pageNums.map(p => () => getCardsBySet(setName, p, PAGE_SIZE)),
        PAGE_CONCURRENCY,
      );
      for (const r of pages) allCards.push(...(r.cards ?? []));
    }

    // Transactional replace: delete-then-insert for this set.
    // Simpler than diffing and guarantees CH deletions propagate.
    await supabaseAdmin.from('ch_set_cache').delete().eq('ch_set_name', setName);

    // Batch insert — Supabase accepts up to 1000 rows per call.
    const BATCH = 500;
    for (let i = 0; i < allCards.length; i += BATCH) {
      const slice = allCards.slice(i, i + BATCH).map(c => ({
        ch_set_name: setName,
        card_id: c.card_id,
        number: c.number ?? null,
        player_name: c.player_name ?? null,
        variant: c.variant ?? null,
        year: c.year ?? null,
        category: c.category ?? null,
        rookie: c.rookie ?? null,
        raw: c as unknown as Record<string, unknown>,
      }));
      const { error } = await supabaseAdmin.from('ch_set_cache').insert(slice);
      if (error) throw new Error(`ch_set_cache insert failed at offset ${i}: ${error.message}`);
    }

    const durationMs = Date.now() - started;

    if (logRow?.id) {
      await supabaseAdmin
        .from('ch_set_refresh_log')
        .update({
          completed_at: new Date().toISOString(),
          pages_fetched: totalPages,
          cards_fetched: allCards.length,
          success: true,
        })
        .eq('id', logRow.id);
    }

    return { setName, cardsFetched: allCards.length, pagesFetched: totalPages, durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logRow?.id) {
      await supabaseAdmin
        .from('ch_set_refresh_log')
        .update({
          completed_at: new Date().toISOString(),
          success: false,
          error: msg,
        })
        .eq('id', logRow.id);
    }
    throw err;
  }
}

// ── Local lookup ──────────────────────────────────────────────────────────────

/**
 * Load the cached catalog for a canonical set name and build an in-memory index.
 * Call once per matching run — the index powers every per-variant lookup O(1).
 *
 * Returns an empty index (with setName) if the set has never been refreshed.
 */
export async function loadCatalogIndex(setName: string): Promise<CatalogIndex> {
  // Supabase/PostgREST caps any single response at 1000 rows by default. Large
  // sets (e.g. 2025 Topps Finest Basketball = 12,097 cards) silently truncate
  // at 1000, which cripples the in-memory index and causes ~92% of variants to
  // miss byNumber lookups. Paginate via .range() until a short page comes back.
  const PAGE_SIZE = 1000;
  const allRows: Array<{
    card_id: string;
    number: string | null;
    player_name: string | null;
    variant: string | null;
    year: string | null;
    category: string | null;
    rookie: boolean | null;
  }> = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from('ch_set_cache')
      .select('card_id, number, player_name, variant, year, category, rookie')
      .eq('ch_set_name', setName)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`ch_set_cache load failed for "${setName}": ${error.message}`);
    const page = data ?? [];
    allRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const data = allRows;

  const cards: CatalogCard[] = (data ?? []).map(r => ({
    card_id: r.card_id,
    number: r.number ?? '',
    player_name: r.player_name ?? '',
    variant: r.variant ?? '',
    year: r.year ?? '',
    category: r.category ?? '',
    rookie: !!r.rookie,
  }));

  const byNumber = new Map<string, CatalogCard[]>();
  const byNumberVariant = new Map<string, CatalogCard>();

  for (const c of cards) {
    if (!c.number) continue;
    const bucket = byNumber.get(c.number);
    if (bucket) bucket.push(c);
    else byNumber.set(c.number, [c]);

    const variantKey = `${c.number}::${c.variant.toLowerCase()}`;
    // If two rows share (number, variant) — rare, but CH sometimes has duplicate parallels —
    // keep the first (likely Base/most-canonical). No ranking needed; tie-breakers come later.
    if (!byNumberVariant.has(variantKey)) byNumberVariant.set(variantKey, c);
  }

  return { setName, cards, byNumber, byNumberVariant };
}

/**
 * When a variant maps to many rows with the same `number`, pick the most canonical:
 *   Base > Refractor > first available.
 * Used as the fallback when we know the card number but can't resolve the variant.
 */
export function pickCanonicalVariant(cards: CatalogCard[]): CatalogCard | undefined {
  if (cards.length === 0) return undefined;
  return (
    cards.find(c => c.variant.toLowerCase() === 'base') ??
    cards.find(c => c.variant.toLowerCase() === 'refractor') ??
    cards[0]
  );
}

// ── Active-product cron helper ────────────────────────────────────────────────

/**
 * Returns every active product that has a canonical CH set name assigned.
 * The cron iterates these, refreshing one at a time to be polite to CH.
 */
export async function listActiveProductsWithCHSet(): Promise<
  Array<{ id: string; name: string; ch_set_name: string }>
> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, name, ch_set_name')
    .eq('is_active', true)
    .eq('lifecycle_status', 'live')
    .not('ch_set_name', 'is', null);
  if (error) throw new Error(`list active products failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string; name: string; ch_set_name: string }>;
}
