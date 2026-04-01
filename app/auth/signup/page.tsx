// Phase 3 placeholder — consumer signup with invite code validation.
// Social login (Google + Apple) and full account creation built here next cycle.

import Link from 'next/link';

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-xs font-black uppercase tracking-[0.15em]" style={{ color: 'var(--accent-blue)' }}>
          Card Breakerz
        </p>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Account creation coming soon
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          We received your invite code. Full consumer signup is launching shortly — we'll email you when it's ready.
        </p>
        <Link href="/waitlist" className="text-sm" style={{ color: 'var(--accent-blue)' }}>
          ← Back to waitlist
        </Link>
      </div>
    </div>
  );
}
