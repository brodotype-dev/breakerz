import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { captureServer, identifyServer } from '@/lib/posthog-server';
import { PH_EVENTS, PH_PERSON_PROPS } from '@/lib/posthog-events';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal';
import { sendWelcomeEmail } from '@/lib/email';

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
  // Legal acceptance round-trips through the redirect URL so OAuth state
  // doesn't need a separate cookie. Only honor versions that match what
  // we currently publish — protects against a stale link pre-accepting
  // an outdated doc, which would otherwise let a user signal acceptance
  // of language they never saw.
  const acceptTermsParam = searchParams.get('accept_terms');
  const acceptPrivacyParam = searchParams.get('accept_privacy');
  const acceptedTerms = acceptTermsParam === TERMS_VERSION ? TERMS_VERSION : null;
  const acceptedPrivacy = acceptPrivacyParam === PRIVACY_VERSION ? PRIVACY_VERSION : null;

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

  // Beta gate: new sign-ups require a valid, approved invite code.
  // Returning users (existing profile + admin/contributor allow-list) skip this check.
  const isNewProfile = (await supabaseAdmin.from('profiles').select('id').eq('id', user.id).single()).data === null;

  if (isNewProfile) {
    const { data: hasRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!hasRole) {
      if (!inviteCode) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/waitlist?error=missing_invite`);
      }
      const { data: entry } = await supabaseAdmin
        .from('waitlist')
        .select('id, status')
        .eq('invite_code', inviteCode)
        .maybeSingle();
      if (!entry || entry.status !== 'approved') {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/waitlist?error=invalid_invite`);
      }
    }
  }

  // Upsert profile (only reached if invite is valid OR user is returning OR has a role).
  // For new profiles, persist the legal acceptance round-tripped through the
  // redirect URL. Returning users keep their existing acceptance — we don't
  // overwrite it on every sign-in, since they may have accepted an earlier
  // version that we still want to honor as their original timestamp.
  const nowIso = new Date().toISOString();
  const legalFields = isNewProfile && acceptedTerms && acceptedPrivacy ? {
    terms_accepted_at: nowIso,
    terms_version: acceptedTerms,
    privacy_accepted_at: nowIso,
    privacy_version: acceptedPrivacy,
  } : {};

  await supabaseAdmin.from('profiles').upsert({
    id: user.id,
    full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    ...legalFields,
  }, { onConflict: 'id' });

  // Identify user server-side
  await identifyServer({
    distinctId: user.id,
    set: {
      [PH_PERSON_PROPS.email]: user.email,
      [PH_PERSON_PROPS.name]:
        user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    },
  });
  if (isNewProfile) {
    await captureServer({
      distinctId: user.id,
      event: PH_EVENTS.user_signed_up,
      properties: {
        provider: user.app_metadata?.provider ?? 'email',
        email: user.email,
      },
    });

    // Welcome email — best-effort, fires only for first-profile signups. Same
    // observability shape as the other transactional sends: catch + PostHog
    // event so a Resend failure shows up in analytics without blocking auth.
    if (user.email) {
      const firstName =
        (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '')
          .toString()
          .split(' ')[0] || null;
      try {
        await sendWelcomeEmail({ to: user.email, firstName });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[auth/callback] welcome email error:', err);
        await captureServer({
          distinctId: user.id,
          event: PH_EVENTS.welcome_email_failed,
          properties: {
            email_domain: user.email.split('@')[1] ?? null,
            error_message: message,
          },
        });
      }
    }
  }

  // Mark the invite as converted (re-fetch to handle the returning-user path that skipped validation)
  if (inviteCode) {
    const { data: entry } = await supabaseAdmin
      .from('waitlist')
      .select('id, status')
      .eq('invite_code', inviteCode)
      .maybeSingle();

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
