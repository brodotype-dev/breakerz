import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/admin/ev-overrides?productId=xxx[&q=search]
//   - Always returns the product's active overrides (with player name + the
//     modeled EV from pricing_cache for context).
//   - When `q` is present, also returns matching players in the product so the
//     admin can pick one to override.
export async function GET(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  // Active overrides for this product.
  const { data: overrideRows, error: oErr } = await supabaseAdmin
    .from('player_products')
    .select('id, ev_override, ev_override_note, ev_override_set_by, ev_override_set_at, player:players(id, name, team)')
    .eq('product_id', productId)
    .not('ev_override', 'is', null)
    .order('ev_override_set_at', { ascending: false });
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  // Modeled EV for those pps (context: "model $121 → override $350").
  const overrideIds = (overrideRows ?? []).map(r => r.id);
  const modeledMap = new Map<string, number>();
  if (overrideIds.length > 0) {
    const { data: cache } = await supabaseAdmin
      .from('pricing_cache')
      .select('player_product_id, ev_mid')
      .in('player_product_id', overrideIds);
    for (const c of cache ?? []) modeledMap.set(c.player_product_id, c.ev_mid);
  }

  const overrides = (overrideRows ?? []).map(r => ({
    player_product_id: r.id,
    value: r.ev_override,
    note: r.ev_override_note,
    set_by: r.ev_override_set_by,
    set_at: r.ev_override_set_at,
    player: r.player,
    modeledEvMid: modeledMap.get(r.id) ?? null,
  }));

  // Player search for the picker (only when a query is provided). Filtering on
  // an embedded resource needs the unaliased table name (`players.name`), so we
  // don't alias the embed here — the row key is `players`.
  let candidates: Array<{ player_product_id: string; player: unknown }> = [];
  if (q.length >= 2) {
    const { data: matches } = await supabaseAdmin
      .from('player_products')
      .select('id, players!inner(id, name, team)')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .ilike('players.name', `%${q}%`)
      .limit(20);
    candidates = (matches ?? []).map(m => ({ player_product_id: m.id, player: m.players }));
  }

  return NextResponse.json({ overrides, candidates });
}

// POST /api/admin/ev-overrides
// Body: { player_product_id, value, note?, set_by? }
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const player_product_id: string | undefined = body?.player_product_id;
  const value = Number(body?.value);
  const note: string | null = body?.note?.trim() || null;
  const set_by: string | null = body?.set_by?.trim() || null;

  if (!player_product_id) {
    return NextResponse.json({ error: 'player_product_id required' }, { status: 400 });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('player_products')
    .update({
      ev_override: Math.round(value),
      ev_override_note: note,
      ev_override_set_by: set_by,
      ev_override_set_at: new Date().toISOString(),
    })
    .eq('id', player_product_id)
    .select('id, ev_override, ev_override_note, ev_override_set_by, ev_override_set_at, player:players(id, name, team)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    override: {
      player_product_id: data.id,
      value: data.ev_override,
      note: data.ev_override_note,
      set_by: data.ev_override_set_by,
      set_at: data.ev_override_set_at,
      player: data.player,
      modeledEvMid: null,
    },
  });
}

// DELETE /api/admin/ev-overrides?id=<player_product_id>
export async function DELETE(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('player_products')
    .update({
      ev_override: null,
      ev_override_note: null,
      ev_override_set_by: null,
      ev_override_set_at: null,
    })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
