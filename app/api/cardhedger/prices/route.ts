import { NextRequest, NextResponse } from 'next/server';
import { computeLiveEV } from '@/lib/cardhedger';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';

const CACHE_TTL_HOURS = 24;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { cardId, playerProductId } = await req.json();
    if (!cardId) return NextResponse.json({ error: 'cardId required' }, { status: 400 });

    // Check Supabase cache first
    if (playerProductId) {
      const { data: cached } = await supabaseAdmin
        .from('pricing_cache')
        .select('*')
        .eq('player_product_id', playerProductId)
        .gt('expires_at', new Date().toISOString())
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single();

      if (cached) {
        return NextResponse.json({
          evLow: cached.ev_low,
          evMid: cached.ev_mid,
          evHigh: cached.ev_high,
          source: 'cached',
          fetchedAt: cached.fetched_at,
        });
      }
    }

    // Fetch live from CardHedger
    const ev = await computeLiveEV(cardId);

    // Store in cache
    if (playerProductId) {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

      await supabaseAdmin.from('pricing_cache').upsert({
        player_product_id: playerProductId,
        cardhedger_card_id: cardId,
        ev_low: ev.evLow,
        ev_mid: ev.evMid,
        ev_high: ev.evHigh,
        raw_comps: {},
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      }, { onConflict: 'player_product_id' });
    }

    return NextResponse.json({ ...ev, source: 'live' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
