import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { BreakOutcome } from '@/lib/types';

const VALID_OUTCOMES: BreakOutcome[] = ['win', 'mediocre', 'bust'];

// PUT — complete a pending break (set outcome + notes)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();

    // Abandon (didn't buy in)
    if (body.abandon) {
      const { data, error } = await supabase
        .from('user_breaks')
        .update({
          status: 'abandoned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'pending')
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: 'Break not found or already completed' }, { status: 404 });
      return NextResponse.json({ break: data });
    }

    // Complete with outcome
    const { outcome, outcomeNotes } = body;

    if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json({ error: 'Valid outcome required (win, mediocre, bust)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('user_breaks')
      .update({
        outcome,
        outcome_notes: outcomeNotes ?? null,
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Break not found or already completed' }, { status: 404 });

    return NextResponse.json({ break: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
