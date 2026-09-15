/**
 * Responsible-gambling notice.
 *
 * This lived ONLY on the old `/breaks` page. When `/breaks` was merged into
 * Breaks (`/my-breaks`) on 2026-09-15 it would have disappeared from the app
 * entirely, so it moved into the consumer layout instead — it now renders on
 * every consumer surface rather than one.
 */
export default function ResponsibleGamblingBanner() {
  return (
    <div
      className="border-t px-6 py-4 text-center"
      style={{ borderColor: 'var(--rule)', backgroundColor: 'var(--panel)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--ink2)' }}>
        Gambling problem? Call or text{' '}
        <a href="tel:18004262537" className="underline" style={{ color: 'var(--ink)' }}>
          1-800-GAMBLER
        </a>
      </p>
    </div>
  );
}
