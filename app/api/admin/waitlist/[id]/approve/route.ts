import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/email';
import { getCurrentUser, getUserRoles } from '@/lib/auth';
import { captureServer } from '@/lib/posthog-server';
import { PH_EVENTS } from '@/lib/posthog-events';
import { randomBytes } from 'crypto';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth check
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

  if (entry.status !== 'pending') {
    return NextResponse.json({ error: `Already ${entry.status}` }, { status: 409 });
  }

  // Generate a short, unguessable invite code
  const inviteCode = randomBytes(6).toString('hex'); // 12-char hex

  const { error: updateError } = await supabaseAdmin
    .from('waitlist')
    .update({
      status: 'approved',
      invite_code: inviteCode,
      invite_sent_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateError) {
    console.error('[waitlist/approve] update error:', updateError);
    return NextResponse.json({ error: 'Failed to update record.' }, { status: 500 });
  }

  // Email send is best-effort. The DB row is the authoritative state (code is
  // saved, admin can resend), so a send failure must NOT roll the row back.
  // BUT — silent failures here are how 2026-04→2026-05 produced 6 "approved"
  // users who never received their invite. Two safeguards:
  //   1. PostHog `invite_email_failed` so analytics surfaces the issue.
  //   2. Response shape carries `emailDelivered` so the admin UI can render
  //      a visible error state alongside the approval.
  try {
    await sendInviteEmail({
      to: entry.email,
      fullName: entry.full_name,
      inviteCode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[waitlist/approve] email error:', err);
    await captureServer({
      distinctId: entry.email,
      event: PH_EVENTS.invite_email_failed,
      properties: {
        waitlist_id: entry.id,
        email_domain: entry.email.split('@')[1] ?? null,
        error_message: message,
      },
    });
    return NextResponse.json({
      ok: true,
      emailDelivered: false,
      emailError: message,
    });
  }

  return NextResponse.json({ ok: true, emailDelivered: true });
}
