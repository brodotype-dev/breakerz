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
  skippedPlayers: { playerName: string; catalogRows: number }[];
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

  // 1. Load product + ch_set_name
  const { data: product, error: productErr } = await supabaseAdmin
    .from('products')
    .select('id, ch_set_name')
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

  // 2. Load catalog (already paginates correctly per PR #4)
  const index = await loadCatalogIndex(setName);
  if (index.cards.length === 0) {
    throw new Error(
      `ch_set_cache is empty for "${setName}". Click 'Refresh CH Catalog' first.`,
    );
  }

  // 3. Load this product's player_products with joined player names
  const { data: playerProducts, error: ppErr } = await supabaseAdmin
    .from('player_products')
    .select('id, player:players(name)')
    .eq('product_id', productId);

  if (ppErr) throw new Error(`player_products load failed: ${ppErr.message}`);

  // Build normalizedName → player_product_id map
  const nameToPpId = new Map<string, string>();
  for (const pp of playerProducts ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerName = (pp as any).player?.name as string | undefined;
    if (!playerName) continue;
    nameToPpId.set(normalizeName(playerName), pp.id);
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

  // 5. Delete existing variants for this product's player_products
  const ppIds = (playerProducts ?? []).map(pp => pp.id);
  let deletedCount = 0;
  if (ppIds.length > 0) {
    const { count, error: delErr } = await supabaseAdmin
      .from('player_product_variants')
      .delete({ count: 'exact' })
      .in('player_product_id', ppIds);
    if (delErr) throw new Error(`Variant delete failed: ${delErr.message}`);
    deletedCount = count ?? 0;
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
    catalogCards: index.cards.length,
    durationMs: Date.now() - started,
    setName,
  };
}
