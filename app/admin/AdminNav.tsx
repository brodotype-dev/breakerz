'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package, Sparkles, Home, PlusCircle, Users } from 'lucide-react';

interface NavLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
  exact?: boolean;
  secondary?: boolean;
}

function NavLink({ icon: Icon, label, href, exact, secondary }: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link href={href}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer relative overflow-hidden"
        style={{
          color: active ? 'var(--text-primary)' : secondary ? 'var(--text-tertiary)' : 'var(--text-secondary)',
          backgroundColor: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.backgroundColor = 'var(--terminal-surface-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = secondary ? 'var(--text-tertiary)' : 'var(--text-secondary)';
          }
        }}
      >
        {active && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r"
            style={{ background: 'var(--gradient-blue)' }}
          />
        )}
        <Icon
          className="w-4 h-4 shrink-0"
          style={{ color: active ? 'var(--accent-blue)' : 'inherit' }}
        />
        <span>{label}</span>
      </div>
    </Link>
  );
}

export default function AdminNav() {
  return (
    <nav className="flex-1 p-4 space-y-1 relative">
      <NavLink icon={Package} label="Products" href="/admin/products" exact />
      <NavLink icon={PlusCircle} label="New Product" href="/admin/products/new" />
<NavLink icon={Sparkles} label="BreakIQ Bets" href="/admin/breakiq-betz" />
      <NavLink icon={Users} label="Waitlist" href="/admin/waitlist" />
      <div className="py-3">
        <div style={{ height: '1px', backgroundColor: 'var(--terminal-border)' }} />
      </div>
      <NavLink icon={Home} label="Back to Site" href="/" secondary />
    </nav>
  );
}
