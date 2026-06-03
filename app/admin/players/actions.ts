'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

// Player-global attribute editing. Re-modeled 2026-06-02 off the per-product
// player manager: icon tier, high-volatility, and risk flags all describe the
// PLAYER (an injury / suspension / volatile market follows the athlete across
// every product), so they're keyed by player_id and managed from the global
// /admin/players directory. player_risk_flags is admin-only (service-role
// access); requireRole gates every write.

export async function setPlayerIcon(
  playerId: string,
  isIcon: boolean,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('players')
    .update({ is_icon: isIcon })
    .eq('id', playerId);
  if (error) return { error: error.message };
  revalidatePath('/admin/players');
  return {};
}

export async function setPlayerHighVolatility(
  playerId: string,
  isHV: boolean,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('players')
    .update({ is_high_volatility: isHV })
    .eq('id', playerId);
  if (error) return { error: error.message };
  revalidatePath('/admin/players');
  return {};
}

export async function addPlayerRiskFlag(
  playerId: string,
  flagType: string,
  note: string,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  if (!note.trim()) return { error: 'Note is required' };
  const { error } = await supabaseAdmin
    .from('player_risk_flags')
    .insert({ player_id: playerId, flag_type: flagType, note: note.trim() });
  if (error) return { error: error.message };
  revalidatePath('/admin/players');
  return {};
}

export async function clearPlayerRiskFlag(
  flagId: string,
): Promise<{ error?: string }> {
  await requireRole('admin', 'contributor');
  const { error } = await supabaseAdmin
    .from('player_risk_flags')
    .update({ cleared_at: new Date().toISOString() })
    .eq('id', flagId);
  if (error) return { error: error.message };
  revalidatePath('/admin/players');
  return {};
}
