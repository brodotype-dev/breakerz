import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { runBreakAnalysis } from '@/lib/analysis';
import { checkAndIncrementUsage } from '@/lib/usage';
import { getPostHogClient } from '@/lib/posthog-server';
import type { Platform, BreakOutcome } from '@/lib/types';

export const maxDuration = 60;

const VALID_PLATFORMS: Platform[] = [
  'fanatics_live', 'whatnot', 'ebay',
  'dave_adams', 'layton_sports', 'local_card_shop', 'other',
];

const isDev = process.env.NODE_ENV === 'development';

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user.id;
  if (isDev) {
    // Dev mode: use first available profile so you can test without signing in
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    return data?.id ?? null;
  }
  return null;
}

// GET — list the authenticated user's breaks
export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: breaks, error } = await supabaseAdmin
    .from('user_breaks')
    .select('*, product:products(id, name, year, slug, sport:sports(name))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ breaks: breaks ?? [] });
}

// POST — create a new break
export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Usage gate — both 'new' and 'log' modes run analysis
    const authUserId = userId; // from getAuthUserId()
    if (authUserId && process.env.NODE_ENV !== 'development') {
      const usage = await checkAndIncrementUsage(authUserId);
      if (!usage.allowed) {
        return NextResponse.json({ error: 'Usage limit reached', upgrade: true, plan: usage.plan }, { status: 403 });
      }
    }

    // My Breaks today is single-team / single-format — the multi-* analyzer
    // accepts that as a degenerate case. Map breakType/numCases into the
    // formats shape so we keep the same per-break snapshot semantics.
    const cases = Math.max(1, Math.min(50, parseInt(numCases) || 1));
    const formats = {
      hobby: breakType === 'hobby' ? cases : 0,
      bd:    breakType === 'bd'    ? cases : 0,
      jumbo: breakType === 'jumbo' ? cases : 0,
    };
    const analysis = await runBreakAnalysis({
      productId,
      teams: [team],
      formats,
      askPrice: parseFloat(askPrice),
    });

    const isLog = mode === 'log';

    const { data: newBreak, error } = await supabaseAdmin
      .from('user_breaks')
      .insert({
        user_id: userId,
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

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'break_logged',
      properties: {
        mode,
        product_id: productId,
        team,
        break_type: breakType,
        num_cases: Math.max(1, Math.min(50, parseInt(numCases) || 1)),
        ask_price: parseFloat(askPrice),
        platform,
        signal: analysis.signal,
        value_pct: analysis.valuePct,
        outcome: isLog ? outcome : null,
      },
    });

    return NextResponse.json({ break: newBreak, analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
