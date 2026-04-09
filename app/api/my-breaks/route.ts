import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBreakAnalysis } from '@/lib/analysis';
import type { Platform, BreakOutcome } from '@/lib/types';

export const maxDuration = 60;

const VALID_PLATFORMS: Platform[] = [
  'fanatics_live', 'whatnot', 'ebay',
  'dave_adams', 'layton_sports', 'local_card_shop', 'other',
];

// GET — list the authenticated user's breaks
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: breaks, error } = await supabase
    .from('user_breaks')
    .select('*, product:products(id, name, year, slug, sport:sports(name))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ breaks: breaks ?? [] });
}

// POST — create a new break
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      mode,          // 'new' (pre-break) or 'log' (post-break)
      productId,
      team,
      breakType = 'hobby',
      numCases = 1,
      askPrice,
      platform,
      platformOther,
      outcome,       // only for mode='log'
      outcomeNotes,  // only for mode='log'
    } = body;

    if (!productId || !team || askPrice == null || !platform) {
      return NextResponse.json({ error: 'productId, team, askPrice, and platform required' }, { status: 400 });
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }
    if (mode === 'log' && !outcome) {
      return NextResponse.json({ error: 'outcome required for log mode' }, { status: 400 });
    }

    // Run analysis to capture snapshot
    const analysis = await runBreakAnalysis({
      productId,
      team,
      askPrice: parseFloat(askPrice),
      breakType,
      numCases: parseInt(numCases) || 1,
    });

    const isLog = mode === 'log';

    const { data: newBreak, error } = await supabaseAdmin
      .from('user_breaks')
      .insert({
        user_id: user.id,
        product_id: productId,
        team,
        break_type: breakType,
        num_cases: Math.max(1, Math.min(50, parseInt(numCases) || 1)),
        ask_price: parseFloat(askPrice),
        platform,
        platform_other: platform === 'other' ? platformOther ?? null : null,
        snapshot_signal: analysis.signal,
        snapshot_value_pct: analysis.valuePct,
        snapshot_fair_value: analysis.fairValue,
        snapshot_analysis: analysis.analysis,
        snapshot_top_players: analysis.topPlayers,
        snapshot_risk_flags: analysis.riskFlags,
        snapshot_hv_players: analysis.hvPlayers,
        outcome: isLog ? (outcome as BreakOutcome) : null,
        outcome_notes: isLog ? outcomeNotes ?? null : null,
        status: isLog ? 'completed' : 'pending',
        completed_at: isLog ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ break: newBreak, analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
