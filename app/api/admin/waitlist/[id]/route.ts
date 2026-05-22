import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCurrentUser, getUserRoles } from '@/lib/auth';

// Hard-delete a waitlist row. For real cleanup (spam, mistakes, test
// entries). Soft-reject via POST /reject is the better default — it
// keeps audit trail in the Rejected tab.
//
// Refuses to delete a `converted` row — those have a corresponding
// profile + auth user and need account-level cleanup first.
export async function DELETE(
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
    .select('id, status, email')
    .eq('id', id)
    .single();
  if (fetchError || !entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (entry.status === 'converted') {
    return NextResponse.json(
      {
        error:
          `Cannot delete a converted user (${entry.email}) — they have a profile + auth account. ` +
          `Remove the auth user first, then delete this row if needed.`,
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabaseAdmin.from('waitlist').delete().eq('id', id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
