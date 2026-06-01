import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { computeSignal } from '@/lib/engine';
import type { BreakOutcome, Platform } from '@/lib/types';

const VALID_OUTCOMES: BreakOutcome[] = ['win', 'mediocre', 'bust'];
const VALID_PLATFORMS: Platform[] = [
  'fanatics_live', 'whatnot', 'ebay',
  'dave_adams', 'layton_sports', 'local_card_shop', 'other',
];
const isDev = process.env.NODE_ENV === 'development';

// Resolve the authed user id (dev falls back to the first profile, mirroring
// the sibling collection route). PATCH + DELETE scope by this id via the
// service-role client because user_breaks has no DELETE RLS policy — a
// user_id-scoped service-role write is the clean fix (consistent with how GET
// already reads through supabaseAdmin + user_id).
async function resolveUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user.id;
  if (isDev) {
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    return data?.id ?? null;
  }
  return null;
}

// PUT — complete or abandon a pending break
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth check — dev mode falls back to supabaseAdmin (bypasses RLS)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !isDev) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use admin client in dev (no RLS session), cookie client in prod.
  // Defense in depth: also resolve a userId for an explicit .eq('user_id', ...)
  // filter so the update is scoped even if RLS is ever misconfigured.
  const db = isDev && !user ? supabaseAdmin : supabase;
  let scopedUserId: string | null = user?.id ?? null;
  if (!scopedUserId && isDev) {
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    scopedUserId = data?.id ?? null;
  }

  try {
    const body = await req.json();

    // Abandon (didn't buy in)
    if (body.abandon) {
      let q = db
        .from('user_breaks')
        .update({
          status: 'abandoned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'pending');
      if (scopedUserId) q = q.eq('user_id', scopedUserId);
      const { data, error } = await q.select().single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: 'Break not found or already completed' }, { status: 404 });
      return NextResponse.json({ break: data });
    }

    // Complete with outcome
    const { outcome, outcomeNotes, analysisFeedback } = body;

    if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: 'Valid outcome required (win, mediocre, bust)' }, { status: 400 });
    }

    let q = db
      .from('user_breaks')
      .update({
        outcome,
        outcome_notes: outcomeNotes ?? null,
        analysis_feedback: analysisFeedback === 'helpful' || analysisFeedback === 'not_helpful' ? analysisFeedback : null,
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');
    if (scopedUserId) q = q.eq('user_id', scopedUserId);
    const { data, error } = await q.select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Break not found or already completed' }, { status: 404 });

    return NextResponse.json({ break: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH — edit a break's ask price, platform, or (for completed breaks) outcome
// + notes. The use case is "fix a typo," not "re-price": when ask_price changes
// we recompute snapshot_value_pct + snapshot_signal from the *stored*
// snapshot_fair_value via computeSignal (pure, no CardHedger/Claude call).
// Caveat: snapshot_fair_value is pure EV while the original signal was judged
// against the market-adjusted number, so the recompute uses pure fair value as
// its reference — internally consistent, slightly different from origin.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.platform !== undefined) {
      if (!VALID_PLATFORMS.includes(body.platform)) {
        return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
      }
      updates.platform = body.platform;
      updates.platform_other = body.platform === 'other' ? (body.platform_other ?? null) : null;
    }

    if (body.outcome !== undefined) {
      if (body.outcome !== null && !VALID_OUTCOMES.includes(body.outcome)) {
        return NextResponse.json({ error: 'Invalid outcome' }, { status: 400 });
      }
      updates.outcome = body.outcome;
    }

    if (body.outcome_notes !== undefined) {
      updates.outcome_notes = body.outcome_notes || null;
    }

    let newAsk: number | null = null;
    if (body.ask_price !== undefined) {
      const parsed = typeof body.ask_price === 'number' ? body.ask_price : parseFloat(String(body.ask_price));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'ask_price must be a positive number' }, { status: 400 });
      }
      newAsk = parsed;
      updates.ask_price = newAsk;
    }

    // Recompute the verdict locally when the ask changed and we have a stored
    // fair value to reference. No external pricing call.
    if (newAsk != null) {
      const { data: existing } = await supabaseAdmin
        .from('user_breaks')
        .select('snapshot_fair_value')
        .eq('id', id)
        .eq('user_id', userId)
        .single();
      const fair = existing?.snapshot_fair_value;
      if (fair != null && Number(fair) > 0) {
        const { valuePct, signal } = computeSignal(Number(fair), newAsk);
        updates.snapshot_value_pct = valuePct;
        updates.snapshot_signal = signal;
      }
    }

    // Nothing to update beyond the timestamp → treat as a no-op error so the
    // client doesn't silently think it changed something.
    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('user_breaks')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Break not found' }, { status: 404 });

    return NextResponse.json({ break: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — remove a break. Scoped by user_id through the service-role client
// (no DELETE RLS policy exists on user_breaks).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('user_breaks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
