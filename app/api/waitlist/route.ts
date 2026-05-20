import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendWaitlistConfirmation } from '@/lib/email';
import { captureServer } from '@/lib/posthog-server';
import { PH_EVENTS } from '@/lib/posthog-events';

export async function POST(req: NextRequest) {
  const { email, full_name, use_case } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({ email: normalizedEmail, full_name, use_case });

  if (error) {
    // Unique constraint = already on the list
    if (error.code === '23505') {
      return NextResponse.json({ error: 'already_on_list' }, { status: 409 });
    }
    console.error('[waitlist] insert error:', error);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }

  // Confirmation send is best-effort. The DB row is the authoritative state,
  // so a Resend failure must NOT roll back the join. PostHog event in the
  // catch path so silent failures surface in analytics — same observability
  // pattern as /api/admin/waitlist/[id]/approve.
  try {
    await sendWaitlistConfirmation({ to: normalizedEmail, fullName: full_name ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[waitlist] confirmation email error:', err);
    await captureServer({
      distinctId: normalizedEmail,
      event: PH_EVENTS.waitlist_confirmation_email_failed,
      properties: {
        email_domain: normalizedEmail.split('@')[1] ?? null,
        error_message: message,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
