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

  // Get product sport_id
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('sport_id')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  // --- Step 1: Collect unique players across all sections ---
  // Key: "playerName||team"
  const playerSetTotals = new Map<string, {
    name: string; team: string; hobbySets: number; bdSets: number; isRookie: boolean;
  }>();

  for (const section of sections) {
    for (const card of section.cards) {
      const key = `${card.playerName}||${card.team ?? ''}`;
      const existing = playerSetTotals.get(key);
      playerSetTotals.set(key, {
        name: card.playerName,
        team: card.team ?? existing?.team ?? '',
        hobbySets: (existing?.hobbySets ?? 0) + section.hobbySets,
        bdSets: (existing?.bdSets ?? 0) + section.bdSets,
        isRookie: card.isRookie || (existing?.isRookie ?? false),
      });
    }
  }

  const uniquePlayers = Array.from(playerSetTotals.values());

  // --- Step 2: Bulk upsert players ---
  const playerRows = uniquePlayers.map(p => ({
    name: p.name,
    team: p.team,
    sport_id: product.sport_id,
    is_rookie: p.isRookie,
  }));

  const { data: upsertedPlayers, error: playerErr } = await supabaseAdmin
    .from('players')
    .upsert(playerRows, { onConflict: 'name,sport_id' })
    .select('id, name');

  if (playerErr) return NextResponse.json({ error: playerErr.message }, { status: 500 });

  const playerNameToId = new Map<string, string>(
    (upsertedPlayers ?? []).map(p => [p.name, p.id])
  );
  const playersCreated = upsertedPlayers?.length ?? 0;

  // --- Step 3: Bulk upsert player_products ---
  const ppRows = uniquePlayers.map(p => {
    const playerId = playerNameToId.get(p.name);
    if (!playerId) return null;
    return {
      player_id: playerId,
      product_id: productId,
      hobby_sets: p.hobbySets,
      bd_only_sets: p.bdSets,
      total_sets: p.hobbySets + p.bdSets,
      insert_only: false,
    };
  }).filter(Boolean) as object[];

  const { data: upsertedPPs, error: ppErr } = await supabaseAdmin
    .from('player_products')
    .upsert(ppRows, { onConflict: 'player_id,product_id' })
    .select('id, player_id');

  if (ppErr) return NextResponse.json({ error: ppErr.message }, { status: 500 });

  const playerIdToPPId = new Map<string, string>(
    (upsertedPPs ?? []).map(pp => [pp.player_id, pp.id])
  );
  const playerProductsCreated = upsertedPPs?.length ?? 0;

  // --- Step 4: Bulk insert variants in chunks ---
  const variantRows: object[] = [];
  for (const section of sections) {
    for (const card of section.cards) {
      const key = `${card.playerName}||${card.team ?? ''}`;
      const totals = playerSetTotals.get(key);
      if (!totals) continue;
      const playerId = playerNameToId.get(totals.name);
      if (!playerId) continue;
      const ppId = playerIdToPPId.get(playerId);
      if (!ppId) continue;

      variantRows.push({
        player_product_id: ppId,
        variant_name: section.sectionName,
        cardhedger_card_id: null,
        hobby_sets: section.hobbySets,
        bd_only_sets: section.bdSets,
        card_number: card.cardNumber ?? null,
        is_sp: card.isSP,
        print_run: card.printRun ?? null,
      });
    }
  }

  // Insert variants in chunks of 500 to stay within Supabase limits
  const CHUNK_SIZE = 500;
  let variantsCreated = 0;
  for (let i = 0; i < variantRows.length; i += CHUNK_SIZE) {
    const chunk = variantRows.slice(i, i + CHUNK_SIZE);
    const { error: variantErr } = await supabaseAdmin
      .from('player_product_variants')
      .insert(chunk);
    if (variantErr) return NextResponse.json({ error: variantErr.message }, { status: 500 });
    variantsCreated += chunk.length;
  }

  return NextResponse.json({ playersCreated, playerProductsCreated, variantsCreated });
}
