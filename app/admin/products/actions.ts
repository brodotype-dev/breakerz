'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import type { ProductLifecycle } from '@/lib/types';

export async function createProduct(formData: {
  name: string;
  sport_id: string;
  manufacturer: string;
  product_line?: string | null;
  year: string;
  hobby_case_cost: number | null;
  bd_case_cost: number | null;
  jumbo_case_cost?: number | null;
  hobby_am_case_cost?: number | null;
  bd_am_case_cost?: number | null;
  jumbo_am_case_cost?: number | null;
  hobby_autos_per_case: number | null;
  bd_autos_per_case: number | null;
  jumbo_autos_per_case?: number | null;
  release_date: string | null;
  ch_set_name?: string | null;
  is_active?: boolean;
  lifecycle_status?: ProductLifecycle;
}): Promise<{ id?: string; error?: string }> {
  await requireRole('admin', 'contributor');
  const slug = formData.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      ...formData,
      slug,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  revalidatePath('/admin');
  revalidatePath('/admin/products');
  return { id: data.id };
}

export async function updateProduct(
  productId: string,
  formData: {
    sport_id: string;
    manufacturer: string;
    product_line?: string | null;
    year: string;
    name: string;
    slug: string;
    hobby_case_cost: number | null;
    bd_case_cost: number | null;
    jumbo_case_cost?: number | null;
    hobby_am_case_cost?: number | null;
    bd_am_case_cost?: number | null;
    jumbo_am_case_cost?: number | null;
    hobby_autos_per_case: number | null;
    bd_autos_per_case: number | null;
    jumbo_autos_per_case?: number | null;
    release_date: string | null;
    ch_set_name?: string | null;
    is_active: boolean;
    lifecycle_status?: ProductLifecycle;
  }
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('products')
    .update(formData)
    .eq('id', productId);

  if (error) return { error: error.message };
  revalidatePath('/admin');
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  return {};
}

