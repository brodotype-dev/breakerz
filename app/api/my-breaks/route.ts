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
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    return data?.id ?? null;
  }
  return null;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
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

// POST — create a new break (multi-team / multi-player / mixed-format).
// Body: { mode: 'new' | 'log', productId, teams: string[], extraPlayerProductIds?: string[],
//         formats: { hobby, bd, jumbo }, askPrice, platform, platformOther?, outcome?, outcomeNotes? }
export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      mode,
      productId,
      teams,
      extraPlayerProductIds,
      formats,
      askPrice,
      platform,
      platformOther,
      outcome,
      outcomeNotes,
    } = body;

    const teamList = Array.isArray(teams) ? teams.filter((t): t is string => typeof t === 'string') : [];
    const extraIds = Array.isArray(extraPlayerProductIds)
      ? extraPlayerProductIds.filter((t): t is string => typeof t === 'string')
      : [];

    if (!productId || (!teamList.length && !extraIds.length) || askPrice == null || !platform) {
      return NextResponse.json(
        { error: 'productId, at least one team or player slot, askPrice, and platform required' },
        { status: 400 },
      );
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }
    if (mode === 'log' && !outcome) {
      return NextResponse.json({ error: 'outcome required for log mode' }, { status: 400 });
    }

    const cases = {
      hobby: clampInt(formats?.hobby, 0, 50, 0),
      bd:    clampInt(formats?.bd,    0, 50, 0),
      jumbo: clampInt(formats?.jumbo, 0, 50, 0),
    };
    if (cases.hobby + cases.bd + cases.jumbo === 0) {
      return NextResponse.json({ error: 'Pick at least one case for any format.' }, { status: 400 });
    }

    if (process.env.NODE_ENV !== 'development') {
      const usage = await checkAndIncrementUsage(userId);
      if (!usage.allowed) {
        return NextResponse.json(
          { error: 'Usage limit reached', upgrade: true, plan: usage.plan },
          { status: 403 },
        );
      }
    }

    const askNum = parseFloat(askPrice);
    const analysis = await runBreakAnalysis({
      productId,
      teams: teamList,
      extraPlayerProductIds: extraIds,
      formats: cases,
      askPrice: askNum,
    });

    const isLog = mode === 'log';

    const { data: newBreak, error } = await supabaseAdmin
      .from('user_breaks')
      .insert({
        user_id: userId,
        product_id: productId,
        teams: teamList,
        extra_player_product_ids: extraIds,
        formats: cases,
        ask_price: askNum,
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
        teams: teamList,
        extra_player_count: extraIds.length,
        formats: cases,
        ask_price: askNum,
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
