import { supabaseAdmin } from '@/lib/supabase';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

/**
 * Surfaces the latest run for each cron the orchestrators write into
 * `cron_run_log`. Renders inline on the admin dashboard so silent failures
 * (the kind that hid the SSO fan-out bug for weeks) become visible at a
 * glance instead of requiring a Supabase query.
 *
 * "Last successful" is the most recent row with errors=0 — including
 * processed=0 runs (a "nothing to refresh" run is healthy). "Last attempt"
 * is the absolute latest, regardless of outcome.
 */

const CRON_LABELS: Record<string, { label: string; schedule: string }> = {
  '/api/cron/refresh-pricing':         { label: 'Pricing Refresh',          schedule: '4–6:30 AM UTC ×5' },
  '/api/cron/refresh-ch-catalogs':     { label: 'Catalog Refresh',          schedule: '3 AM UTC daily' },
  '/api/cron/update-scores':           { label: 'C-Score Update',           schedule: '5 AM UTC daily' },
  '/api/cron/refresh-dormant-pricing': { label: 'Dormant Pricing Refresh',  schedule: '7 AM UTC, 1st + 15th' },
};
const CRON_ORDER = Object.keys(CRON_LABELS);

interface CronRunRow {
  cron_path: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  processed: number;
  ok: number;
  errors: number;
  skipped: number;
  success: boolean;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ms = now - then;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${secs}s`;
}

export default async function CronStatusPanel() {
  // Pull the most recent two runs per cron path: one for "last attempt" and
  // potentially the prior successful one. Fetch enough rows that we can pick
  // the latest success even if the most recent run failed.
  const { data } = await supabaseAdmin
    .from('cron_run_log')
    .select('cron_path, started_at, finished_at, duration_ms, processed, ok, errors, skipped, success')
    .in('cron_path', CRON_ORDER)
    .order('started_at', { ascending: false })
    .limit(80);

  const lastByPath = new Map<string, CronRunRow>();
  const lastSuccessByPath = new Map<string, CronRunRow>();
  for (const row of (data ?? []) as CronRunRow[]) {
    if (!lastByPath.has(row.cron_path)) lastByPath.set(row.cron_path, row);
    if (row.success && !lastSuccessByPath.has(row.cron_path)) {
      lastSuccessByPath.set(row.cron_path, row);
    }
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--terminal-border)', backgroundColor: 'var(--terminal-surface)' }}>
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--terminal-border)' }}>
        <div>
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Cron Status</h3>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Last successful run per orchestrator. Stale &gt; 26h is a problem.</p>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--terminal-border)' }}>
        {CRON_ORDER.map(path => {
          const last = lastByPath.get(path);
          const lastSuccess = lastSuccessByPath.get(path);
          const meta = CRON_LABELS[path];

          // Stale threshold: pricing/catalogs/scores are daily so 26h is the
          // alarm line. Dormant runs every two weeks, so 17 days for that one.
          const staleHours = path === '/api/cron/refresh-dormant-pricing' ? 17 * 24 : 26;
          const successAgeMs = lastSuccess ? Date.now() - new Date(lastSuccess.started_at).getTime() : Infinity;
          const isStale = successAgeMs > staleHours * 3600_000;
          const lastFailed = last && !last.success;

          let icon;
          let tone;
          if (!lastSuccess) {
            icon = <AlertTriangle className="w-4 h-4" style={{ color: 'var(--signal-pass)' }} />;
            tone = 'never run';
          } else if (isStale) {
            icon = <AlertTriangle className="w-4 h-4" style={{ color: 'var(--signal-watch)' }} />;
            tone = 'stale';
          } else if (lastFailed) {
            icon = <AlertTriangle className="w-4 h-4" style={{ color: 'var(--signal-watch)' }} />;
            tone = 'last attempt failed';
          } else {
            icon = <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--signal-buy)' }} />;
            tone = 'healthy';
          }

          return (
            <div key={path} className="px-5 py-3 flex items-start gap-3">
              <div className="pt-0.5">{icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{meta.label}</span>
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{meta.schedule}</span>
                  <span
                    className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        tone === 'healthy' ? 'rgba(34,197,94,0.12)' :
                        tone === 'stale' || tone === 'last attempt failed' ? 'rgba(234,179,8,0.12)' :
                        'rgba(239,68,68,0.12)',
                      color:
                        tone === 'healthy' ? 'var(--signal-buy)' :
                        tone === 'stale' || tone === 'last attempt failed' ? 'var(--signal-watch)' :
                        'var(--signal-pass)',
                    }}
                  >
                    {tone}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 opacity-60" />
                    <span>
                      Last success: <span className="font-mono">{lastSuccess ? formatRelative(lastSuccess.started_at) : '—'}</span>
                      {lastSuccess && lastSuccess.processed > 0 && (
                        <span className="opacity-60"> · {lastSuccess.ok} ok / {lastSuccess.errors} err in {formatDuration(lastSuccess.duration_ms)}</span>
                      )}
                      {lastSuccess && lastSuccess.processed === 0 && <span className="opacity-60"> · nothing to do</span>}
                    </span>
                  </div>
                  {last && last !== lastSuccess && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 opacity-60" />
                      <span>
                        Last attempt: <span className="font-mono">{formatRelative(last.started_at)}</span>
                        <span className="opacity-60"> · {last.ok} ok / {last.errors} err in {formatDuration(last.duration_ms)}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
