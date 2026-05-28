/**
 * Suspense fallback for BreakPageClient. Renders below the server-rendered
 * hero + banners while loadBreakPageData() resolves on the server.
 *
 * Visible window is typically ~300-1500ms depending on cache state:
 *   - Warm cache (60s TTL, repeat nav within window): ~50-100ms
 *   - Cold cache (first visit / cache expired): ~500-1500ms
 *
 * Shape matches the live-product layout (not pre-release). When the
 * product is pre-release the skeleton briefly shows live-layout placeholders
 * before BreakPageClient swaps to <PreReleaseLayout>; acceptable for a
 * sub-second flash.
 */

export default function BreakPageSkeleton() {
  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-32 rounded skel" />
          <div className="h-6 w-20 rounded skel" />
        </div>
        <div className="h-8 w-40 rounded skel" />
      </div>

      {/* Chase cards row */}
      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
        <div className="h-3 w-20 mb-3 rounded skel" />
        <div className="flex gap-2 flex-wrap">
          <div className="h-7 w-32 rounded-full skel" />
          <div className="h-7 w-28 rounded-full skel" />
          <div className="h-7 w-36 rounded-full skel" />
          <div className="h-7 w-24 rounded-full skel" />
        </div>
      </div>

      {/* Top movers strip */}
      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
        <div className="h-3 w-24 mb-3 rounded skel" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="h-16 rounded skel" />
          <div className="h-16 rounded skel" />
          <div className="h-16 rounded skel" />
          <div className="h-16 rounded skel" />
        </div>
      </div>

      {/* Analysis form */}
      <div className="rounded-lg p-4 space-y-4" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
        <div className="h-4 w-32 rounded skel" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="h-14 rounded skel" />
          <div className="h-14 rounded skel" />
          <div className="h-14 rounded skel" />
        </div>
        <div className="h-10 w-full rounded skel" />
        <div className="h-12 w-full rounded skel" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--terminal-surface)', border: '1px solid var(--terminal-border)' }}>
        <div className="h-9 w-32 rounded skel" />
        <div className="h-9 w-32 rounded skel" />
      </div>

      {/* Slot table */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--terminal-border)' }}>
        <div className="h-10" style={{ backgroundColor: 'var(--terminal-surface)' }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-12 border-t flex items-center px-4 gap-4"
            style={{ borderColor: 'var(--terminal-border)' }}
          >
            <div className="h-3 flex-1 rounded skel" style={{ maxWidth: '40%' }} />
            <div className="h-3 w-16 rounded skel" />
            <div className="h-3 w-16 rounded skel" />
            <div className="h-3 w-16 rounded skel" />
          </div>
        ))}
      </div>

      <style>{`
        .skel {
          background: linear-gradient(
            90deg,
            var(--terminal-surface) 0%,
            var(--terminal-surface-hover) 50%,
            var(--terminal-surface) 100%
          );
          background-size: 200% 100%;
          animation: skel-pulse 1.4s linear infinite;
        }
        @keyframes skel-pulse {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
