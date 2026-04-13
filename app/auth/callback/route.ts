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
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const inviteCode = searchParams.get('invite_code');

  if (!code && !tokenHash) {
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

  // Handle both OAuth code exchange and email confirmation token
  let sessionData;
  let sessionError;

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    sessionData = result.data;
    sessionError = result.error;
  } else if (tokenHash && type) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'signup' | 'email',
    });
    sessionData = result.data;
    sessionError = result.error;
  }

  if (sessionError || !sessionData?.user) {
    return NextResponse.redirect(`${origin}/auth/signup?error=session_failed`);
  }

  const user = sessionData.user!;

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

  // Check if onboarding is complete — redirect new users to /onboarding
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', user.id)
    .single();

  if (!profile?.onboarding_completed_at) {
    return NextResponse.redirect(`${origin}/onboarding`);
  }

  return NextResponse.redirect(`${origin}/`);
}
