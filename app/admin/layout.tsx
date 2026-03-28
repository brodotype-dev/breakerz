import { Sparkles } from 'lucide-react';
import { logout } from './login/actions';
import AdminNav from './AdminNav';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--terminal-bg)' }}>
      {/* Sidebar */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col relative overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #131820 0%, #0a0e1a 100%)',
          borderRight: '1px solid var(--terminal-border)',
        }}
      >
        {/* Gradient accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'var(--gradient-blue)' }} />

        {/* Glow effect */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 blur-3xl opacity-15 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)' }}
        />

        {/* Brand Header */}
        <div className="relative p-6 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--gradient-blue)', boxShadow: 'var(--glow-blue)' }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Card Breakerz
              </h1>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-blue)' }}>
                Admin Portal
              </div>
            </div>
          </div>
        </div>

        {/* Navigation — client component for usePathname */}
        <AdminNav />

        {/* Footer */}
        <div className="p-4 border-t relative" style={{ borderColor: 'var(--terminal-border)' }}>
          <form action={logout}>
            <button
              type="submit"
              className="w-full flex items-center justify-start gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:bg-[var(--terminal-surface-hover)] hover:text-[var(--text-primary)]"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'transparent' }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-1" style={{ background: 'var(--gradient-blue)' }} />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
