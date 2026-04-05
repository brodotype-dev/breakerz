'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Sparkles, ChevronDown, LogOut, Settings, Monitor, User } from 'lucide-react';
import { logout } from './actions';

interface ConsumerNavProps {
  isAdmin: boolean;
}

export default function ConsumerNav({ isAdmin }: ConsumerNavProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <header
      className="sticky top-0 z-60 border-b flex items-center justify-between px-4 py-2.5"
      style={{
        backgroundColor: 'rgba(10, 14, 26, 0.97)',
        borderColor: 'var(--terminal-border)',
        backdropFilter: 'blur(8px)',
        zIndex: 60,
      }}
    >
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--gradient-blue)' }}
        >
          <Sparkles className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>BreakIQ</span>
      </Link>

      {/* Right side */}
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--terminal-surface)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <User className="w-3 h-3" />
          Profile
        </Link>

        {isAdmin && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--terminal-surface)]"
              style={{
                color: 'var(--accent-blue)',
                borderColor: 'var(--terminal-border)',
              }}
            >
              <Monitor className="w-3 h-3" />
              Consumer View
              <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
              <div
                className="absolute right-0 top-full mt-1 w-44 rounded-lg border shadow-lg overflow-hidden"
                style={{
                  backgroundColor: 'var(--terminal-surface)',
                  borderColor: 'var(--terminal-border)',
                }}
              >
                <div
                  className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium"
                  style={{
                    color: 'var(--accent-blue)',
                    borderBottom: '1px solid var(--terminal-border)',
                    backgroundColor: 'rgba(59,130,246,0.06)',
                  }}
                >
                  <Monitor className="w-3 h-3" />
                  Consumer View
                </div>
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-[var(--terminal-surface-hover)]"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => setOpen(false)}
                >
                  <Settings className="w-3 h-3" />
                  Admin Portal
                </Link>
              </div>
            )}
          </div>
        )}

        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--terminal-surface)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <LogOut className="w-3 h-3" />
            Sign Out
          </button>
        </form>
      </div>
    </header>
  );
}
