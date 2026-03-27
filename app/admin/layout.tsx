import Link from 'next/link';
import { LockIcon, PackageIcon, PlusCircleIcon, SearchCodeIcon, ScanLine } from 'lucide-react';
import { logout } from './login/actions';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-52 bg-[oklch(0.28_0.08_250)] text-white flex-shrink-0 flex flex-col">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-2 mb-0.5">
            <LockIcon className="size-3 text-white/50" />
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Admin</p>
          </div>
          <p className="font-black text-lg">Break Terminal</p>
        </div>

        <nav className="p-3 space-y-0.5 flex-1">
          <Link
            href="/admin"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          >
            <PackageIcon className="size-4 shrink-0" />
            Products
          </Link>
          <Link
            href="/admin/products/new"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          >
            <PlusCircleIcon className="size-4 shrink-0" />
            New Product
          </Link>
          <Link
            href="/admin/card-lookup"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          >
            <ScanLine className="size-4 shrink-0" />
            Card Lookup
          </Link>
          <Link
            href="/admin/api-debug"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          >
            <SearchCodeIcon className="size-4 shrink-0" />
            API Debug
          </Link>
          <div className="border-t border-white/10 my-2" />
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            ← Back to app
          </Link>
        </nav>

        <div className="p-4 border-t border-white/10">
          <form action={logout}>
            <button
              type="submit"
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-1 bg-[var(--topps-red)]" />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
