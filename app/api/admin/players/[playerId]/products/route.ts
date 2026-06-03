import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/admin/players/[playerId]/products
//
// The products a player is associated with — surfaced when an admin clicks a
// player name in the global /admin/players directory. Admin-gated via
// middleware (/api/admin/*). One row per product the player has a
// player_product in.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;

  const { data, error } = await supabaseAdmin
    .from('player_products')
    .select('insert_only, products!inner(id, name, year, lifecycle_status, is_active, sports(name))')
    .eq('player_id', playerId);

  if (error) {
    console.error('[GET /api/admin/players/[playerId]/products]', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  type Row = {
    insert_only: boolean | null;
    products: {
      id: string;
      name: string;
      year: string | null;
      lifecycle_status: string | null;
      is_active: boolean | null;
      sports: { name: string } | null;
    } | null;
  };

  // Dedup by product id (a player can have >1 player_product in a product).
  const byId = new Map<string, {
    productId: string;
    name: string;
    year: string | null;
    sport: string | null;
    lifecycle: string | null;
    isActive: boolean;
    insertOnly: boolean;
  }>();
  for (const r of (data as unknown as Row[]) ?? []) {
    const p = r.products;
    if (!p) continue;
    const existing = byId.get(p.id);
    // If any player_product for this product is non-insert, treat as non-insert.
    const insertOnly = (existing?.insertOnly ?? true) && !!r.insert_only;
    byId.set(p.id, {
      productId: p.id,
      name: p.name,
      year: p.year ?? null,
      sport: p.sports?.name ?? null,
      lifecycle: p.lifecycle_status ?? null,
      isActive: !!p.is_active,
      insertOnly,
    });
  }

  const products = [...byId.values()].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1; // active first
    return `${a.year ?? ''} ${a.name}`.localeCompare(`${b.year ?? ''} ${b.name}`);
  });

  return NextResponse.json({ products });
}
