import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import type { BreakOutcome } from '@/lib/types';

const VALID_OUTCOMES: BreakOutcome[] = ['win', 'mediocre', 'bust'];
const isDev = process.env.NODE_ENV === 'development';

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
