import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createClient } from '@/lib/supabase-server';
import { runBreakAnalysis } from '@/lib/analysis';
import { checkAndIncrementUsage } from '@/lib/usage';

export const maxDuration = 60;

interface AnalysisPayload {
  productId?: string;
  teams?: unknown;
  extraPlayerProductIds?: unknown;
  formats?: { hobby?: unknown; bd?: unknown; jumbo?: unknown };
  caseCosts?: { hobby?: unknown; bd?: unknown; jumbo?: unknown };
  askPrice?: unknown;
}

function toNonNegInt(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toPositiveNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (user) {
    const usage = await checkAndIncrementUsage(user.id);
    if (!usage.allowed) {
      return NextResponse.json({ error: 'Usage limit reached', upgrade: true, plan: usage.plan }, { status: 403 });
    }
  }

  try {
    const payload = (await req.json()) as AnalysisPayload & { team?: unknown; breakType?: unknown; numCases?: unknown };

    // Reject the legacy single-team shape with a clear error so older clients
    // know to update — easier to debug than a silent type mismatch.
    if (payload.team !== undefined || payload.breakType !== undefined) {
      return NextResponse.json(
        { error: 'Legacy payload shape detected. Send { teams: string[], formats: { hobby, bd, jumbo }, askPrice }.' },
        { status: 400 },
      );
    }

    const { productId, teams, extraPlayerProductIds, formats, caseCosts, askPrice } = payload;
    if (!productId || typeof productId !== 'string') {
      return NextResponse.json({ error: 'productId required' }, { status: 400 });
    }
    const teamList = Array.isArray(teams) ? teams.filter((t): t is string => typeof t === 'string') : [];
    const extraIds = Array.isArray(extraPlayerProductIds)
      ? extraPlayerProductIds.filter((t): t is string => typeof t === 'string')
      : [];
    if (!teamList.length && !extraIds.length) {
      return NextResponse.json({ error: 'Pick at least one team or player.' }, { status: 400 });
    }
    const ask = toPositiveNumber(askPrice);
    if (ask == null) {
      return NextResponse.json({ error: 'askPrice required' }, { status: 400 });
    }

    const cases = {
      hobby: toNonNegInt(formats?.hobby),
      bd: toNonNegInt(formats?.bd),
      jumbo: toNonNegInt(formats?.jumbo),
    };
    if (cases.hobby + cases.bd + cases.jumbo === 0) {
      return NextResponse.json({ error: 'Pick at least one case for any format.' }, { status: 400 });
    }

    const overrides = caseCosts ? {
      hobby: toPositiveNumber(caseCosts.hobby),
      bd: toPositiveNumber(caseCosts.bd),
      jumbo: toPositiveNumber(caseCosts.jumbo),
    } : undefined;

    const result = await runBreakAnalysis({
      productId,
      teams: teamList,
      extraPlayerProductIds: extraIds,
      formats: cases,
      caseCosts: overrides,
      askPrice: ask,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — return active products with all format costs (for the analysis page dropdowns)
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: products } = await supabaseAdmin
    .from('products')
    .select('id, name, year, sport:sports(name), hobby_case_cost, bd_case_cost, jumbo_case_cost, hobby_am_case_cost, bd_am_case_cost, jumbo_am_case_cost')
    .eq('is_active', true)
    .order('name');

  return NextResponse.json({ products: products ?? [] });
}
