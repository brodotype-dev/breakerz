'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package, Sparkles, Home, PlusCircle, Users, Activity, Database, Star, ListChecks, ExternalLink } from 'lucide-react';

interface NavLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
  exact?: boolean;
  secondary?: boolean;
  /** Opens in a new tab via a plain <a>; never renders an active state. */
  external?: boolean;
}

function NavLink({ icon: Icon, label, href, exact, secondary, external }: NavLinkProps) {
  const pathname = usePathname();
  const active = external ? false : exact ? pathname === href : pathname.startsWith(href);

  const inner = (
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
      {external && (
        <ExternalLink className="w-3 h-3 shrink-0 ml-auto" style={{ color: 'var(--text-tertiary)' }} />
      )}
    </div>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }

  return <Link href={href}>{inner}</Link>;
}

export default function AdminNav() {
  return (
    <nav className="flex-1 p-4 space-y-1 relative">
      <NavLink icon={Package} label="Products" href="/admin/products" exact />
      <NavLink icon={PlusCircle} label="New Product" href="/admin/products/new" />
<NavLink icon={Sparkles} label="Insights Debrief" href="/admin/breakiq-betz" />
      <NavLink icon={Activity} label="Market Delta" href="/admin/market-delta" />
      <NavLink icon={Database} label="Data Health" href="/admin/data-health" />
      <NavLink icon={Star} label="Players" href="/admin/players" />
      <NavLink icon={Users} label="Waitlist" href="/admin/waitlist" />
      <NavLink
        icon={ListChecks}
        label="Checklist Tracker"
        href="https://km-breakiq-calendar.netlify.app/"
        external
      />
      <div className="py-3">
        <div style={{ height: '1px', backgroundColor: 'var(--terminal-border)' }} />
      </div>
      <NavLink icon={Home} label="Back to Site" href="/" secondary />
    </nav>
  );
}
