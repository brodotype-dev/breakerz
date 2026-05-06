import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { captureServer } from '@/lib/posthog-server';
import { PH_EVENTS } from '@/lib/posthog-events';

export const dynamic = 'force-dynamic';

const isDev = process.env.NODE_ENV === 'development';

const SURFACES = new Set([
  'player_row',
  'team_row',
  'break_analysis',
  'slab_analysis',
  'pricing_breakdown',
]);

const ENTITY_TYPES = new Set([
  'player_product',
  'team',
  'analysis',
  'cert',
  'variant',
]);

const CATEGORIES = new Set([
  'pricing_too_high',
  'pricing_too_low',
  'wrong_player',
  'missing_data',
  'risk_flag_wrong',
  'other',
]);

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user.id;
  if (isDev) {
    const { data } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
    return data?.id ?? null;
  }
  return null;
}

// POST /api/feedback/pricing
// body: {
//   rating: 'up' | 'down',
//   surface: ...,
//   entity_type: ...,
//   entity_id: string,
//   product_id?: string,
//   category?: ...,           // only relevant on thumbs-down
//   notes?: string,           // only relevant on thumbs-down
//   page_url?: string,
// }
export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rating = body.rating;
  const surface = body.surface;
  const entityType = body.entity_type;
  const entityId = body.entity_id;
  const productId = typeof body.product_id === 'string' ? body.product_id : null;
  const category = typeof body.category === 'string' ? body.category : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;
  const pageUrl = typeof body.page_url === 'string' ? body.page_url.slice(0, 500) : null;

  if (rating !== 'up' && rating !== 'down') {
    return NextResponse.json({ error: 'rating must be up or down' }, { status: 400 });
  }
  if (typeof surface !== 'string' || !SURFACES.has(surface)) {
    return NextResponse.json({ error: 'invalid surface' }, { status: 400 });
  }
  if (typeof entityType !== 'string' || !ENTITY_TYPES.has(entityType)) {
    return NextResponse.json({ error: 'invalid entity_type' }, { status: 400 });
  }
  if (typeof entityId !== 'string' || entityId.length === 0 || entityId.length > 200) {
    return NextResponse.json({ error: 'invalid entity_id' }, { status: 400 });
  }
  if (category && !CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'invalid category' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from('pricing_feedback').insert({
    user_id: userId,
    rating,
    surface,
    entity_type: entityType,
    entity_id: entityId,
    product_id: productId,
    category: rating === 'down' ? category : null,
    notes: rating === 'down' ? (notes || null) : null,
    page_url: pageUrl,
  });

  if (error) {
    console.error('[POST /api/feedback/pricing]', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }

  await captureServer({
    distinctId: userId,
    event: PH_EVENTS.pricing_feedback_submitted,
    properties: {
      rating,
      surface,
      entity_type: entityType,
      entity_id: entityId,
      product_id: productId,
      category: rating === 'down' ? category : null,
      has_notes: rating === 'down' && !!notes,
    },
  });

  return NextResponse.json({ ok: true });
}
