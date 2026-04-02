import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const inviteCode = searchParams.get('invite_code');

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/signup?error=missing_code`);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

  if (sessionError || !sessionData.user) {
    return NextResponse.redirect(`${origin}/auth/signup?error=session_failed`);
  }

  const user = sessionData.user;

  // Upsert profile
  await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
  }, { onConflict: 'id' });

  // Validate and consume invite code
  if (inviteCode) {
    const { data: entry } = await supabaseAdmin
      .from('waitlist')
      .select('id, status')
      .eq('invite_code', inviteCode)
      .single();

    if (entry && entry.status === 'approved') {
      await supabaseAdmin
        .from('waitlist')
        .update({ status: 'converted', converted_at: new Date().toISOString() })
        .eq('id', entry.id);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
