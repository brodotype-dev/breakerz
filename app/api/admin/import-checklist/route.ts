import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedCard } from '@/lib/checklist-parser';
import { checkRole } from '@/lib/auth';

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
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
  // Key: "playerName||team" — used to accumulate set totals per card type
  const playerSetTotals = new Map<string, {
    name: string; team: string; hobbySets: number; bdSets: number; isRookie: boolean;
  }>();

  // Track whether each player appears in any base-set entry. A card is "base"
  // if its card_number is purely numeric (e.g. "1", "251") — inserts and
  // autographs use prefixed codes ("SF-13", "TCA-JM"). This drives insert_only
  // on the player_product so retired-legend insert subjects don't count as
  // slot-eligible base players.
  const playerHasBaseAppearance = new Map<string, boolean>();

  // Collect every card_number per player, deduped. Persisted on the player_product
  // so hydrate can scope CH variant attachment to what's actually in this product's
  // checklist (key for products that share a ch_set_name like Topps S1 + S2).
  const playerCardNumbers = new Map<string, Set<string>>();

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

      const isBaseCard = !!card.cardNumber && /^[0-9]+$/.test(card.cardNumber);
      if (isBaseCard) playerHasBaseAppearance.set(card.playerName, true);
      else if (!playerHasBaseAppearance.has(card.playerName)) {
        playerHasBaseAppearance.set(card.playerName, false);
      }

      if (card.cardNumber) {
        const nums = playerCardNumbers.get(card.playerName) ?? new Set<string>();
        nums.add(card.cardNumber);
        playerCardNumbers.set(card.playerName, nums);
      }
    }
  }

  // Deduplicate by name for the players upsert — same player can appear
  // across sections with different/empty teams; keep the most complete record
  const playersByName = new Map<string, { name: string; team: string; hobbySets: number; bdSets: number; isRookie: boolean }>();
  for (const p of playerSetTotals.values()) {
    const existing = playersByName.get(p.name);
    playersByName.set(p.name, {
      name: p.name,
      team: p.team || existing?.team || '',
      hobbySets: (existing?.hobbySets ?? 0) + p.hobbySets,
      bdSets: (existing?.bdSets ?? 0) + p.bdSets,
      isRookie: p.isRookie || (existing?.isRookie ?? false),
    });
  }

  const uniquePlayers = Array.from(playersByName.values());

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
  // insert_only=true for players who appear ONLY in non-base sections (autograph
  // subsets, themed inserts featuring retired legends, etc.). Drives slot
  // eligibility: the pricing engine and dashboard counts filter on this flag.
  // checklist_card_numbers is the union of all this player's card_numbers from
  // the parsed checklist — hydrate uses it to scope CH variant attachment.
  const ppRows = uniquePlayers.map(p => {
    const playerId = playerNameToId.get(p.name);
    if (!playerId) return null;
    const hasBase = playerHasBaseAppearance.get(p.name) === true;
    const cardNumbers = Array.from(playerCardNumbers.get(p.name) ?? []);
    return {
      player_id: playerId,
      product_id: productId,
      hobby_sets: p.hobbySets,
      bd_only_sets: p.bdSets,
      insert_only: !hasBase,
      checklist_card_numbers: cardNumbers.length > 0 ? cardNumbers : null,
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
  // If the parser attached a `parallels` list to a card, expand it: one variant
  // row per parallel label (e.g. "Refractor", "Gold /50", "SuperFractor /1"),
  // plus a synthetic "Base" row — Topps checklists don't list Base explicitly
  // but every numbered card has one.
  //
  // If no parallels are attached (older parsers / non-XLSX formats), fall back
  // to the legacy behavior of one variant named after the section.
  const variantRows: object[] = [];
  for (const section of sections) {
    for (const card of section.cards) {
      const playerId = playerNameToId.get(card.playerName);
      if (!playerId) continue;
      const ppId = playerIdToPPId.get(playerId);
      if (!ppId) continue;

      const parallels = card.parallels ?? [];
      const variantNames =
        parallels.length > 0
          ? Array.from(new Set(['Base', ...parallels]))
          : [section.sectionName];

      for (const variantName of variantNames) {
        variantRows.push({
          player_product_id: ppId,
          variant_name: variantName,
          cardhedger_card_id: null,
          hobby_sets: section.hobbySets,
          bd_only_sets: section.bdSets,
          card_number: card.cardNumber ?? null,
          is_sp: card.isSP,
          print_run: card.printRun ?? null,
        });
      }
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
