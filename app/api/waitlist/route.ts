import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { email, full_name, use_case } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({ email: email.trim().toLowerCase(), full_name, use_case });

  if (error) {
    // Unique constraint = already on the list
    if (error.code === '23505') {
      return NextResponse.json({ error: 'already_on_list' }, { status: 409 });
    }
    console.error('[waitlist] insert error:', error);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
