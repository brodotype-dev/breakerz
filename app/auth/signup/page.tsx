import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import SignupForm from './SignupForm';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>;
}) {
  const { code, error } = await searchParams;

  if (error) {
    return <ErrorState message="Something went wrong during sign-in. Please try your invite link again." />;
  }

  if (!code) {
    return <ErrorState message="No invite code found. Check your invite email and use the button in it." />;
  }

  const { data: entry } = await supabaseAdmin
    .from('waitlist')
    .select('full_name, email, status')
    .eq('invite_code', code)
    .single();

  if (!entry) {
    return <ErrorState message="Invite code not recognised. Check your invite email or contact us." />;
  }

  if (entry.status === 'converted') {
    return <ErrorState message="This invite has already been used. Sign in below if you already have an account." showSignIn />;
  }

  if (entry.status !== 'approved') {
    return <ErrorState message="This invite code is not yet active. You may still be on the waitlist." />;
  }

  const firstName = entry.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <SignupForm inviteCode={code} firstName={firstName} />
    </div>
  );
}

function ErrorState({ message, showSignIn }: { message: string; showSignIn?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-xs font-black uppercase tracking-[0.15em]" style={{ color: 'var(--accent-blue)' }}>
          BreakIQ
        </p>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Can't continue
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
        {showSignIn && (
          <Link
            href="/auth/signin"
            className="text-sm font-medium"
            style={{ color: 'var(--accent-blue)' }}
          >
            Sign in →
          </Link>
        )}
        <div>
          <Link href="/waitlist" className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            ← Back to waitlist
          </Link>
        </div>
      </div>
    </div>
  );
}
