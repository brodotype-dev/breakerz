import { supabaseAdmin } from '@/lib/supabase';
import { computeFallbackBaseEV } from '@/lib/pre-release-base-ev';

// Pre-release pricing Phase 1 — synthesize a baseline EV per player for a
// pre-release product from last cycle + our read. See
// docs/plans/2026-08-14-pre-release-pricing.md.
//
// Non-rookie: previous-cycle product's cached EV (products.previous_product_id,
//   by player) → else the player's 90-day raw comp (pre_release_player_snapshots)
//   → else a rank/line floor.
// Rookie: rank-tiered floor (computeFallbackBaseEV) — the ~5 that matter get set
//   by hand afterward. Trend adjustment is a v2 idea (see docs/icebox.md).
//
// The result is later modulated by breakerz_score (the Roster Sentiment editor)
// and fed into the same slot-pricing pipeline as live.

export type BaselineSource = 'previous_product' | 'raw_comp' | 'rookie_floor' | 'floor';

export interface BaselineRow {
  playerProductId: string;
  playerId: string;
  name: string;
  team: string;
  isRookie: boolean;
  baseline: number;
  source: BaselineSource;
}

export interface BaselineResult {
  rows: BaselineRow[];
  summary: Record<BaselineSource, number> & { total: number };
  previousProductLinked: boolean;
}

const IN_CHUNK = 200; // Kong .in() ceiling — CLAUDE.md gotcha #11.

export async function computePreReleaseBaselines(productId: string): Promise<BaselineResult> {
  const empty: BaselineResult = {
    rows: [],
    summary: { total: 0, previous_product: 0, raw_comp: 0, rookie_floor: 0, floor: 0 },
    previousProductLinked: false,
  };

  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id, product_line, previous_product_id')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return empty;

  const { data: rosterRaw } = await supabaseAdmin
    .from('player_products')
    .select('id, player_id, player:players(name, team, is_rookie, prospect_rank)')
    .eq('product_id', productId);
  // PostgREST types the to-one embed as an array; at runtime it's a single
  // object. Cast through unknown and read player as a single row.
  const roster = (rosterRaw ?? []) as unknown as Array<{
    id: string;
    player_id: string;
    player: { name: string | null; team: string | null; is_rookie: boolean | null; prospect_rank: number | null } | null;
  }>;
  if (roster.length === 0) return { ...empty, previousProductLinked: !!product.previous_product_id };

  // Previous-cycle EV, keyed by player_id.
  const prevEvByPlayer = new Map<string, number>();
  if (product.previous_product_id) {
    const { data: prevPps } = await supabaseAdmin
      .from('player_products')
      .select('id, player_id')
      .eq('product_id', product.previous_product_id);
    const ppToPlayer = new Map<string, string>((prevPps ?? []).map(p => [p.id as string, p.player_id as string]));
    const prevIds = [...ppToPlayer.keys()];
    for (let i = 0; i < prevIds.length; i += IN_CHUNK) {
      const slice = prevIds.slice(i, i + IN_CHUNK);
      const { data: pcs } = await supabaseAdmin
        .from('pricing_cache')
        .select('player_product_id, ev_mid')
        .in('player_product_id', slice);
      for (const pc of pcs ?? []) {
        const pid = ppToPlayer.get(pc.player_product_id as string);
        const ev = pc.ev_mid == null ? null : Number(pc.ev_mid);
        if (pid && ev != null && ev > 0) prevEvByPlayer.set(pid, ev);
      }
    }
  }

  // Current product's 90-day raw comp, keyed by player_product_id.
  const rawByPp = new Map<string, number>();
  const ppIds = roster.map(r => r.id);
  for (let i = 0; i < ppIds.length; i += IN_CHUNK) {
    const slice = ppIds.slice(i, i + IN_CHUNK);
    const { data: snaps } = await supabaseAdmin
      .from('pre_release_player_snapshots')
      .select('player_product_id, raw_avg_90d')
      .in('player_product_id', slice);
    for (const s of snaps ?? []) {
      const v = s.raw_avg_90d == null ? null : Number(s.raw_avg_90d);
      if (v != null && v > 0) rawByPp.set(s.player_product_id as string, v);
    }
  }

  const rows: BaselineRow[] = roster.map(r => {
    const p = r.player;
    const isRookie = !!p?.is_rookie;
    let baseline: number;
    let source: BaselineSource;

    if (isRookie) {
      baseline = computeFallbackBaseEV({ isRookie: true, prospectRank: p?.prospect_rank, productLine: product.product_line });
      source = 'rookie_floor';
    } else {
      const prev = prevEvByPlayer.get(r.player_id);
      const raw = rawByPp.get(r.id);
      if (prev != null) { baseline = prev; source = 'previous_product'; }
      else if (raw != null) { baseline = raw; source = 'raw_comp'; }
      else { baseline = computeFallbackBaseEV({ isRookie: false, prospectRank: p?.prospect_rank, productLine: product.product_line }); source = 'floor'; }
    }

    return {
      playerProductId: r.id,
      playerId: r.player_id,
      name: p?.name ?? '',
      team: p?.team ?? '',
      isRookie,
      baseline: Math.round(baseline * 100) / 100,
      source,
    };
  });

  const summary = rows.reduce(
    (acc, row) => { acc[row.source] += 1; acc.total += 1; return acc; },
    { total: 0, previous_product: 0, raw_comp: 0, rookie_floor: 0, floor: 0 } as BaselineResult['summary'],
  );

  return { rows, summary, previousProductLinked: !!product.previous_product_id };
}

// Persist computed baselines to player_products.pre_release_base_ev. Chunked
// concurrent updates (roster is a few hundred rows; this is a one-off admin op).
export async function writePreReleaseBaselines(rows: BaselineRow[]): Promise<number> {
  let written = 0;
  const BATCH = 25;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async row => {
        const { error } = await supabaseAdmin
          .from('player_products')
          .update({ pre_release_base_ev: row.baseline })
          .eq('id', row.playerProductId);
        if (!error) written += 1;
      }),
    );
  }
  return written;
}
