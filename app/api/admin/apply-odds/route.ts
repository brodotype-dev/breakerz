import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import type { ParsedOdds } from '@/lib/checklist-parser';
import { checkRole } from '@/lib/auth';

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
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { productId, odds }: { productId: string; odds: ParsedOdds } = await req.json();
  if (!productId || !odds?.rows?.length) {
    return NextResponse.json({ error: 'productId and odds.rows required' }, { status: 400 });
  }

  // Load ALL variants for this product via join, paginated.
  // PostgREST caps any single response at 1000 rows by default — for products
  // with 12k+ variants (e.g. hydrated Topps Finest) the cap silently truncated
  // the match pool, so only ~1000 variants got odds applied out of ~12k.
  const PAGE = 1000;
  const variants: { id: string; variant_name: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('player_product_variants')
      .select('id, variant_name, player_products!inner(product_id)')
      .eq('player_products.product_id', productId)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    variants.push(...data.map(v => ({ id: v.id as string, variant_name: v.variant_name as string })));
    if (data.length < PAGE) break;
  }

  if (variants.length === 0) {
    return NextResponse.json({ updatedCount: 0, matched: [], unmatched: [] });
  }

  // Group all IDs by variant_name so one update covers every row that shares a name.
  const idsByName = new Map<string, string[]>();
  for (const v of variants) {
    const list = idsByName.get(v.variant_name);
    if (list) list.push(v.id);
    else idsByName.set(v.variant_name, [v.id]);
  }
  const uniqueVariantNames = [...idsByName.keys()];

  let updatedCount = 0;
  const matched: { subsetName: string; variantName: string; rowsUpdated: number; hobbyOdds: string; breakerOdds: string | null }[] = [];
  const unmatched: string[] = [];

  // Chunk size for the .in() update — 200 UUIDs keeps the URL well under
  // Kong/PostgREST's ~8KB URL limit (same pattern as the hydrator delete).
  const UPDATE_CHUNK = 200;

  for (const oddsRow of odds.rows) {
    // Find best-matching variant name by token overlap score
    let bestName: string | null = null;
    let bestScore = 0;

    for (const name of uniqueVariantNames) {
      const score = matchScore(oddsRow.subsetName, name);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }

    // Require at least 50% of the variant's tokens to match
    if (!bestName || bestScore < 0.5) {
      unmatched.push(oddsRow.subsetName);
      continue;
    }

    const ids = idsByName.get(bestName) ?? [];
    let rowsUpdated = 0;
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const slice = ids.slice(i, i + UPDATE_CHUNK);
      const { error: updErr } = await supabaseAdmin
        .from('player_product_variants')
        .update({ hobby_odds: oddsRow.hobbyOdds, breaker_odds: oddsRow.breakerOdds })
        .in('id', slice);
      if (updErr) {
        return NextResponse.json(
          { error: `Odds update failed at ${bestName} chunk ${i}: ${updErr.message}` },
          { status: 500 },
        );
      }
      rowsUpdated += slice.length;
    }

    updatedCount += rowsUpdated;
    matched.push({
      subsetName: oddsRow.subsetName,
      variantName: bestName,
      rowsUpdated,
      hobbyOdds: oddsRow.hobbyOdds,
      breakerOdds: oddsRow.breakerOdds,
    });
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
