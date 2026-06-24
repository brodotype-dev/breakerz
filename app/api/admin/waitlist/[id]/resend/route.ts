import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/email';
import { getCurrentUser, getUserRoles } from '@/lib/auth';
import { captureServer } from '@/lib/posthog-server';
import { PH_EVENTS } from '@/lib/posthog-events';
import { randomBytes } from 'crypto';

// Resend the invite email for an already-approved waitlist entry. Reuses the
// existing invite_code (generates one if a legacy row is missing it), bumps
// invite_sent_at, and reports email delivery the same way as /approve so the
// admin UI can surface a failure. Same best-effort email policy.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const roles = await getUserRoles(user.id);
  if (!roles.includes('admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  const { data: entry, error: fetchError } = await supabaseAdmin
    .from('waitlist')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (entry.status !== 'approved') {
    return NextResponse.json({ error: `Can only resend to approved entries (this one is ${entry.status})` }, { status: 409 });
  }

  // Reuse the existing code so a previously-sent link still works; only mint a
  // new one if a legacy approved row somehow has none.
  const inviteCode: string = entry.invite_code ?? randomBytes(6).toString('hex');

  const { error: updateError } = await supabaseAdmin
    .from('waitlist')
    .update({ invite_code: inviteCode, invite_sent_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) {
    console.error('[waitlist/resend] update error:', updateError);
    return NextResponse.json({ error: 'Failed to update record.' }, { status: 500 });
  }

  try {
    await sendInviteEmail({ to: entry.email, fullName: entry.full_name, inviteCode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[waitlist/resend] email error:', err);
    await captureServer({
      distinctId: entry.email,
      event: PH_EVENTS.invite_email_failed,
      properties: {
        waitlist_id: entry.id,
        email_domain: entry.email.split('@')[1] ?? null,
        error_message: message,
        resend: true,
      },
    });
    return NextResponse.json({ ok: true, emailDelivered: false, emailError: message });
  }

  return NextResponse.json({ ok: true, emailDelivered: true });
}
