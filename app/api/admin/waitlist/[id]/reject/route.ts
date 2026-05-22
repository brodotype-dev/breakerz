import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCurrentUser, getUserRoles } from '@/lib/auth';

// Soft-reject a waitlist entry. Sets status to 'rejected' so it leaves
// the Pending tab + accumulates in Rejected for audit. Use for users
// who reached out saying they no longer want to join, or whose intent
// looks like spam. For hard cleanup use DELETE.
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
    .select('id, status')
    .eq('id', id)
    .single();
  if (fetchError || !entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (entry.status === 'converted') {
    return NextResponse.json(
      { error: 'Cannot reject a converted user — use delete or remove their account directly.' },
      { status: 409 },
    );
  }
  if (entry.status === 'rejected') {
    return NextResponse.json({ ok: true, alreadyRejected: true });
  }

  const { error: updateError } = await supabaseAdmin
    .from('waitlist')
    .update({ status: 'rejected' })
    .eq('id', id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
