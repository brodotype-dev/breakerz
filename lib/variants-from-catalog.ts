// Hydrate player_product_variants directly from ch_set_cache.
//
// Inverts the legacy pipeline (parse checklist → create variants → match to CH)
// by using the pre-loaded CH catalog as the source of truth for what variants
// exist. Variants are born with cardhedger_card_id set, so the matching
// pipeline has nothing to do for them.
//
// See /Users/brody/.claude/plans/polymorphic-gathering-valley.md for context.

import { supabaseAdmin } from './supabase';
import { loadCatalogIndex } from './cardhedger-catalog';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HydrateResult {
  insertedCount: number;
  deletedCount: number;
  /** CH players that still didn't resolve to a player_product after auto-create
   *  (should be empty in the normal case; non-zero means an auto-create failed). */
  skippedPlayers: { playerName: string; catalogRows: number }[];
  /** Phase 3: players auto-created in `players` because CH had them and we didn't. */
  autoCreatedPlayers: number;
  /** Phase 3: player_products auto-linked to this product for CH players. */
  autoCreatedPlayerProducts: number;
  catalogCards: number;
  durationMs: number;
  setName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize a player name for matching across CH + our players table.
 * Strips diacritics (Dončić → Doncic), lowercases, trims. No punctuation
 * stripping — "A.J." and "AJ" stay distinct; surface those via skippedPlayers
 * and let the admin fix the player row rather than silently collide.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull a trailing "/N" print run off a CH variant string.
 *   "Red Refractor /5"      → { name: "Red Refractor", printRun: 5 }
 *   "Black/White Refractor" → { name: "Black/White Refractor", printRun: null }  (no trailing digits)
 *   "Gold"                  → { name: "Gold", printRun: null }
 */
function parseVariant(variant: string): { name: string; printRun: number | null } {
  const m = variant.match(/^(.*?)\s*\/(\d+)\s*$/);
  if (!m) return { name: variant.trim(), printRun: null };
  const printRun = parseInt(m[2], 10);
  return { name: m[1].trim(), printRun: Number.isFinite(printRun) ? printRun : null };
}

function isShortPrint(variant: string, printRun: number | null): boolean {
  if (/\bSP\b/i.test(variant)) return true;
  if (/SuperFractor/i.test(variant)) return true;
  if (printRun != null && printRun <= 99) return true;
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Replace a product's `player_product_variants` with one row per matching
 * `ch_set_cache` entry, pre-linked via `cardhedger_card_id`.
 *
 * Requires `products.ch_set_name` to be set and `ch_set_cache` to have rows
 * for that set (run "Refresh CH Catalog" first).
 *
 * Non-destructive across other products — only touches variants whose
 * `player_product_id` belongs to this product.
 */
export async function hydrateVariantsFromCatalog(productId: string): Promise<HydrateResult> {
  const started = Date.now();

  // 1. Load product + ch_set_name + sport_id (needed for Phase 3 player auto-create)
  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .select('id, ch_set_name, sport_id')
    .eq('id', productId)
    .single();

  if (productErr) throw new Error(`Product lookup failed: ${productErr.message}`);
  if (!product) throw new Error('Product not found');

  const setName = product.ch_set_name as string | null;
  if (!setName) {
    throw new Error(
      "Product has no ch_set_name. Set it via the 'Find on CH' widget on the product form, " +
        "then click 'Refresh CH Catalog' before hydrating.",
    );
  }

  const sportId = product.sport_id as string | null;
  if (!sportId) {
    throw new Error(
      'Product has no sport_id — cannot auto-create players. Fix the product row first.',
    );
  }

  // 2. Load catalog (already paginates correctly per PR #4)
  const index = await loadCatalogIndex(setName);
  if (index.cards.length === 0) {
    throw new Error(
      `ch_set_cache is empty for "${setName}". Click 'Refresh CH Catalog' first.`,
    );
  }

  // 3. Load this product's player_products with joined player names.
  //    Paginate — PostgREST caps responses at 1000 rows by default, and several
  //    products have >1000 player_products. Same-family bug as PR #4/#6.
  const PP_PAGE = 1000;
  const playerProducts: { id: string; player: { name: string } | null }[] = [];
  for (let offset = 0; ; offset += PP_PAGE) {
    const { data, error: ppErr } = await supabaseAdmin
      .from('player_products')
      .select('id, player:players(name)')
      .eq('product_id', productId)
      .range(offset, offset + PP_PAGE - 1);
    if (ppErr) throw new Error(`player_products load failed: ${ppErr.message}`);
    if (!data || data.length === 0) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    playerProducts.push(...(data as any));
    if (data.length < PP_PAGE) break;
  }

  // Build normalizedName → player_product_id map
  const nameToPpId = new Map<string, string>();
  for (const pp of playerProducts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerName = (pp as any).player?.name as string | undefined;
    if (!playerName) continue;
    nameToPpId.set(normalizeName(playerName), pp.id);
  }

  // 3.5. Phase 3: auto-create missing players + player_products from CH catalog.
  //      For every CH row whose normalized player_name isn't in nameToPpId, add
  //      a `players` row (upserted on (name, sport_id) so it's safe against
  //      existing players from other products) and a `player_products` row
  //      linking to this product. After this block, every CH-listed player
  //      should have a ppId — skippedPlayers should stay empty in practice.
  //
  //      Dedupe missing names by normalized form so "Luka Dončić" and
  //      "Luka Doncic" in the same catalog don't create two player rows.
  const missingPlayerNames = new Map<string, string>(); // normalized → first-seen CH name
  for (const c of index.cards) {
    const chName = c.player_name?.trim();
    if (!chName) continue;
    const norm = normalizeName(chName);
    if (!nameToPpId.has(norm) && !missingPlayerNames.has(norm)) {
      missingPlayerNames.set(norm, chName);
    }
  }

  let autoCreatedPlayers = 0;
  let autoCreatedPlayerProducts = 0;

  if (missingPlayerNames.size > 0) {
    const playerRows = Array.from(missingPlayerNames.values()).map(name => ({
      name,
      sport_id: sportId,
    }));

    const { data: upsertedPlayers, error: pErr } = await supabaseAdmin
      .from('players')
      .upsert(playerRows, { onConflict: 'name,sport_id' })
      .select('id, name');
    if (pErr) throw new Error(`Player auto-create failed: ${pErr.message}`);
    autoCreatedPlayers = upsertedPlayers?.length ?? 0;

    const ppRows = (upsertedPlayers ?? []).map(p => ({
      player_id: p.id,
      product_id: productId,
      insert_only: false,
    }));

    const { data: upsertedPPs, error: ppErr } = await supabaseAdmin
      .from('player_products')
      .upsert(ppRows, { onConflict: 'player_id,product_id' })
      .select('id, player:players(name)');
    if (ppErr) throw new Error(`player_product auto-create failed: ${ppErr.message}`);
    autoCreatedPlayerProducts = upsertedPPs?.length ?? 0;

    for (const pp of upsertedPPs ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pName = (pp as any).player?.name as string | undefined;
      if (!pName) continue;
      nameToPpId.set(normalizeName(pName), pp.id);
    }
  }

  // 4. Walk catalog rows → build variant inserts + skip list
  const variantRows: Record<string, unknown>[] = [];
  const skippedCounts = new Map<string, number>();

  for (const c of index.cards) {
    const chName = c.player_name?.trim();
    if (!chName) continue; // catalog hygiene: skip rows with no player

    const ppId = nameToPpId.get(normalizeName(chName));
    if (!ppId) {
      skippedCounts.set(chName, (skippedCounts.get(chName) ?? 0) + 1);
      continue;
    }

    const { name: variantName, printRun } = parseVariant(c.variant ?? '');

    variantRows.push({
      player_product_id: ppId,
      variant_name: variantName || 'Base',
      cardhedger_card_id: c.card_id,
      card_number: c.number || null,
      hobby_sets: 1,
      bd_only_sets: 0,
      is_sp: isShortPrint(c.variant ?? '', printRun),
      print_run: printRun,
      match_confidence: 1.0,
      match_tier: 'ch-native',
    });
  }

  // 5. Delete existing variants for this product's player_products.
  //    Chunk the .in() list — a 1000-UUID IN clause blows past PostgREST's URL
  //    length limit (~8KB) and returns 400 Bad Request. 200 UUIDs per chunk
  //    keeps us safely under that ceiling.
  const ppIds = playerProducts.map(pp => pp.id);
  const DELETE_CHUNK = 200;
  let deletedCount = 0;
  for (let i = 0; i < ppIds.length; i += DELETE_CHUNK) {
    const slice = ppIds.slice(i, i + DELETE_CHUNK);
    const { count, error: delErr } = await supabaseAdmin
      .from('player_product_variants')
      .delete({ count: 'exact' })
      .in('player_product_id', slice);
    if (delErr) {
      throw new Error(
        `Variant delete failed at ppId offset ${i} (chunk size ${slice.length}): ${delErr.message}`,
      );
    }
    deletedCount += count ?? 0;
  }

  // 6. Batch insert (500 at a time to stay inside Supabase limits)
  const BATCH = 500;
  let insertedCount = 0;
  for (let i = 0; i < variantRows.length; i += BATCH) {
    const slice = variantRows.slice(i, i + BATCH);
    const { error: insErr } = await supabaseAdmin
      .from('player_product_variants')
      .insert(slice);
    if (insErr) {
      throw new Error(`Variant insert failed at offset ${i}: ${insErr.message}`);
    }
    insertedCount += slice.length;
  }

  // 7. Summary
  const skippedPlayers = Array.from(skippedCounts.entries())
    .map(([playerName, catalogRows]) => ({ playerName, catalogRows }))
    .sort((a, b) => b.catalogRows - a.catalogRows);

  return {
    insertedCount,
    deletedCount,
    skippedPlayers,
    autoCreatedPlayers,
    autoCreatedPlayerProducts,
    catalogCards: index.cards.length,
    durationMs: Date.now() - started,
    setName,
  };
}
