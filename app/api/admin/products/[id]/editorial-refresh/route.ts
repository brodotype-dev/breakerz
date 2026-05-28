import { NextRequest, NextResponse } from 'next/server';
import { checkRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshProductEditorial } from '@/lib/editorial-import';

export const dynamic = 'force-dynamic';
// Per-URL Firecrawl scrape (waitFor + render) + Claude extract, serial over
// the URL list. 300s covers a handful of URLs comfortably.
export const maxDuration = 300;

// POST → scrape every configured editorial URL and write observations.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  try {
    const summary = await refreshProductEditorial(id);
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Editorial refresh failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT { urls: string[] } — save / clear the product's editorial_urls. Empty
// array clears. Whitespace-only entries dropped.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await checkRole('admin', 'contributor');
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  let urls: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.urls)) {
      urls = body.urls.map((u: unknown) => String(u).trim()).filter(Boolean);
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('products')
    .update({ editorial_urls: urls.length > 0 ? urls : null })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: urls.length });
}
