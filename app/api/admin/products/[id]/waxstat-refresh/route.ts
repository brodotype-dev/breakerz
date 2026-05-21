import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshProductWaxstat } from '@/lib/waxstat-importer';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST { format?: 'hobby' | 'bd' | 'jumbo' } → refresh either one format or all.
// The importer always refreshes every configured URL; the optional `format`
// filter is honored client-side by only sending the relevant URL — the
// per-format isolation is built into refreshProductWaxstat.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  try {
    const summary = await refreshProductWaxstat(id);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Refresh failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT { hobbyUrl, bdUrl, jumboUrl } — save / clear WaxStat URLs on the
// product. Each field is nullable; empty string → null.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json()) as {
    hobbyUrl?: string | null;
    bdUrl?: string | null;
    jumboUrl?: string | null;
  };

  const update = {
    waxstat_hobby_url: body.hobbyUrl?.trim() || null,
    waxstat_bd_url: body.bdUrl?.trim() || null,
    waxstat_jumbo_url: body.jumboUrl?.trim() || null,
  };

  const { error } = await supabaseAdmin.from('products').update(update).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
