import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/admin/chase-cards?productId=xxx
// Returns chase cards + recommended candidates for a product
export async function GET(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const productId = req.nextUrl.searchParams.get('productId');
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 });

  const [{ data: chaseCards }, { data: candidates }] = await Promise.all([
    // Existing chase cards for this product
    supabaseAdmin
      .from('product_chase_cards')
      .select('*, player_product:player_products(*, player:players(*))')
      .eq('product_id', productId)
      .order('display_order', { ascending: true }),

    // Recommend candidates: players with lowest-odds variants or high buzz_score
    supabaseAdmin
      .from('player_products')
      .select('id, buzz_score, breakerz_score, player:players(id, name, team, is_rookie, is_icon), player_product_variants(id, variant_name, hobby_odds, card_number)')
      .eq('product_id', productId)
      .eq('insert_only', false)
      .order('buzz_score', { ascending: false })
      .limit(100),
  ]);

  // Filter candidates to those with very low odds (chase cards) or high buzz (chase players)
  const allCandidates = (candidates ?? []).map(pp => {
    const variants = (pp.player_product_variants ?? []) as Array<{ id: string; variant_name: string; hobby_odds: number | null; card_number: string | null }>;
    const rarestVariant = variants
      .filter(v => v.hobby_odds != null && v.hobby_odds > 0)
      .sort((a, b) => (a.hobby_odds ?? Infinity) - (b.hobby_odds ?? Infinity))[0];
    return { ...pp, rarestVariant };
  });

  // Chase card candidates: players who have a variant with odds <= 1:360 (very rare)
  const chaseCardCandidates = allCandidates
    .filter(pp => pp.rarestVariant && (pp.rarestVariant.hobby_odds ?? 999) <= 360)
    .sort((a, b) => (a.rarestVariant?.hobby_odds ?? 999) - (b.rarestVariant?.hobby_odds ?? 999))
    .slice(0, 10);

  // Chase player candidates: top buzz_score players
  const chasePlayerCandidates = allCandidates
    .filter(pp => (pp.buzz_score ?? 0) > 0)
    .sort((a, b) => (b.buzz_score ?? 0) - (a.buzz_score ?? 0))
    .slice(0, 10);

  return NextResponse.json({
    chaseCards: chaseCards ?? [],
    recommendations: {
      chaseCards: chaseCardCandidates,
      chasePlayers: chasePlayerCandidates,
    },
  });
}

// POST /api/admin/chase-cards
// Body: { product_id, player_product_id, type, display_name?, odds_display? }
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { product_id, player_product_id, type, display_name, odds_display } = body;

  if (!product_id || !player_product_id || !type) {
    return NextResponse.json({ error: 'product_id, player_product_id, and type required' }, { status: 400 });
  }

  // Get current max display_order
  const { data: existing } = await supabaseAdmin
    .from('product_chase_cards')
    .select('display_order')
    .eq('product_id', product_id)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (existing?.display_order ?? -1) + 1;

  const { data, error } = await supabaseAdmin
    .from('product_chase_cards')
    .insert({ product_id, player_product_id, type, display_name: display_name || null, odds_display: odds_display || null, display_order: nextOrder })
    .select('*, player_product:player_products(*, player:players(*))')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chaseCard: data });
}
