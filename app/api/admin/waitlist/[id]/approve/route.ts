import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/email';
import { getCurrentUser, getUserRoles } from '@/lib/auth';
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

  try {
    await sendInviteEmail({
      to: entry.email,
      fullName: entry.full_name,
      inviteCode,
    });
  } catch (err) {
    console.error('[waitlist/approve] email error:', err);
    // Don't fail the request — code is saved, admin can resend manually
    return NextResponse.json({ ok: true, emailError: true });
  }

  return NextResponse.json({ ok: true });
}
