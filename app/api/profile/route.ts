import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, last_name, is_over_18, favorite_sports, chasing_teams, chasing_players, experience_level, collecting_eras, monthly_spend, primary_platform, referral_source, best_pull, onboarding_completed_at')
    .eq('id', user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { first_name, last_name, is_over_18, favorite_sports, chasing_teams, chasing_players } = body;

  const { error } = await supabase
    .from('profiles')
    .update({ first_name, last_name, is_over_18, favorite_sports, chasing_teams, chasing_players })
    .eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
