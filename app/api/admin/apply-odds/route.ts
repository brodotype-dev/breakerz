import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedOdds } from '@/lib/checklist-parser';

// Normalize a string for fuzzy matching: lowercase, collapse whitespace, strip punctuation
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function POST(req: NextRequest) {
  const { productId, odds }: { productId: string; odds: ParsedOdds } = await req.json();
  if (!productId || !odds?.rows?.length) {
    return NextResponse.json({ error: 'productId and odds.rows required' }, { status: 400 });
  }

  // Load all player_product IDs for this product
  const { data: playerProducts } = await supabaseAdmin
    .from('player_products')
    .select('id')
    .eq('product_id', productId);

  const ppIds = (playerProducts ?? []).map(pp => pp.id);
  if (!ppIds.length) return NextResponse.json({ updatedCount: 0, matched: [], unmatched: [] });

  // Load all variants for those player_products
  const { data: variants, error } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, variant_name')
    .in('player_product_id', ppIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!variants?.length) return NextResponse.json({ updatedCount: 0, matched: [], unmatched: [] });

  let updatedCount = 0;
  const matched: { subsetName: string; variantName: string; hobbyOdds: string; breakerOdds: string | null }[] = [];
  const unmatched: string[] = [];

  for (const oddsRow of odds.rows) {
    const normalizedOdds = normalize(oddsRow.subsetName);

    // Find best-matching variant by normalized name substring
    const match = variants.find(v => {
      const normalizedVariant = normalize(v.variant_name);
      return normalizedVariant.includes(normalizedOdds) || normalizedOdds.includes(normalizedVariant);
    });

    if (!match) {
      unmatched.push(oddsRow.subsetName);
      continue;
    }

    const variantIds = variants
      .filter(v => v.variant_name === match.variant_name)
      .map(v => v.id);

    await supabaseAdmin
      .from('player_product_variants')
      .update({ hobby_odds: oddsRow.hobbyOdds, breaker_odds: oddsRow.breakerOdds })
      .eq('variant_name', match.variant_name)
      .in('id', variantIds);

    matched.push({
      subsetName: oddsRow.subsetName,
      variantName: match.variant_name,
      hobbyOdds: oddsRow.hobbyOdds,
      breakerOdds: oddsRow.breakerOdds,
    });
    updatedCount++;
  }

  // Mark product as having odds if anything matched
  if (updatedCount > 0) {
    await supabaseAdmin
      .from('products')
      .update({ has_odds: true })
      .eq('id', productId);
  }

  return NextResponse.json({ updatedCount, matched, unmatched });
}
