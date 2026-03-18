import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedCard } from '@/lib/checklist-parser';

type SectionConfig = {
  sectionName: string;
  hobbySets: number;
  bdSets: number;
  cards: ParsedCard[];
};

type ImportRequest = {
  productId: string;
  sections: SectionConfig[];
};

export async function POST(req: NextRequest) {
  const body: ImportRequest = await req.json();
  const { productId, sections } = body;

  if (!productId || !sections?.length) {
    return NextResponse.json({ error: 'productId and sections required' }, { status: 400 });
  }

  let playersCreated = 0;
  let playerProductsCreated = 0;
  let variantsCreated = 0;

  // Get product sport_id
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('sport_id')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  // Build a map: playerName+team → player_product_id, accumulating set counts
  const playerMap = new Map<string, { playerId: string; playerProductId: string }>();

  // First pass: collect all unique players and their total set counts across sections
  const playerSetTotals = new Map<string, { hobbySets: number; bdSets: number; isRookie: boolean; team: string }>();
  for (const section of sections) {
    for (const card of section.cards) {
      const key = `${card.playerName}||${card.team ?? ''}`;
      const existing = playerSetTotals.get(key);
      playerSetTotals.set(key, {
        hobbySets: (existing?.hobbySets ?? 0) + section.hobbySets,
        bdSets: (existing?.bdSets ?? 0) + section.bdSets,
        isRookie: card.isRookie || (existing?.isRookie ?? false),
        team: card.team ?? existing?.team ?? '',
      });
    }
  }

  // Upsert players + player_products
  for (const [key, totals] of playerSetTotals) {
    const [playerName] = key.split('||');

    // Find or create player
    let { data: existingPlayer } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('name', playerName)
      .eq('sport_id', product.sport_id)
      .maybeSingle();

    if (!existingPlayer) {
      const { data: newPlayer } = await supabaseAdmin
        .from('players')
        .insert({ name: playerName, team: totals.team, sport_id: product.sport_id, is_rookie: totals.isRookie })
        .select('id')
        .single();
      existingPlayer = newPlayer;
      playersCreated++;
    }

    if (!existingPlayer) continue;

    // Find or create player_product
    let { data: existingPP } = await supabaseAdmin
      .from('player_products')
      .select('id')
      .eq('player_id', existingPlayer.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (!existingPP) {
      const { data: newPP } = await supabaseAdmin
        .from('player_products')
        .insert({
          player_id: existingPlayer.id,
          product_id: productId,
          hobby_sets: totals.hobbySets,
          bd_only_sets: totals.bdSets,
        })
        .select('id')
        .single();
      existingPP = newPP;
      playerProductsCreated++;
    }

    if (!existingPP) continue;
    playerMap.set(key, { playerId: existingPlayer.id, playerProductId: existingPP.id });
  }

  // Second pass: create variants
  for (const section of sections) {
    for (const card of section.cards) {
      const key = `${card.playerName}||${card.team ?? ''}`;
      const ids = playerMap.get(key);
      if (!ids) continue;

      await supabaseAdmin.from('player_product_variants').insert({
        player_product_id: ids.playerProductId,
        variant_name: section.sectionName,
        cardhedger_card_id: null,
        hobby_sets: section.hobbySets,
        bd_only_sets: section.bdSets,
        card_number: card.cardNumber ?? null,
        is_sp: card.isSP,
        print_run: card.printRun ?? null,
      });
      variantsCreated++;
    }
  }

  return NextResponse.json({ playersCreated, playerProductsCreated, variantsCreated });
}
