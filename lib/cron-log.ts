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
 * `success` is computed: errors=0 always counts as success, including
 * processed=0 ("nothing to do" is a valid healthy outcome).
 */
export async function recordCronRun(summary: CronRunSummary): Promise<void> {
  const finishedAt = new Date();
  const startedAtIso = new Date(summary.startedAt).toISOString();
  const durationMs = finishedAt.getTime() - summary.startedAt;
  const success = summary.errors === 0;

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
