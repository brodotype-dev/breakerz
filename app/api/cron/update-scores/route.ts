import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getTopMovers } from '@/lib/cardhedger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Minimum 7-day sales volume to count as a valid signal.
const MIN_VOLUME_7D = 3;

// Vercel Cron — runs nightly at 5 AM UTC (after the 4 AM pricing cache refresh).
// 1. Fetches top movers from CardHedger (up to 100 cards).
// 2. Cross-references against player_product_variants.cardhedger_card_id.
// 3. Writes c_score = (gain - 1) to matching player_products.
// 4. Resets c_score = 0 for all active player_products not in the movers list.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ── 1. Fetch top movers ────────────────────────────────────────────────────
    const { cards: movers } = await getTopMovers(100);

    // Build a map: cardhedger_card_id → mover data (apply volume floor)
    const moverMap = new Map<string, { gain: number; player: string; sales7d: number; sales30d: number }>();
    for (const m of movers) {
      if (m['7 Day Sales'] < MIN_VOLUME_7D) continue;
      moverMap.set(m.card_id, {
        gain: m.gain,
        player: m.player,
        sales7d: m['7 Day Sales'],
        sales30d: m['30 Day Sales'],
      });
    }

    if (moverMap.size === 0) {
      return NextResponse.json({ updated: 0, reset: 0, note: 'No movers passed volume floor' });
    }

    // ── 2. Load all variants with a CH card ID ─────────────────────────────────
    const { data: variants, error: variantsError } = await supabaseAdmin
      .from('player_product_variants')
      .select('id, player_product_id, cardhedger_card_id')
      .not('cardhedger_card_id', 'is', null);

    if (variantsError) throw variantsError;
    if (!variants?.length) {
      return NextResponse.json({ updated: 0, reset: 0, note: 'No matched variants found' });
    }

    // ── 3. Cross-reference — find best (highest gain) mover per player_product ─
    // A player may have multiple variants; take the one with the highest signal.
    const bestByPlayerProduct = new Map<string, number>(); // player_product_id → c_score

    for (const variant of variants) {
      const mover = moverMap.get(variant.cardhedger_card_id!);
      if (!mover) continue;

      const cScore = mover.gain - 1; // e.g. 1.99 → 0.99
      const existing = bestByPlayerProduct.get(variant.player_product_id);
      if (existing === undefined || cScore > existing) {
        bestByPlayerProduct.set(variant.player_product_id, cScore);
      }
    }

    // ── 4. Fetch all active player_product IDs ────────────────────────────────
    const { data: allPlayerProducts, error: ppError } = await supabaseAdmin
      .from('player_products')
      .select('id, product_id, products!inner(is_active, lifecycle_status)')
      .eq('products.is_active', true)
      .eq('products.lifecycle_status', 'live');

    if (ppError) throw ppError;
    if (!allPlayerProducts?.length) {
      return NextResponse.json({ updated: 0, reset: 0, note: 'No active player_products' });
    }

    // ── 5. Build upsert batches ───────────────────────────────────────────────
    const updates: Array<{ id: string; c_score: number }> = [];

    for (const pp of allPlayerProducts) {
      const cScore = bestByPlayerProduct.get(pp.id) ?? 0;
      updates.push({ id: pp.id, c_score: cScore });
    }

    // Write in chunks to avoid hitting Supabase request limits
    const CHUNK = 200;
    let updatedCount = 0;

    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const { error } = await supabaseAdmin
        .from('player_products')
        .upsert(chunk, { onConflict: 'id' });

      if (error) throw error;
      updatedCount += chunk.length;
    }

    const moversFound = bestByPlayerProduct.size;
    const reset = updatedCount - moversFound;

    console.log(`[cron/update-scores] updated=${updatedCount} movers=${moversFound} reset=${reset}`);

    return NextResponse.json({
      updated: updatedCount,
      movers_matched: moversFound,
      reset,
      total_ch_movers: movers.length,
      volume_filtered: movers.length - moverMap.size,
    });
  } catch (err) {
    console.error('[cron/update-scores]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
