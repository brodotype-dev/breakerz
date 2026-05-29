import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createChannelMessage } from '@/lib/discord';
import { scrapeAndStageProposal } from '@/lib/tracked-source-proposal';
import { computeNextScrapeAt, describeSchedule } from '@/lib/tracked-sources';
import { recordCronRun, recordCronStart } from '@/lib/cron-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_PATH = '/api/cron/refresh-tracked-sources';
// Bound work per firing so a backlog can't blow the 300s budget. Serial per
// row (Firecrawl rate limits + Claude per scrape); recurring sources are few.
const MAX_PER_RUN = 40;

interface TrackedSourceRow {
  id: string;
  url: string;
  cadence: string;
  note: string | null;
  stop_at: string | null;
  submitted_by: string;
  discord_channel_id: string | null;
}

// Slice 4b of web-sourced-intel. Nightly cron that re-scrapes recurring
// tracked_sources on their cadence. For each due active row: scrape → parse
// (web-source mode) → stage a pending_insights proposal → post the ✅/✏️/❌
// panel to the source's Discord channel via the bot. Then advance
// next_scrape_at (or retire the row once stop_at has passed). One-shot
// sources never reach here — they're marked status='done' at submit time.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  await recordCronStart(CRON_PATH, started);

  try {
    const nowIso = new Date().toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from('tracked_sources')
      .select('id, url, cadence, note, stop_at, submitted_by, discord_channel_id')
      .eq('status', 'active')
      .lte('next_scrape_at', nowIso)
      .order('next_scrape_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) {
      await recordCronRun({
        cronPath: CRON_PATH,
        startedAt: started,
        processed: 0, ok: 0, errors: 1, skipped: 0,
        details: { phase: 'load', error: error.message },
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const due = (rows ?? []) as TrackedSourceRow[];
    let ok = 0;
    let errors = 0;
    let skipped = 0;
    let stagedCount = 0;
    let noUpdates = 0;
    const perSource: Array<{ id: string; url: string; result: string }> = [];

    for (const row of due) {
      const now = new Date();
      const stopAt = row.stop_at ? new Date(row.stop_at) : null;

      // Past its stop window → retire without scraping.
      if (stopAt && stopAt.getTime() <= now.getTime()) {
        await supabaseAdmin
          .from('tracked_sources')
          .update({ status: 'done', next_scrape_at: null })
          .eq('id', row.id);
        skipped++;
        perSource.push({ id: row.id, url: row.url, result: 'retired (past stop_at)' });
        continue;
      }

      // Legacy row with no channel to post to — can't deliver a proposal.
      // Push next_scrape_at out so we don't hot-loop; record the reason so
      // it's visible in the admin source list. Stays active for a human.
      if (!row.discord_channel_id) {
        const next = computeNextScrapeAt(row.cadence, now);
        await supabaseAdmin
          .from('tracked_sources')
          .update({
            last_error: 'no discord_channel_id — cannot post (legacy row)',
            last_scraped_at: now.toISOString(),
            next_scrape_at: next?.toISOString() ?? null,
          })
          .eq('id', row.id);
        skipped++;
        perSource.push({ id: row.id, url: row.url, result: 'skipped (no channel_id)' });
        continue;
      }

      try {
        const result = await scrapeAndStageProposal({
          url: row.url,
          note: row.note,
          channelId: row.discord_channel_id,
          submittedBy: row.submitted_by,
          scheduleLine: describeSchedule(row.cadence, stopAt),
          submitterLabel: `<@${row.submitted_by}>`,
        });

        if (result.staged) {
          await createChannelMessage(row.discord_channel_id, result.body);
          stagedCount++;
          perSource.push({ id: row.id, url: row.url, result: `posted ${result.updateCount} updates` });
        } else {
          // Thin / no-updates scrape — don't spam the channel on a recurring
          // source; just advance. (Most days a tracked feed has nothing new.)
          noUpdates++;
          perSource.push({ id: row.id, url: row.url, result: 'no updates' });
        }

        // Advance schedule. Retire if the next firing would fall past stop_at.
        const next = computeNextScrapeAt(row.cadence, now);
        const retire = !next || (stopAt !== null && next.getTime() > stopAt.getTime());
        await supabaseAdmin
          .from('tracked_sources')
          .update({
            last_scraped_at: now.toISOString(),
            last_error: null,
            next_scrape_at: retire ? null : next!.toISOString(),
            status: retire ? 'done' : 'active',
          })
          .eq('id', row.id);
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors++;
        perSource.push({ id: row.id, url: row.url, result: `error: ${msg}` });
        // Record the error + advance so a transient failure doesn't hot-loop.
        const next = computeNextScrapeAt(row.cadence, now);
        await supabaseAdmin
          .from('tracked_sources')
          .update({
            last_error: msg,
            last_scraped_at: now.toISOString(),
            next_scrape_at: next?.toISOString() ?? null,
          })
          .eq('id', row.id);
        console.error(`[cron/refresh-tracked-sources] ${row.url}:`, msg);
      }
    }

    await recordCronRun({
      cronPath: CRON_PATH,
      startedAt: started,
      processed: due.length,
      ok,
      errors,
      skipped,
      details: { staged: stagedCount, noUpdates, perSource },
    });

    return NextResponse.json({
      due: due.length,
      ok,
      errors,
      skipped,
      staged: stagedCount,
      noUpdates,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordCronRun({
      cronPath: CRON_PATH,
      startedAt: started,
      processed: 0, ok: 0, errors: 1, skipped: 0,
      details: { phase: 'fatal', error: msg },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