export async function setProductLifecycle(
  productId: string,
  next: ProductLifecycle,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');

  // Going live requires a CH set name — without it, the catalog refresh and
  // pricing pipeline have nothing to anchor on. Block the transition with
  // clear messaging instead of letting the admin produce a broken product.
  // Also captures the prior status so we can stamp live_since only on a
  // pre_release → live transition (reactivating a dormant product shouldn't
  // reset its freshness clock).
  let priorStatus: ProductLifecycle | null = null;
  if (next === 'live') {
    const { data: product, error: readErr } = await supabaseAdmin
      .from('products')
      .select('ch_set_name, lifecycle_status')
      .eq('id', productId)
      .single();
    if (readErr) return { error: readErr.message };
    if (!product?.ch_set_name) {
      return { error: 'Set a CardHedger set name on this product before marking it live.' };
    }
    priorStatus = product.lifecycle_status as ProductLifecycle;
  }

  // Plan C: stamp live_since on every pre_release → live transition so the
  // freshness multiplier in lib/pricing-refresh.ts has a starting point.
  // dormant → live deliberately does NOT reset live_since (winding back up
  // an old product shouldn't pretend it's freshly released).
  const update: { lifecycle_status: ProductLifecycle; live_since?: string } = {
    lifecycle_status: next,
  };
  if (next === 'live' && priorStatus === 'pre_release') {
    update.live_since = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from('products')
    .update(update)
    .eq('id', productId);

  if (error) return { error: error.message };
  revalidatePath('/admin');
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  return {};
}

export async function setProductChSetName(
  productId: string,
  chSetName: string | null,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('products')
    .update({ ch_set_name: chSetName })
    .eq('id', productId);

  if (error) return { error: error.message };
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  return {};
}

export async function saveBreakerzBets(
  productId: string,
  updates: Array<{ playerProductId: string; score: number; note: string }>
): Promise<{ saved: number; error?: string }> {
  await requireRole('admin', 'contributor');
  try {
    let saved = 0;
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from('player_products')
        .update({ breakerz_score: u.score, breakerz_note: u.note.trim() })
        .eq('id', u.playerProductId);
      if (error) { console.error('saveBreakerzBets update failed:', u.playerProductId, error); continue; }
      saved++;
    }
    revalidatePath(`/admin/products/${productId}`);
    return { saved };
  } catch (err) {
    return { saved: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Player-global attribute editing (icon / high-volatility / risk flags) moved
// to app/admin/players/actions.ts in the 2026-06-02 re-model. These attributes
// describe the player, not the card-in-a-product, so they're managed from the
// global /admin/players directory rather than per product.

// Pre-flight summary for product deletion — the admin UI surfaces these
// counts so admin sees exactly what cascades before they confirm. Also
// reports whether the delete is hard-blocked by consumer data.
//
// Cascade map (per DB FK rules verified 2026-05-22):
//   player_products          → CASCADE  (drags variants / pricing_cache /
//                                       risk_flags / sentiment_history)
//   market_observations      → CASCADE
//   product_chase_cards      → CASCADE
//   waxstat_pricing_snapshots → CASCADE
//   ch_set_refresh_log       → SET NULL (audit row kept)
//   pricing_feedback         → SET NULL (consumer feedback kept, unlinked)
//   user_breaks              → NO ACTION → DB refuses delete if any exist
export type ProductDeletionPreview = {
  productName: string;
  counts: {
    playerProducts: number;
    variants: number;
    marketObservations: number;
    pricingFeedback: number;
    chaseCards: number;
    userBreaks: number;
  };
  // When set, the delete button must stay disabled. Currently fires only
  // for `user_breaks > 0` — consumers logged breaks against this product
  // and we won't quietly nuke their history.
  blockReason: string | null;
};

export async function getProductDeletionPreview(
  productId: string,
): Promise<{ preview?: ProductDeletionPreview; error?: string }> {
  await requireRole('admin');

  const { data: product, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('id', productId)
    .maybeSingle();
  if (prodErr) return { error: prodErr.message };
  if (!product) return { error: 'Product not found' };

  // Counts in parallel — all head:true so no rows leave the DB.
  const [pp, variants, obs, feedback, chase, breaks] = await Promise.all([
    supabaseAdmin
      .from('player_products')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId),
    supabaseAdmin
      .from('player_product_variants')
      .select('id, player_products!inner(product_id)', { count: 'exact', head: true })
      .eq('player_products.product_id', productId),
    supabaseAdmin
      .from('market_observations')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId),
    supabaseAdmin
      .from('pricing_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId),
    supabaseAdmin
      .from('product_chase_cards')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId),
    supabaseAdmin
      .from('user_breaks')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId),
  ]);

  const userBreaks = breaks.count ?? 0;

  return {
    preview: {
      productName: product.name,
      counts: {
        playerProducts: pp.count ?? 0,
        variants: variants.count ?? 0,
        marketObservations: obs.count ?? 0,
        pricingFeedback: feedback.count ?? 0,
        chaseCards: chase.count ?? 0,
        userBreaks,
      },
      blockReason:
        userBreaks > 0
          ? `${userBreaks} consumer break log${userBreaks === 1 ? '' : 's'} reference this product. ` +
            `Deactivate it instead (toggle Active off) — deleting would orphan their history.`
          : null,
    },
  };
}

export async function deleteProduct(
  productId: string,
  expectedName: string,
): Promise<{ error?: string }> {
  await requireRole('admin');

  // Re-verify name match server-side so a tampered client can't trigger
  // a delete by passing any string. Belt-and-suspenders for a destructive
  // op — the UI already requires typing it.
  const { data: product, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('name')
    .eq('id', productId)
    .maybeSingle();
  if (prodErr) return { error: prodErr.message };
  if (!product) return { error: 'Product not found' };
  if (product.name !== expectedName) {
    return {
      error: `Confirmation name mismatch (expected "${product.name}"). Aborting delete.`,
    };
  }

  // Re-check the user_breaks guard server-side — preview is stale by the
  // time the admin confirms, and we never want to silently cascade-delete
  // consumer history.
  const { count: breakCount } = await supabaseAdmin
    .from('user_breaks')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if ((breakCount ?? 0) > 0) {
    return {
      error: `Cannot delete: ${breakCount} consumer break log(s) reference this product. ` +
        `Deactivate it instead.`,
    };
  }

  const { error } = await supabaseAdmin.from('products').delete().eq('id', productId);
  if (error) return { error: error.message };

  revalidatePath('/admin');
  revalidatePath('/admin/products');
  return {};
}

export type BulkPlayerRow = {
  name: string;
  team: string;
  isRookie: boolean;
  insertOnly: boolean;
  hobbySets: number;
  bdOnlySets: number;
};

export async function bulkAddPlayers(
  productId: string,
  sportId: string,
  rows: BulkPlayerRow[]
): Promise<{ added: number; error?: string }> {
  await requireRole('admin', 'contributor');
  try {
    let added = 0;

    for (const row of rows) {
      if (!row.name.trim()) continue;

      // Upsert player — match on name + sport_id
      const { data: player, error: playerErr } = await supabaseAdmin
        .from('players')
        .upsert(
          { name: row.name.trim(), sport_id: sportId, team: row.team.trim(), is_rookie: row.isRookie },
          { onConflict: 'name,sport_id' }
        )
        .select('id')
        .single();

      if (playerErr || !player) {
        console.error('Failed to upsert player:', row.name, playerErr);
        continue;
      }

      const hobbySets = row.hobbySets ?? 1;
      const bdOnlySets = row.bdOnlySets ?? 0;

      // Upsert player_product — match on player_id + product_id
      const { error: ppErr } = await supabaseAdmin
        .from('player_products')
        .upsert(
          {
            player_id: player.id,
            product_id: productId,
            hobby_sets: hobbySets,
            bd_only_sets: bdOnlySets,
            total_sets: hobbySets + bdOnlySets,
            insert_only: row.insertOnly,
          },
          { onConflict: 'player_id,product_id' }
        );

      if (ppErr) {
        console.error('Failed to upsert player_product:', row.name, ppErr);
        continue;
      }

      added++;
    }

    revalidatePath(`/admin/products/${productId}/players`);
    return { added };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { added: 0, error: message };
  }
}
