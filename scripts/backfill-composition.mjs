#!/usr/bin/env node
/**
 * One-time backfill: rewrite every `market_observations` row whose payload
 * carries the old `format` shape to the new `composition` + `source_type`
 * shape. See docs/plans/2026-05-13-composition-and-observation-driven-verdicts.md.
 *
 * What it does to each legacy row:
 *   payload.format = 'hobby'         payload.composition  = { hobby: null }
 *                                →   payload.source_type  = 'competitor_listing' (safe default)
 *                                    (delete payload.format)
 *
 *   Filters on `observation_type IN ('asking_price', 'odds_observation')`
 *   (hype_tag was never format-keyed).
 *
 * Dan Reed cleanup (--clean-dan-reed-mode):
 *   The 23 mis-classified Bowman Baseball rows captured before composition
 *   shipped were Claude's best-effort `format: 'hobby'` reading of a
 *   delight+hobby mix screenshot. Per plan decision they get DELETED, not
 *   backfilled. Identified by:
 *     - observation_type = 'asking_price'
 *     - product.name like '%Bowman%Baseball%' (year independent — handles
 *       cosmetic dup-year products)
 *     - source = 'social_post'
 *     - created at the same time as Dan's IG DM (window expressed as
 *       --dan-cutoff=ISO, defaults to anything before 2026-05-14T03:00:00Z)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/backfill-composition.mjs --dry-run
 *   node scripts/backfill-composition.mjs --commit
 *   node scripts/backfill-composition.mjs --commit --clean-dan-reed-mode
 *   node scripts/backfill-composition.mjs --reverse --commit
 *
 * Defaults to dry-run. Always run dry-run first on staging, eyeball the
 * planned mutations, then re-run with --commit.
 *
 * The --reverse flag undoes a backfill (composition+source_type → format),
 * for emergency rollback. Reverse does NOT restore Dan Reed's deleted rows.
 */

import { createClient } from '@supabase/supabase-js';

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has('--commit');
const REVERSE = args.has('--reverse');
const CLEAN_DAN_REED = args.has('--clean-dan-reed-mode');
const DAN_CUTOFF =
  process.argv.find(a => a.startsWith('--dan-cutoff='))?.split('=')[1] ??
  '2026-05-14T03:00:00Z';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const validFormats = new Set(['hobby', 'bd', 'jumbo']);

function planLegacyToComposition(row) {
  const payload = row.payload ?? {};
  if (!payload.format) return null; // already migrated or never had format
  if (!validFormats.has(payload.format)) {
    return { skip: true, reason: `unknown legacy format=${payload.format}` };
  }
  const next = { ...payload };
  next.composition = { [payload.format]: null };
  next.source_type = 'competitor_listing'; // safe default for legacy rows
  delete next.format;
  return { next, before: payload };
}

function planCompositionToLegacy(row) {
  const payload = row.payload ?? {};
  if (!payload.composition) return null;
  const keys = Object.keys(payload.composition);
  if (keys.length !== 1) {
    return { skip: true, reason: `cannot reverse multi-key composition (${keys.join('+')})` };
  }
  const next = { ...payload };
  next.format = keys[0];
  delete next.composition;
  delete next.source_type;
  return { next, before: payload };
}

async function loadDanReedTargets() {
  // 23 mis-classified Bowman Baseball rows from Dan Reed's IG DM, captured
  // before composition shipped. See plan section 6.
  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .ilike('name', '%Bowman%Baseball%');

  const ids = (products ?? []).map(p => p.id);
  if (ids.length === 0) return [];

  const { data: rows } = await supabase
    .from('market_observations')
    .select('id, payload, product_id, observed_at')
    .eq('observation_type', 'asking_price')
    .in('product_id', ids)
    .lt('observed_at', DAN_CUTOFF);

  return (rows ?? []).filter(r => r.payload?.source === 'social_post');
}

async function run() {
  console.log(
    `[backfill-composition] mode=${REVERSE ? 'reverse' : 'forward'} dryRun=${DRY_RUN} cleanDanReed=${CLEAN_DAN_REED}`,
  );

  const { data: rows, error } = await supabase
    .from('market_observations')
    .select('id, observation_type, payload, observed_at')
    .in('observation_type', ['asking_price', 'odds_observation']);

  if (error) {
    console.error('Failed to read market_observations:', error.message);
    process.exit(1);
  }

  console.log(`Loaded ${rows.length} candidate rows.`);

  const plan = [];
  for (const row of rows) {
    const planned = REVERSE ? planCompositionToLegacy(row) : planLegacyToComposition(row);
    if (!planned) continue;
    if (planned.skip) {
      console.warn(`  SKIP ${row.id}: ${planned.reason}`);
      continue;
    }
    plan.push({ id: row.id, before: planned.before, next: planned.next });
  }

  console.log(`\nPlanned mutations: ${plan.length}`);
  for (const p of plan.slice(0, 5)) {
    console.log(`  ${p.id}`);
    console.log(`    before: ${JSON.stringify(p.before)}`);
    console.log(`    after:  ${JSON.stringify(p.next)}`);
  }
  if (plan.length > 5) console.log(`  ... and ${plan.length - 5} more`);

  let danReedTargets = [];
  if (CLEAN_DAN_REED && !REVERSE) {
    danReedTargets = await loadDanReedTargets();
    console.log(`\nDan Reed cleanup targets (cutoff < ${DAN_CUTOFF}): ${danReedTargets.length} rows`);
    for (const r of danReedTargets.slice(0, 5)) {
      console.log(`  DELETE ${r.id}  observed_at=${r.observed_at}  payload=${JSON.stringify(r.payload).slice(0, 120)}`);
    }
    if (danReedTargets.length > 5) console.log(`  ... and ${danReedTargets.length - 5} more`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no writes. Re-run with --commit to apply.');
    return;
  }

  console.log('\nApplying...');
  let updated = 0;
  for (const p of plan) {
    const { error: upErr } = await supabase
      .from('market_observations')
      .update({ payload: p.next })
      .eq('id', p.id);
    if (upErr) {
      console.error(`  FAIL ${p.id}: ${upErr.message}`);
      continue;
    }
    updated++;
  }
  console.log(`Updated ${updated} / ${plan.length} rows.`);

  if (CLEAN_DAN_REED && !REVERSE && danReedTargets.length > 0) {
    const { error: delErr, count } = await supabase
      .from('market_observations')
      .delete({ count: 'exact' })
      .in('id', danReedTargets.map(r => r.id));
    if (delErr) {
      console.error(`Dan Reed cleanup failed: ${delErr.message}`);
    } else {
      console.log(`Deleted ${count} Dan Reed rows.`);
    }
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
