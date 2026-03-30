import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedOdds } from '@/lib/checklist-parser';

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

// Score how well a DB variant name matches a PDF subset name.
// Uses prefix-aware token overlap: fraction of variant tokens found in subset tokens.
// "auto" matches "autographs", "refractor" matches "refractors", etc.
function matchScore(subsetName: string, variantName: string): number {
  const varToks = tokenize(variantName);
  const oddsToks = tokenize(subsetName);
  if (varToks.length === 0 || oddsToks.length === 0) return 0;

  let matched = 0;
  for (const vt of varToks) {
    if (oddsToks.some(ot => ot === vt || ot.startsWith(vt) || vt.startsWith(ot))) {
      matched++;
    }
  }
  return matched / varToks.length;
}

export async function POST(req: NextRequest) {
  const { productId, odds }: { productId: string; odds: ParsedOdds } = await req.json();
  if (!productId || !odds?.rows?.length) {
    return NextResponse.json({ error: 'productId and odds.rows required' }, { status: 400 });
  }

  // Load all variants for this product via join (avoids large .in() URL limit).
  const { data: variants, error } = await supabaseAdmin
    .from('player_product_variants')
    .select('id, variant_name, player_products!inner(product_id)')
    .eq('player_products.product_id', productId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!variants?.length) return NextResponse.json({ updatedCount: 0, matched: [], unmatched: [] });

  let updatedCount = 0;
  const matched: { subsetName: string; variantName: string; hobbyOdds: string; breakerOdds: string | null }[] = [];
  const unmatched: string[] = [];

  // Deduplicate variants by name — odds apply per variant type, not per player row
  const uniqueVariants = [...new Map(variants.map(v => [v.variant_name, v])).values()];

  for (const oddsRow of odds.rows) {
    // Find best-matching variant name by token overlap score
    let bestMatch: typeof variants[0] | null = null;
    let bestScore = 0;

    for (const v of uniqueVariants) {
      const score = matchScore(oddsRow.subsetName, v.variant_name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = v;
      }
    }

    // Require at least 50% of the variant's tokens to match
    if (!bestMatch || bestScore < 0.5) {
      unmatched.push(oddsRow.subsetName);
      continue;
    }

    const match = bestMatch;

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
