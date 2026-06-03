import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedCard } from '@/lib/checklist-parser';
import { checkRole } from '@/lib/auth';
import {
  computePlayerAggregates,
  isMultiPlayerName,
  normalizePlayerName,
  isNonPlayerName,
  type PlayerAggregate,
  type SectionInput,
} from '@/lib/checklist-aggregates';

// Larger jumbo checklists (Panini Prizm Football: 32k+ cards across all
// sections + parallels) exceed Vercel's 4.5 MB Function ingress in a single
// POST. The client chunks those imports and sends each chunk with the same
// `playersOverride` (computed locally over the full dataset) so the player +
// player_product aggregates stay invariant across batches. Variants insert
// is dedupe-aware — we SELECT existing (variant_name, card_number) tuples
// for this batch's player_products and skip rows that already exist, so
// re-imports and chunked imports are idempotent.

type SectionConfig = SectionInput;

type ImportRequest = {
  productId: string;
  sections: SectionConfig[];
  // Pre-computed player aggregates from the client. When present, the server
  // uses these directly instead of recomputing from the sections — required
  // for chunked imports where each chunk only sees a slice of the cards.
  playersOverride?: PlayerAggregate[];
};

export async function POST(req: NextRequest) {
  // Accept admin cookie auth OR Authorization: Bearer <CRON_SECRET> for
  // server-to-server bulk-import scripts.
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const auth = await checkRole('admin', 'contributor');
    if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body: ImportRequest = await req.json();
  const { productId, sections, playersOverride } = body;

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

  // --- Step 1: Player aggregates ---
  // Use the client-provided override when present (chunked import path); otherwise
  // compute from this request's sections (single-shot import path). The aggregation
  // logic itself lives in lib/checklist-aggregates.ts so both paths share it.
  const uniquePlayers: PlayerAggregate[] = playersOverride ?? computePlayerAggregates(sections);

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
  // subsets, themed inserts featuring retired legends, etc.) OR whose name is
  // a multi-player concatenation ("Skubal / Blanco / Valdez" — League Leaders,
  // dual autos, etc.). Both classes are subsets, not slot-eligible base players.
  // Drives slot eligibility: the pricing engine and dashboard counts filter on
  // this flag. checklist_card_numbers is the union of all this player's
  // card_numbers from the parsed checklist — hydrate uses it to scope CH
  // variant attachment.
  const ppRows = uniquePlayers.map(p => {
    const playerId = playerNameToId.get(p.name);
    if (!playerId) return null;
    return {
      player_id: playerId,
      product_id: productId,
      hobby_sets: p.hobbySets,
      bd_only_sets: p.bdSets,
      insert_only: !p.hasBaseAppearance || isMultiPlayerName(p.name),
      checklist_card_numbers: p.cardNumbers.length > 0 ? p.cardNumbers : null,
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

  // --- Step 4: Build variant rows ---
  // If the parser attached a `parallels` list to a card, expand it: one variant
  // row per parallel label (e.g. "Refractor", "Gold /50", "SuperFractor /1"),
  // plus a synthetic "Base" row — Topps checklists don't list Base explicitly
  // but every numbered card has one.
  //
  // If no parallels are attached (older parsers / non-XLSX formats), fall back
  // to the legacy behavior of one variant named after the section.
  type VariantRow = {
    player_product_id: string;
    variant_name: string;
    cardhedger_card_id: null;
    hobby_sets: number;
    bd_only_sets: number;
    card_number: string | null;
    is_sp: boolean;
    print_run: number | null;
  };
  const variantRows: VariantRow[] = [];
  for (const section of sections) {
    for (const card of section.cards) {
      // Match the normalization computePlayerAggregates applied, so variants
      // attach to the normalized player and skipped non-player rows (headers,
      // codes, numbers) produce no variants either.
      const name = normalizePlayerName(card.playerName);
      if (isNonPlayerName(name)) continue;
      const playerId = playerNameToId.get(name);
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

  // --- Step 5: Dedupe-aware insert ---
  // Variants have no DB-level unique constraint (legacy schema; existing
  // production rows include ~9k duplicates that aren't worth touching here).
  // To make chunked imports + retries idempotent, query existing
  // (variant_name, card_number) tuples for the player_products this batch
  // touches, and skip rows that already exist. The lookup is bounded by
  // the batch's player_product set, so it stays cheap on large products.
  const ppIdsTouched = Array.from(new Set(variantRows.map(v => v.player_product_id)));
  const existingKeys = new Set<string>();
  if (ppIdsTouched.length > 0) {
    const PP_CHUNK = 200;
    for (let i = 0; i < ppIdsTouched.length; i += PP_CHUNK) {
      const slice = ppIdsTouched.slice(i, i + PP_CHUNK);
      const { data: existing, error: readErr } = await supabaseAdmin
        .from('player_product_variants')
        .select('player_product_id, variant_name, card_number')
        .in('player_product_id', slice);
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
      for (const r of existing ?? []) {
        existingKeys.add(`${r.player_product_id}|${r.variant_name}|${r.card_number ?? ''}`);
      }
    }
  }
  const newVariantRows = variantRows.filter(
    v => !existingKeys.has(`${v.player_product_id}|${v.variant_name}|${v.card_number ?? ''}`),
  );

  // Insert in chunks of 500 to stay within Supabase limits
  const CHUNK_SIZE = 500;
  let variantsCreated = 0;
  for (let i = 0; i < newVariantRows.length; i += CHUNK_SIZE) {
    const chunk = newVariantRows.slice(i, i + CHUNK_SIZE);
    const { error: variantErr } = await supabaseAdmin
      .from('player_product_variants')
      .insert(chunk);
    if (variantErr) return NextResponse.json({ error: variantErr.message }, { status: 500 });
    variantsCreated += chunk.length;
  }

  return NextResponse.json({
    playersCreated,
    playerProductsCreated,
    variantsCreated,
    variantsSkippedAsDuplicates: variantRows.length - newVariantRows.length,
  });
}
