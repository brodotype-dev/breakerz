import { PackagePlus, RefreshCw } from 'lucide-react';
import type { CHAdditionsSummary } from '@/lib/ch-coverage';

// CardHedger additions feed — what CH added recently (their release-calendar
// proxy, per River 2026-06-03). Snapshotted nightly into `ch_additions`.
// Additions to sets we already track are flagged as a re-match signal.
const ROW_CAP = 80;

function fmtDate(iso: string): string {
  // iso is a YYYY-MM-DD date; render compactly without TZ surprises.
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y?.slice(2)}`;
}

export default function CHAdditionsPanel({ data }: { data: CHAdditionsSummary }) {
  const { rows, totalCards, trackedCards, trackedSets, lastFetchedAt, daysCovered } = data;
  const shown = rows.slice(0, ROW_CAP);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}
    >
      <div className="px-4 py-3 flex items-start justify-between gap-4 border-b" style={{ borderColor: 'var(--terminal-border)' }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <PackagePlus className="w-4 h-4" />
            CardHedger Additions
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            What CH added in the last {daysCovered} days (their release-calendar proxy). Pulled nightly.
            {lastFetchedAt && (
              <span className="inline-flex items-center gap-1 ml-2">
                <RefreshCw className="w-3 h-3" /> last pull {new Date(lastFetchedAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="text-right">
            <div className="font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{totalCards.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>cards added</div>
          </div>
        </div>
      </div>

      {/* Tracked-set callout — the re-match signal */}
      {trackedSets.length > 0 && (
        <div
          className="px-4 py-2.5 text-xs flex items-start gap-2"
          style={{ backgroundColor: 'rgba(245, 158, 11, 0.10)', color: '#f59e0b', borderBottom: '1px solid var(--terminal-border)' }}
        >
          <span className="font-bold">⚡ {trackedCards.toLocaleString()} cards added to {trackedSets.length} set{trackedSets.length === 1 ? '' : 's'} you track</span>
          <span style={{ color: 'var(--text-secondary)' }}>— consider re-running matching: {trackedSets.join(', ')}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No additions recorded yet — the nightly cron (<code>/api/cron/refresh-ch-additions</code>) populates this.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-3 py-2 font-medium">Sport</th>
                <th className="px-3 py-2 font-medium">Set</th>
                <th className="px-3 py-2 font-medium">Subset</th>
                <th className="px-3 py-2 font-medium text-right">Cards</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr
                  key={`${r.added_date}-${r.set_name}-${r.subset}-${i}`}
                  style={{ borderTop: '1px solid var(--terminal-border)', backgroundColor: r.tracked ? 'rgba(245, 158, 11, 0.06)' : undefined }}
                >
                  <td className="px-4 py-1.5 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{fmtDate(r.added_date)}</td>
                  <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>{r.category}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.set_name}
                      {r.tracked && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded tracking-wide" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>tracked</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.subset}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{r.card_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > ROW_CAP && (
            <div className="px-4 py-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Showing the {ROW_CAP} most recent of {rows.length} additions.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
