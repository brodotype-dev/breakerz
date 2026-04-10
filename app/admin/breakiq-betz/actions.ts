'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

/**
 * Apply Breakerz Betz scores globally — updates ALL player_products for each player.
 * This is the global version (not per-product).
 */
export async function saveBreakIQBetsGlobal(
  updates: Array<{ playerId: string; score: number; note: string }>
): Promise<{ saved: number; error?: string }> {
  await requireRole('admin', 'contributor');
  try {
    let saved = 0;
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from('player_products')
        .update({ breakerz_score: u.score, breakerz_note: u.note.trim() })
        .eq('player_id', u.playerId);
      if (error) {
        console.error('saveBreakerzBetsGlobal update failed:', u.playerId, error);
        continue;
      }
      saved++;
    }
    revalidatePath('/admin/breakiq-betz');
    return { saved };
  } catch (err) {
    return { saved: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
