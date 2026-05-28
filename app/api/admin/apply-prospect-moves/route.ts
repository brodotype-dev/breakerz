import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Endorsed prospect moves stay relevant until the next monthly-ish source
// update; 45 days covers the gap with margin. After that they expire out
// of the active-observation queries just like hype_tags.
const PROSPECT_MOVE_TTL_DAYS = 45;

type IncomingMove = {
  playerId: string;
  source: string;
  kind: 'riser' | 'faller' | 'new' | 'dropped';
  priorRank: number | null;
  newRank: number | null;
  delta: number | null;
  description: string;
};

/**
 * POST /api/admin/apply-prospect-moves
 *
 * Slice 2b. Writes admin-endorsed prospect rank moves as player-scoped
 * `prospect_rank_move` market_observations — the "subjective layer" on top
 * of the objective prospect_rankings rows (which already exist from the
 * scrape). Deliberately NOT a breakerz_score write: keeps Track A separate
 * from Track B and doesn't touch the engine (which stays gated behind
 * prospect_rank_enabled).
 *
 * Per player, supersedes any prior non-superseded prospect_rank_move so the
 * "current signal" is the latest endorsement.
 *
 * Body: { moves: IncomingMove[] }
 */
export async function POST(req: NextRequest) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let moves: IncomingMove[];
  try {
    const body = await req.json();
    moves = Array.isArray(body?.moves) ? body.moves : [];
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate + keep only well-formed rows targeting a real player.
  const valid = moves.filter(
    (m): m is IncomingMove =>
      !!m &&
      typeof m.playerId === 'string' &&
      typeof m.source === 'string' &&
      typeof m.description === 'string' &&
      ['riser', 'faller', 'new', 'dropped'].includes(m.kind),
  );
  if (valid.length === 0) {
    return NextResponse.json({ error: 'No valid moves to apply' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + PROSPECT_MOVE_TTL_DAYS * 86_400_000).toISOString();
  const userId = auth.user.id;

  // Supersede prior active prospect_rank_move rows for these players + source
  // so the latest endorsement is the live one. Chunk the .in() at 200
  // (CLAUDE.md gotcha #11) — though we'll rarely approve that many at once.
  const playerIds = [...new Set(valid.map(m => m.playerId))];
  const IN_CHUNK = 200;
  for (let i = 0; i < playerIds.length; i += IN_CHUNK) {
    const slice = playerIds.slice(i, i + IN_CHUNK);
    const { error: supErr } = await supabaseAdmin
      .from('market_observations')
      .update({ superseded_at: nowIso })
      .eq('observation_type', 'prospect_rank_move')
      .is('superseded_at', null)
      .in('scope_id', slice);
    if (supErr) {
      console.error('[apply-prospect-moves] supersede failed:', supErr);
      return NextResponse.json({ error: `supersede failed: ${supErr.message}` }, { status: 500 });
    }
  }

  const rows = valid.map(m => ({
    observation_type: 'prospect_rank_move',
    scope_type: 'player',
    scope_id: m.playerId,
    scope_team: null,
    product_id: null, // sport-wide — not product-specific
    payload: {
      source: m.source,
      kind: m.kind,
      prior_rank: m.priorRank,
      new_rank: m.newRank,
      delta: m.delta,
    },
    source_user_id: userId,
    source_narrative: m.description,
    confidence: 1.0, // objective rank — not an estimate
    observed_at: nowIso,
    expires_at: expiresIso,
  }));

  const { error } = await supabaseAdmin.from('market_observations').insert(rows);
  if (error) {
    console.error('[apply-prospect-moves] insert failed:', error);
    return NextResponse.json({ error: `insert failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ applied: rows.length });
}
