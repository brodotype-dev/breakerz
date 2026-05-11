import { supabaseAdmin } from '@/lib/supabase';

export interface CronRunSummary {
  cronPath: string;
  startedAt: number;        // ms epoch
  processed: number;
  ok: number;
  errors: number;
  skipped: number;
  details?: Record<string, unknown>;
}

/**
 * Records one cron orchestrator run for admin observability. Best-effort:
 * insert failures are swallowed and logged so a logging hiccup doesn't tank
 * the actual cron work.
 *
 * `success` is computed: errors=0 always counts (including processed=0 —
 * "nothing to do" is healthy), AND a partial run with at least one ok worker
 * also counts. The fan-out orchestrator dispatches workers on their own Vercel
 * invocations; a worker the orchestrator marks as errored (e.g. aborted at the
 * orchestrator's deadline) often still completes and writes pricing_cache. So
 * `errors > 0 && ok > 0` is partial-success, not a hard failure — flagging it
 * as failure made "Last Priced" and the cron panel diverge for days at a time.
 */
export async function recordCronRun(summary: CronRunSummary): Promise<void> {
  const finishedAt = new Date();
  const startedAtIso = new Date(summary.startedAt).toISOString();
  const durationMs = finishedAt.getTime() - summary.startedAt;
  const success = summary.errors === 0 || summary.ok > 0;

  const { error } = await supabaseAdmin.from('cron_run_log').insert({
    cron_path: summary.cronPath,
    started_at: startedAtIso,
    finished_at: finishedAt.toISOString(),
    duration_ms: durationMs,
    processed: summary.processed,
    ok: summary.ok,
    errors: summary.errors,
    skipped: summary.skipped,
    success,
    details: summary.details ?? null,
  });

  if (error) {
    console.error(`[cron-log] failed to record ${summary.cronPath} run:`, error);
  }
}

/**
 * Insert a "started" marker so admin observability sees the run even if the
 * route hits Vercel's maxDuration before reaching the final recordCronRun.
 * Marker rows count as successful — the cron actually fired. The follow-up
 * summary row (if the route completes) will be the more recent record and
 * supersede this in the Cron Status panel's most-recent lookup.
 *
 * Use at the top of any cron route whose summary call sits past potential
 * timeout points (e.g. serial loops over per-set work).
 */
export async function recordCronStart(cronPath: string, startedAt: number): Promise<void> {
  const { error } = await supabaseAdmin.from('cron_run_log').insert({
    cron_path: cronPath,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(startedAt).toISOString(),
    duration_ms: 0,
    processed: 0,
    ok: 0,
    errors: 0,
    skipped: 0,
    success: true,
    details: { phase: 'started' },
  });

  if (error) {
    console.error(`[cron-log] failed to record ${cronPath} start marker:`, error);
  }
}
