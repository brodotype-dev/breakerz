import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';
import WaitlistTable from './WaitlistTable';

export default async function WaitlistPage() {
  await requireRole('admin');

  const { data: entries } = await supabaseAdmin
    .from('waitlist')
    .select('*')
    .order('created_at', { ascending: false });

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
        </p>
      </div>

      <WaitlistTable entries={entries ?? []} />
    </div>
  );
}
