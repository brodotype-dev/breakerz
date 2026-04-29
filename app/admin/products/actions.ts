'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import type { ProductLifecycle } from '@/lib/types';

export async function createProduct(formData: {
  name: string;
  sport_id: string;
  manufacturer: string;
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
    year: string;
    name: string;
    slug: string;
    hobby_case_cost: number | null;
    bd_case_cost: number | null;
    hobby_am_case_cost?: number | null;
    bd_am_case_cost?: number | null;
    hobby_autos_per_case: number | null;
    bd_autos_per_case: number | null;
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
  if (next === 'live') {
    const { data: product, error: readErr } = await supabaseAdmin
      .from('products')
      .select('ch_set_name')
      .eq('id', productId)
      .single();
    if (readErr) return { error: readErr.message };
    if (!product?.ch_set_name) {
      return { error: 'Set a CardHedger set name on this product before marking it live.' };
    }
  }

  const { error } = await supabaseAdmin
    .from('products')
    .update({ lifecycle_status: next })
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

export async function setPlayerIcon(
  productId: string,
  playerId: string,
  isIcon: boolean
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('players')
    .update({ is_icon: isIcon })
    .eq('id', playerId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/products/${productId}/players`);
  return {};
}

export async function setPlayerHighVolatility(
  productId: string,
  playerProductId: string,
  isHV: boolean
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('player_products')
    .update({ is_high_volatility: isHV })
    .eq('id', playerProductId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/products/${productId}/players`);
  return {};
}

export async function addPlayerRiskFlag(
  productId: string,
  playerProductId: string,
  flagType: string,
  note: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('player_risk_flags')
    .insert({ player_product_id: playerProductId, flag_type: flagType, note: note.trim() });
  if (error) return { error: error.message };
  revalidatePath(`/admin/products/${productId}/players`);
  return {};
}

export async function clearPlayerRiskFlag(
  productId: string,
  flagId: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('player_risk_flags')
    .update({ cleared_at: new Date().toISOString() })
    .eq('id', flagId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/products/${productId}/players`);
  return {};
}

export async function deleteProduct(productId: string): Promise<{ error?: string }> {
  await requireRole('admin');
  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', productId);

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
