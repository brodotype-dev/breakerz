import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/admin/chase-cards/[id]
// Body: { is_hit?, display_name?, odds_display?, type? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if ('is_hit' in body) {
    updates.is_hit = body.is_hit;
    updates.hit_at = body.is_hit ? new Date().toISOString() : null;
    updates.hit_reported_by = body.is_hit ? auth.user.id : null;
  }
  if ('display_name' in body) updates.display_name = body.display_name || null;
  if ('odds_display' in body) updates.odds_display = body.odds_display || null;
  if ('type' in body) updates.type = body.type;

  const { data, error } = await supabaseAdmin
    .from('product_chase_cards')
    .update(updates)
    .eq('id', id)
    .select('*, player_product:player_products(*, player:players(*))')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chaseCard: data });
}

// DELETE /api/admin/chase-cards/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from('product_chase_cards')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
