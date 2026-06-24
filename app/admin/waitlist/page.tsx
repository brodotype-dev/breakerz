import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import WaitlistTable from './WaitlistTable';

export default async function WaitlistPage() {
  await requireRole('admin');

  const { data: entries } = await supabaseAdmin
    .from('waitlist')
    .select('*')
    .order('created_at', { ascending: false });

  // Ground-truth login signal: match each waitlist email to its auth user's
  // last_sign_in_at. More reliable than waitlist.status='converted' (which only
  // flips on the first invite-flow signup) and shows actual recent activity.
  const loginByEmail = new Map<string, string | null>();
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of authData?.users ?? []) {
    if (u.email) loginByEmail.set(u.email.toLowerCase(), u.last_sign_in_at ?? null);
  }
  const enriched = (entries ?? []).map(e => ({
    ...e,
    last_login_at: loginByEmail.get((e.email ?? '').toLowerCase()) ?? null,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Waitlist
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {(entries ?? []).filter(e => e.status === 'pending').length} pending
          {' · '}
          {(entries ?? []).filter(e => e.status === 'approved').length} invited
          {' · '}
          {(entries ?? []).filter(e => e.status === 'converted').length} converted
          {' · '}
          {enriched.filter(e => e.last_login_at).length} logged in
        </p>
      </div>

      <WaitlistTable entries={enriched} />
    </div>
  );
}
