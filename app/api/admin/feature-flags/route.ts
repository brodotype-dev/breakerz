import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Admin-only read/write for the feature_flags table. Used by the toggle
// row on /admin/market-delta. Service role bypasses RLS for the actual
// write, but the route gates on the admin role before touching DB.

// Allowlist of flag keys this route is allowed to touch. Prevents the
// endpoint from being abused to flip arbitrary future flags accidentally.
const TOGGLEABLE_KEYS = new Set([
  'verdict_observation_context_enabled',
]);

export async function GET() {
  const ok = await checkRole('admin');
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('key, enabled, description, updated_at, updated_by')
    .order('key');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flags: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const ok = await checkRole('admin');
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { key?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  const enabled = body.enabled === true || body.enabled === false ? body.enabled : null;
  if (!key || !TOGGLEABLE_KEYS.has(key)) {
    return NextResponse.json({ error: `unknown or non-toggleable key: ${key}` }, { status: 400 });
  }
  if (enabled === null) {
    return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('feature_flags')
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: ok.user.id })
    .eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, key, enabled });
}
