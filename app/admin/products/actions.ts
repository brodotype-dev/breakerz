'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function createProduct(formData: {
  name: string;
  sport_id: string;
  manufacturer: string;
  year: string;
  hobby_case_cost: number | null;
  bd_case_cost: number | null;
  hobby_autos_per_case: number | null;
  bd_autos_per_case: number | null;
  release_date: string | null;
  is_active?: boolean;
}): Promise<{ id?: string; error?: string }> {
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
    hobby_autos_per_case: number | null;
    bd_autos_per_case: number | null;
    release_date: string | null;
    is_active: boolean;
  }
): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('products')
    .update(formData)
    .eq('id', productId);

  if (error) return { error: error.message };
  revalidatePath('/admin/products');
  revalidatePath(`/admin/products/${productId}`);
  return {};
}

export async function deleteProduct(productId: string): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', productId);

  if (error) return { error: error.message };
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
